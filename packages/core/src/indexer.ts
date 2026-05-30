import fs from "fs";
import path from "path";
import { minimatch } from "minimatch";
import { VectorDB, ChunkRecord, SCHEMA_VERSION } from "./db.js";
import { splitMarkdown } from "./chunker.js";
import { parseFile, SUPPORTED_EXTENSIONS } from "./parsers/dispatcher.js";
import type { EmbeddingProvider } from "./embedding/bridge.js";
import type { AnamnesisConfig } from "./config.js";
import type { FTSIndex } from "./fts.js";

export type IndexStatus =
  | { state: "idle" }
  | { state: "queued"; count: number; flushAt: number; delayMs: number }
  | { state: "indexing"; current: number; total: number; label?: string }
  | { state: "paused"; current: number; total: number }
  | { state: "error"; message: string };

export type StatusCallback = (status: IndexStatus) => void;

export interface FileEntry {
  path: string;
  basename: string;
  mtime: number;
}

const EMBED_BATCH_SIZE = 32;
const BREADCRUMB_MAX_CHARS = 150;
const MAX_BACKLINKS = 5;

// Matches [[Target]], [[Target|alias]], [[Target#section]]
const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g;

/** Builds and maintains an in-memory backlink registry from wikilink parsing. */
export class BacklinkRegistry {
  // basename (no ext) → set of source paths that link to it
  private registry = new Map<string, Set<string>>();

  build(files: FileEntry[]): void {
    this.registry.clear();
    for (const file of files) {
      if (path.extname(file.path).toLowerCase() !== ".md") continue;
      try {
        const content = fs.readFileSync(file.path, "utf8");
        for (const match of content.matchAll(WIKILINK_RE)) {
          const target = match[1].trim().split("/").pop() ?? match[1].trim();
          if (!target) continue;
          let set = this.registry.get(target);
          if (!set) { set = new Set(); this.registry.set(target, set); }
          set.add(file.path);
        }
      } catch {
        // unreadable file — skip silently
      }
    }
  }

  getBacklinkTitles(filePath: string): string[] {
    const basename = path.basename(filePath, path.extname(filePath));
    const sources = this.registry.get(basename);
    if (!sources) return [];
    return [...sources].map((p) => path.basename(p, path.extname(p)));
  }
}

export class IndexingEngine {
  private db: VectorDB;
  private provider: EmbeddingProvider;
  private config: AnamnesisConfig;
  private onStatus: StatusCallback;
  private fts: FTSIndex | null;
  private backlinks: BacklinkRegistry;

  private _running = false;
  private _paused = false;
  private _cancelled = false;
  private _pauseResolve: (() => void) | null = null;
  private _lastIndexedCount = 0;
  private mtimeCache = new Map<string, number>();
  private _indexQueue: FileEntry[] = [];
  private _indexQueuePaths = new Set<string>();
  private _indexingCurrent = 0;
  private _indexingTotal = 0;

  constructor(
    db: VectorDB,
    provider: EmbeddingProvider,
    config: AnamnesisConfig,
    onStatus: StatusCallback,
    fts: FTSIndex | null = null
  ) {
    this.db = db;
    this.provider = provider;
    this.config = config;
    this.onStatus = onStatus;
    this.fts = fts;
    this.backlinks = new BacklinkRegistry();
  }

  updateConfig(config: AnamnesisConfig): void {
    this.config = config;
  }

  get isRunning(): boolean { return this._running; }
  get isPaused(): boolean { return this._paused; }
  get lastIndexedCount(): number { return this._lastIndexedCount; }

  pause(): void { if (this._running && !this._paused) this._paused = true; }
  resume(): void { if (this._paused) { this._paused = false; this._pauseResolve?.(); this._pauseResolve = null; } }
  cancel(): void { this._cancelled = true; this.resume(); }

