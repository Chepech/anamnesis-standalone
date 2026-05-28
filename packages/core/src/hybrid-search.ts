import type { VectorDB, ChunkRecord } from "./db.js";
import type { FTSIndex } from "./fts.js";
import type { EmbeddingProvider } from "./embedding/bridge.js";
import type { AnamnesisConfig } from "./config.js";

export type MatchSource = "semantic" | "bm25";

export interface SearchResult extends ChunkRecord {
  match_sources: MatchSource[];
  _distance?: number;
}

const RRF_K = 60;

export class HybridSearchEngine {
  constructor(
    readonly db: VectorDB,
    private fts: FTSIndex,
    private provider: EmbeddingProvider,
    private config: AnamnesisConfig
  ) {}

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const [queryVec] = await this.provider.embed([query]);

    if (!this.config.hybridSearch || this.fts.size === 0) {
      const hits = await this.db.search(queryVec, limit, this.config.importanceWeight);
      return hits.map((h) => ({ ...h, match_sources: ["semantic"] as MatchSource[] }));
    }

    const fetchLimit = limit * 3;
    const [semanticHits, bm25Hits] = await Promise.all([
      this.db.search(queryVec, fetchLimit, this.config.importanceWeight),
      Promise.resolve(this.fts.search(query, fetchLimit)),
    ]);

    const semanticMap = new Map<string, ChunkRecord>();
    for (const h of semanticHits) semanticMap.set(h.id, h);

    const semanticIds = new Set(semanticHits.map((h) => h.id));
    const bm25Ids = new Set(bm25Hits.map((h) => h.id));

    const rrfScores = new Map<string, number>();
    semanticHits.forEach((h, rank) => {
      rrfScores.set(h.id, (rrfScores.get(h.id) ?? 0) + 1 / (RRF_K + rank + 1));
    });
    bm25Hits.forEach((h, rank) => {
      const id = h.id as string;
      rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
    });

    const bm25Map = new Map<string, ChunkRecord>(
      bm25Hits.map((h) => [h.id as string, { ...(h as unknown as ChunkRecord), vector: [] }])
    );

    const results: SearchResult[] = [];
    for (const [id] of [...rrfScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
      const chunk = semanticMap.get(id) ?? bm25Map.get(id);
      if (!chunk) continue;
      const match_sources: MatchSource[] = [];
      if (semanticIds.has(id)) match_sources.push("semantic");
      if (bm25Ids.has(id)) match_sources.push("bm25");
      results.push({ ...chunk, match_sources });
    }

    return results;
  }
}
