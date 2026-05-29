import chokidar, { type FSWatcher } from "chokidar";
import path from "path";
import { IndexingEngine } from "./indexer.js";
import type { AnamnesisConfig } from "./config.js";

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private indexer: IndexingEngine;
  private config: AnamnesisConfig;

  private pendingModify = new Set<string>();
  private pendingDelete = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pausedDirs = new Set<string>();

  constructor(indexer: IndexingEngine, config: AnamnesisConfig) {
    this.indexer = indexer;
    this.config = config;
  }

  get isRunning(): boolean {
    return this.watcher !== null;
  }

  pauseDir(dir: string): void {
    this.pausedDirs.add(this.normalizeDir(dir));
  }

  resumeDir(dir: string): void {
    this.pausedDirs.delete(this.normalizeDir(dir));
  }

  pauseAll(): void {
    for (const d of this.config.watchDirs) this.pausedDirs.add(this.normalizeDir(d));
  }

  resumeAll(): void {
    this.pausedDirs.clear();
  }

  isDirPaused(dir: string): boolean {
    return this.pausedDirs.has(this.normalizeDir(dir));
  }

  private normalizeDir(dir: string): string {
    return dir.endsWith(path.sep) ? dir : dir + path.sep;
  }

  private isPathPaused(filePath: string): boolean {
    for (const d of this.pausedDirs) {
      if (filePath.startsWith(d)) return true;
    }
    return false;
  }

  addDir(dir: string): void {
    if (this.watcher) {
      this.watcher.add(dir);
      console.debug("[Anamnesis] File watcher: added dir", dir);
    }
  }

  start(): void {
    if (this.watcher) return;

    const ignored = [
      /(^|[/\\])\../, // dotfiles
      ...this.config.excludePatterns.map((p) => `**/${p}/**`),
    ];

    this.watcher = chokidar.watch(this.config.watchDirs, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    this.watcher
      .on("add", (filePath) => { if (this.indexer.isIndexable(filePath) && !this.isPathPaused(filePath)) this.enqueueModify(filePath); })
      .on("change", (filePath) => { if (this.indexer.isIndexable(filePath) && !this.isPathPaused(filePath)) this.enqueueModify(filePath); })
      .on("unlink", (filePath) => { if (this.indexer.isIndexable(filePath) && !this.isPathPaused(filePath)) this.enqueueDelete(filePath); })
      .on("addDir", () => {})
      .on("unlinkDir", () => {})
      .on("error", (err) => console.error("[Anamnesis] Watcher error:", err));

    console.debug("[Anamnesis] File watcher started on:", this.config.watchDirs);
  }

  flushNow(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.pendingModify.size > 0 || this.pendingDelete.size > 0) void this.flush();
  }

  async stop(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.pendingModify.clear();
    this.pendingDelete.clear();
    if (this.watcher) { await this.watcher.close(); this.watcher = null; }
    console.debug("[Anamnesis] File watcher stopped");
  }

  private enqueueModify(filePath: string): void {
    this.pendingDelete.delete(filePath);
    this.pendingModify.add(filePath);
    const { flushAt, delayMs } = this.scheduleFlush();
    this.indexer.setQueued(this.pendingModify.size + this.pendingDelete.size, flushAt, delayMs);
  }

  private enqueueDelete(filePath: string): void {
    this.pendingModify.delete(filePath);
    this.pendingDelete.add(filePath);
    const { flushAt, delayMs } = this.scheduleFlush();
    this.indexer.setQueued(this.pendingModify.size + this.pendingDelete.size, flushAt, delayMs);
  }

  private scheduleFlush(): { flushAt: number; delayMs: number } {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    const delayMs = this.config.indexingDebounceMs;
    const flushAt = Date.now() + delayMs;
    this.flushTimer = setTimeout(() => void this.flush(), delayMs);
    return { flushAt, delayMs };
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    const toModify = [...this.pendingModify];
    const toDelete = [...this.pendingDelete];
    this.pendingModify.clear();
    this.pendingDelete.clear();

    for (const p of toDelete) await this.indexer.deleteFile(p);
    if (toModify.length > 0) await this.indexer.indexFiles(toModify);
    else this.indexer.setQueued(0);
  }
}