  async indexAll(): Promise<boolean> {
    if (this._running) { console.warn("[Anamnesis] indexAll already running"); return false; }
    this._running = true;
    this._paused = false;
    this._cancelled = false;
    this.mtimeCache.clear();
    let success = false;

    try {
      await this.db.dropTable();
      this.fts?.clear();
      const table = await this.db.ensureTable();

      const allFiles = this.getIndexableFiles();
      this.backlinks.build(allFiles);

      this._indexQueue = [...allFiles];
      this._indexQueuePaths = new Set(allFiles.map((f) => f.path));
      const initialTotal = this._indexQueue.length;
      console.debug(`[Anamnesis] Starting full index: ${initialTotal} files`);
      this.onStatus({ state: "indexing", current: 0, total: initialTotal });

      let processed = 0;
      this._indexingCurrent = 0;
      this._indexingTotal = initialTotal;

      while (this._indexQueue.length > 0) {
        const file = this._indexQueue.shift()!;
        this._indexQueuePaths.delete(file.path);
        const currentTotal = processed + this._indexQueue.length;
        this._indexingTotal = currentTotal;

        if (this._paused) {
          this.onStatus({ state: "paused", current: processed, total: currentTotal });
          await new Promise<void>((resolve) => { this._pauseResolve = resolve; });
        }
        if (this._cancelled) break;

        if (!fs.existsSync(file.path)) {
          processed++;
          this._indexingCurrent = processed;
          continue;
        }

        this.onStatus({ state: "indexing", current: processed, total: currentTotal, label: file.basename });
        this._indexingCurrent = processed;

        try {
          const records = await this.fileToRecords(file);
          if (records.length > 0) await table.add(records);
          for (const r of records) this.fts?.add(r);
          this.mtimeCache.set(file.path, file.mtime);
        } catch (err) {
          console.warn(`[Anamnesis] Skipping "${file.basename}":`, err);
        }

        processed++;
        this._indexingCurrent = processed;
        if (processed % 25 === 0) console.debug(`[Anamnesis] Indexed ${processed} / ${processed + this._indexQueue.length}`);
      }

      if (!this._cancelled) {
        this._lastIndexedCount = processed;
        console.debug(`[Anamnesis] Full index complete: ${processed} files`);
        success = true;
      }
      this.onStatus({ state: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Anamnesis] indexAll failed:", message);
      this.onStatus({ state: "error", message });
    } finally {
      this._indexQueue = [];
      this._indexQueuePaths.clear();
      this._running = false;
      this._paused = false;
      this._cancelled = false;
    }

    return success;
  }

  setQueued(count: number, flushAt = 0, delayMs = 0): void {
    if (this._running) return;
    if (count <= 0) this.onStatus({ state: "idle" });
    else this.onStatus({ state: "queued", count, flushAt, delayMs });
  }

  async indexFiles(paths: string[]): Promise<void> {
    if (this._running) {
      for (const p of paths) {
        if (this._indexQueuePaths.has(p)) continue;
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          const entry: FileEntry = { path: p, basename: path.basename(p, path.extname(p)), mtime: stat.mtimeMs };
          this._indexQueue.push(entry);
          this._indexQueuePaths.add(p);
        }
      }
      return;
    }

    const files: FileEntry[] = [];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        files.push({ path: p, basename: path.basename(p, path.extname(p)), mtime: stat.mtimeMs });
      }
    }
    if (files.length === 0) { this.onStatus({ state: "idle" }); return; }

    this._running = true;
    this._cancelled = false;
    const total = files.length;
    this.onStatus({ state: "indexing", current: 0, total, label: `${total} file${total === 1 ? "" : "s"}` });

    try {
      const table = await this.db.openTable();
      let processed = 0;
      for (const file of files) {
        if (this._cancelled) break;
        this.onStatus({ state: "indexing", current: processed, total, label: file.basename });
        await table.delete(`file_path = "${escape(file.path)}"`);
        this.fts?.removeByFile(file.path);
        const records = await this.fileToRecords(file);
        if (records.length > 0) await table.add(records);
        for (const r of records) this.fts?.add(r);
        this.mtimeCache.set(file.path, file.mtime);
        processed++;
      }
      console.debug(`[Anamnesis] Batch indexed ${processed} file(s)`);
      this.onStatus({ state: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Anamnesis] indexFiles failed:", message);
      this.onStatus({ state: "error", message });
    } finally {
      this._running = false;
      this._cancelled = false;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    this.mtimeCache.delete(filePath);
    this.fts?.removeByFile(filePath);
    try {
      const table = await this.db.openTable();
      await table.delete(`file_path = "${escape(filePath)}"`);
      console.debug(`[Anamnesis] Deleted chunks for: ${filePath}`);
    } catch (err) {
      console.error(`[Anamnesis] deleteFile failed for ${filePath}:`, err);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getIndexableFiles(): FileEntry[] {
    const results: FileEntry[] = [];
    for (const dir of this.config.watchDirs) {
      if (!fs.existsSync(dir)) continue;
      walkDir(dir, (filePath) => {
        if (!this.isIndexable(filePath)) return;
        const stat = fs.statSync(filePath);
        results.push({
          path: filePath,
          basename: path.basename(filePath, path.extname(filePath)),
          mtime: stat.mtimeMs,
        });
      });
    }
    return results;
  }

  isIndexable(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return false;

    const ft = this.config.fileTypes;
    if (ext === ".md" && !ft.markdown) return false;
    if (ext === ".pdf" && !ft.pdf) return false;
    if (ext === ".docx" && !ft.docx) return false;
    if ((ext === ".html" || ext === ".htm") && !ft.html) return false;

    const fpNorm = filePath.replace(/\\/g, "/");

    // Global exclude patterns
    if (this.config.excludePatterns.some((pattern) => {
      const rel = path.relative(this.config.watchDirs[0] ?? "/", filePath);
      const patNorm = pattern.replace(/\\/g, "/");
      return minimatch(rel, pattern, { matchBase: true }) || fpNorm.includes(`/${patNorm}/`);
    })) return false;

    // Per-dir exclude patterns
    for (const [dir, patterns] of Object.entries(this.config.dirExcludePatterns ?? {}) as [string, string[]][]) {
      if (!fpNorm.startsWith(dir.replace(/\\/g, "/"))) continue;
      const rel = path.relative(dir, filePath);
      if (patterns.some((pattern) => {
        const patNorm = pattern.replace(/\\/g, "/");
        return minimatch(rel, pattern, { matchBase: true }) || fpNorm.includes(`/${patNorm}/`);
      })) return false;
    }

    return true;
  }

  private async fileToRecords(file: FileEntry): Promise<ChunkRecord[]> {
    const cached = this.mtimeCache.get(file.path);
    if (cached !== undefined && cached === file.mtime) return [];

    const doc = await parseFile(file.path);
    if (!doc) return [];

    const chunks = splitMarkdown(doc.text, this.config.chunkSize, this.config.chunkOverlap);
    if (chunks.length === 0) return [];

    const tags = doc.tags.join(", ");
    const backlinkTitles = this.backlinks.getBacklinkTitles(file.path).slice(0, MAX_BACKLINKS);
    const importanceScore = backlinkTitles.length;
    const backlinkSuffix = backlinkTitles.length > 0 ? ` Linked from: ${backlinkTitles.join(", ")}` : "";

    const title = file.basename;
    const embedTexts = chunks.map((c, idx) => {
      const crumb = c.context_path ? `[${title}] > [${c.context_path}]` : `[${title}]`;
      const crumbTrimmed = crumb.length > BREADCRUMB_MAX_CHARS ? crumb.slice(0, BREADCRUMB_MAX_CHARS - 3) + "..." : crumb;
      const base = `${crumbTrimmed} :: ${c.text}`;
      return idx === 0 ? base + backlinkSuffix : base;
    });

    const vectors: number[][] = [];
    for (let i = 0; i < embedTexts.length; i += EMBED_BATCH_SIZE) {
      if (this._cancelled) return [];
      if (this._paused) {
        this.onStatus({ state: "paused", current: this._indexingCurrent, total: this._indexingTotal });
        await new Promise<void>((resolve) => { this._pauseResolve = resolve; });
        if (this._cancelled) return [];
      }
      vectors.push(...await this.provider.embed(embedTexts.slice(i, i + EMBED_BATCH_SIZE)));
    }

    return chunks.map((chunk, idx) => ({
      id: `${file.path}:${chunk.chunkIndex}`,
      file_path: file.path,
      heading: chunk.heading,
      context_path: chunk.context_path,
      chunk_index: chunk.chunkIndex,
      last_modified: file.mtime,
      text: chunk.text,
      vector: vectors[idx],
      tags,
      importance_score: importanceScore,
      schema_version: SCHEMA_VERSION,
    }));
  }
}

function walkDir(dir: string, cb: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, cb);
    else if (entry.isFile()) cb(full);
  }
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
