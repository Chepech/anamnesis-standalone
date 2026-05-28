import { join } from "path";
import fs from "fs";

export const SCHEMA_VERSION = "2";

export interface ChunkRecord extends Record<string, unknown> {
  id: string;
  file_path: string;
  heading: string;
  context_path: string;
  chunk_index: number;
  last_modified: number;
  text: string;
  vector: number[];
  tags: string;
  importance_score: number;
  schema_version: string;
}

export const CHUNKS_TABLE = "chunks";

export class VectorDB {
  private db: import("@lancedb/lancedb").Connection | null = null;
  private dbPath: string;
  private vectorDim: number;

  constructor(dataDir: string, vectorDim: number) {
    this.dbPath = join(dataDir, "lancedb");
    this.vectorDim = vectorDim;
  }

  async connect(): Promise<void> {
    const lancedb = await import("@lancedb/lancedb");
    if (!fs.existsSync(this.dbPath)) fs.mkdirSync(this.dbPath, { recursive: true });
    this.db = await lancedb.connect(this.dbPath);
    console.debug("[Anamnesis] LanceDB connected at", this.dbPath);
  }

  async ensureTable(): Promise<import("@lancedb/lancedb").Table> {
    if (!this.db) throw new Error("DB not connected");
    const tableNames = await this.db.tableNames();
    if (tableNames.includes(CHUNKS_TABLE)) return this.db.openTable(CHUNKS_TABLE);

    const seed: ChunkRecord[] = [{
      id: "__seed__", file_path: "", heading: "", context_path: "",
      chunk_index: 0, last_modified: 0, text: "",
      vector: new Array<number>(this.vectorDim).fill(0),
      tags: "", importance_score: 0, schema_version: SCHEMA_VERSION,
    }];

    const table = await this.db.createTable(CHUNKS_TABLE, seed);
    await table.delete('id = "__seed__"');
    console.debug(`[Anamnesis] Created chunks table (dim=${this.vectorDim}, schema=v${SCHEMA_VERSION})`);
    return table;
  }

  async openTable(): Promise<import("@lancedb/lancedb").Table> {
    if (!this.db) throw new Error("DB not connected");
    return this.db.openTable(CHUNKS_TABLE);
  }

  async dropTable(): Promise<void> {
    if (!this.db) throw new Error("DB not connected");
    const tableNames = await this.db.tableNames();
    if (tableNames.includes(CHUNKS_TABLE)) {
      await this.db.dropTable(CHUNKS_TABLE);
      console.debug("[Anamnesis] Dropped chunks table");
    }
  }

  async getStoredDim(): Promise<number | null> {
    if (!this.db) throw new Error("DB not connected");
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(CHUNKS_TABLE)) return null;
    const table = await this.db.openTable(CHUNKS_TABLE);
    const schema = await table.schema();
    const vectorField = schema.fields.find((f) => f.name === "vector");
    if (!vectorField) return null;
    const listType = vectorField.type as unknown as { listSize?: number };
    return listType.listSize ?? null;
  }

  async getSchemaVersion(): Promise<string | null> {
    if (!this.db) throw new Error("DB not connected");
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(CHUNKS_TABLE)) return null;
    const table = await this.db.openTable(CHUNKS_TABLE);
    const schema = await table.schema();
    const hasVersionCol = schema.fields.some((f) => f.name === "schema_version");
    if (!hasVersionCol) return "1";
    const rows = await table.query().limit(1).toArray();
    if (rows.length === 0) return SCHEMA_VERSION;
    const sv = (rows[0] as Record<string, unknown>).schema_version;
    return typeof sv === "string" ? sv : "1";
  }

  async countRows(): Promise<number> {
    if (!this.db) return 0;
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(CHUNKS_TABLE)) return 0;
    const table = await this.db.openTable(CHUNKS_TABLE);
    return table.countRows();
  }

  async getChunkCountsByDir(): Promise<Map<string, number>> {
    if (!this.db) return new Map();
    const tableNames = await this.db.tableNames();
    if (!tableNames.includes(CHUNKS_TABLE)) return new Map();
    const table = await this.db.openTable(CHUNKS_TABLE);
    const rows = await table.query().select(["file_path"]).toArray();
    const counts = new Map<string, number>();
    for (const row of rows) {
      const fp = (row as { file_path: string }).file_path;
      if (!fp) continue;
      counts.set(fp, (counts.get(fp) ?? 0) + 1);
    }
    return counts;
  }

  async getAllChunks(): Promise<ChunkRecord[]> {
    if (!this.db) throw new Error("DB not connected");
    const table = await this.db.openTable(CHUNKS_TABLE);
    const total = await table.countRows();
    const rows = await table.query().limit(Math.max(total, 1)).toArray();
    return rows as ChunkRecord[];
  }

  async search(vector: number[], limit = 10, importanceWeight = 0): Promise<ChunkRecord[]> {
    if (!this.db) throw new Error("DB not connected");
    const table = await this.db.openTable(CHUNKS_TABLE);
    type SearchRow = ChunkRecord & { _distance?: number };
    const rows: SearchRow[] = await table.vectorSearch(vector).limit(limit).toArray();

    if (importanceWeight <= 0) return rows;

    return rows
      .map((r) => ({
        ...r,
        _boosted_score: (r._distance ?? 1) - importanceWeight * Math.log(1 + (r.importance_score ?? 0)),
      }))
      .sort((a, b) => (a._boosted_score ?? 0) - (b._boosted_score ?? 0));
  }

  close(): void {
    this.db = null;
  }
}
