import React, { useState, useEffect, useRef, useCallback } from "react";

interface DirInfo { path: string; paused: boolean; chunkCount: number; }

interface StatusPayload {
  status?: string;   // CoreStatus: stopped | starting | running | error
  error?: string;    // exit code or error message when status=error
  indexStatus?: { state?: string; current?: number; total?: number; label?: string; count?: number; flushAt?: number; delayMs?: number; message?: string };
  mcpStatus?: string;
  mcpPort?: number;
  chunkCount?: number;
  model?: string;
  embeddingProvider?: string;
  dimension?: number;
}

function statusDotClass(state?: string): string {
  if (!state) return "";
  return { idle: "idle", indexing: "indexing", paused: "paused", error: "error", queued: "queued" }[state] ?? "";
}

function statusText(idx: StatusPayload["indexStatus"]): string {
  if (!idx) return "Ready";
  switch (idx.state) {
    case "idle": return "Ready";
    case "indexing": return idx.label ? `Indexing: ${idx.label}` : `Indexing ${idx.current ?? 0} / ${idx.total ?? 0}`;
    case "paused": return `Paused — ${idx.current ?? 0} / ${idx.total ?? 0}`;
    case "queued": return `${idx.count ?? 0} file${(idx.count ?? 0) === 1 ? "" : "s"} queued`;
    case "error": return `Error: ${idx.message ?? ""}`;
    default: return "Ready";
  }
}

function FolderCard({ dir, onPause, onResume, onReindex, onRemove }: {
  dir: DirInfo;
  onPause: () => void;
  onResume: () => void;
  onReindex: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`folder-card${dir.paused ? " paused" : ""}`}>
      <div className="folder-top">
        <span className="folder-path" title={dir.path}>{dir.path}</span>
        <div className="folder-badges">
          {dir.paused && <span className="badge badge-paused">Paused</span>}
          <span className="badge badge-chunks">{dir.chunkCount.toLocaleString()} chunks</span>
          <button className="btn-remove" onClick={onRemove} title="Remove folder">×</button>
        </div>
      </div>
      <div className="folder-actions">
        {dir.paused
          ? <button className="btn" onClick={onResume} title="Resume monitoring">▶ Resume</button>
          : <button className="btn" onClick={onPause} title="Pause monitoring">⏸ Pause</button>
        }
        <button className="btn" onClick={onReindex} title="Re-index this folder">⟳ Re-index</button>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [payload, setPayload] = useState<StatusPayload>({});
  const [dirs, setDirs] = useState<DirInfo[]>([]);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [reindexError, setReindexError] = useState<string | null>(null);
  const countdownRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const refreshDirs = useCallback(async () => {
    try { setDirs(await window.anamnesis.getDirs() as DirInfo[]); } catch { /* ignore */ }
  }, []);

  const removeDir = useCallback(async (dirPath: string) => {
    try {
      const cfg = await window.anamnesis.getConfig() as { watchDirs?: string[] };
      const updated = (cfg.watchDirs ?? []).filter(d => d !== dirPath);
      await window.anamnesis.saveConfig({ watchDirs: updated });
      await refreshDirs();
    } catch { /* ignore */ }
  }, [refreshDirs]);

  // Bootstrap
  useEffect(() => {
    void (async () => {
      try { setPayload(await window.anamnesis.getStatus() as StatusPayload); } catch { /* ignore */ }
      await refreshDirs();
    })();

    const unsub = window.anamnesis.onStatusUpdate((p) => {
      setPayload(p as StatusPayload);
      // Refresh dir chunk counts after an idle transition
      const idx = (p as StatusPayload).indexStatus;
      if (idx?.state === "idle") void refreshDirs();
    });

    return () => { unsub(); if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [refreshDirs]);

  // Countdown animation for queued state
  useEffect(() => {
    const idx = payload.indexStatus;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (idx?.state === "queued" && idx.flushAt && idx.delayMs && countdownRef.current) {
      const tick = () => {
        const remaining = Math.max(0, idx.flushAt! - Date.now());
        const pct = idx.delayMs! > 0 ? (remaining / idx.delayMs!) * 100 : 0;
        if (countdownRef.current) countdownRef.current.style.width = `${pct}%`;
        if (remaining > 0) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [payload.indexStatus]);

  const daemonStatus = payload.status;            // stopped | starting | running | error | undefined
  const daemonDown = daemonStatus === "error" || daemonStatus === "stopped";
  const daemonStarting = daemonStatus === "starting";
  const idx = payload.indexStatus;
  const state = daemonDown ? "error" : daemonStarting ? "idle" : (idx?.state ?? "idle");
  const mcpRunning = payload.mcpStatus === "running";
  const mcpPort = payload.mcpPort ?? 8868;
  const mcpSnippet = `{
  "mcpServers": {
    "anamnesis": {
      "url": "http://127.0.0.1:${mcpPort}/mcp"
    }
  }
}`;

  const copySnippet = async () => {
    await navigator.clipboard.writeText(mcpSnippet);
    setMcpCopied(true);
    setTimeout(() => setMcpCopied(false), 1500);
  };

  return (
    <>
      {/* ── Status card ─────────────────────────────────────────── */}
      <div className="card">
        <div className="card-label">Status</div>

        {daemonDown ? (
          <>
            <div className="status-row">
              <div className="status-dot error" />
              <span className="status-label" style={{ color: "var(--color-error, #e05)" }}>
                Daemon not running
              </span>
            </div>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              {payload.error ? `Exit code: ${payload.error}` : "Check the log file in Settings → Diagnostics for details."}
            </span>
          </>
        ) : daemonStarting ? (
          <div className="status-row">
            <div className="status-dot idle" />
            <span className="status-label">Starting daemon… (loading model on first run may take a minute)</span>
          </div>
        ) : (
          <>
            <div className="status-row">
              <div className={`status-dot ${statusDotClass(state)}`} />
              <span className="status-label">{statusText(idx)}</span>
            </div>

            {(state === "indexing" || state === "paused") && (
              <div className="progress-wrap">
                <div className="progress-fill" style={{ width: `${idx?.total ? ((idx?.current ?? 0) / idx.total) * 100 : 0}%` }} />
              </div>
            )}

            {state === "queued" && (
              <div className="countdown-wrap">
                <div className="countdown-fill" ref={countdownRef} />
              </div>
            )}
          </>
        )}

        <div className="btn-row">
          {!daemonDown && !daemonStarting && state === "indexing" && (
            <button className="btn" onClick={() => void window.anamnesis.pause()}>⏸ Pause</button>
          )}
          {!daemonDown && !daemonStarting && state === "paused" && (
            <button className="btn btn-primary" onClick={() => void window.anamnesis.resume()}>▶ Resume</button>
          )}
          {!daemonDown && !daemonStarting && (state === "idle" || state === "error") && (
            <button
              className="btn btn-primary"
              disabled={dirs.length === 0}
              title={dirs.length === 0 ? "Add a folder first" : undefined}
              onClick={async () => {
                setReindexError(null);
                try { await window.anamnesis.reindex(); }
                catch (e) { setReindexError(String(e)); }
              }}
            >⟳ Re-index All</button>
          )}
          {!daemonDown && !daemonStarting && state === "queued" && (
            <>
              <button className="btn btn-primary" onClick={() => void window.anamnesis.flush()}>⚡ Index Now</button>
              <button className="btn" onClick={() => void window.anamnesis.reindex()}>⟳ Full Re-index</button>
            </>
          )}
        </div>
        {dirs.length === 0 && !daemonDown && !daemonStarting && (
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Add a folder below to start indexing.</span>
        )}
        {reindexError && <span style={{ fontSize: 11, color: "var(--color-error, #e05)" }}>{reindexError}</span>}
      </div>

      {/* ── Watched folders ──────────────────────────────────────── */}
      <div className="card">
        <div className="card-label">Watched Folders</div>

        {dirs.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>No folders configured. Add a folder below.</span>
        )}

        {dirs.map((d) => (
          <FolderCard
            key={d.path}
            dir={d}
            onPause={() => { void window.anamnesis.pauseDir(d.path).then(refreshDirs); }}
            onResume={() => { void window.anamnesis.resumeDir(d.path).then(refreshDirs); }}
            onReindex={() => { void window.anamnesis.reindexDir(d.path); }}
            onRemove={() => { void removeDir(d.path); }}
          />
        ))}

        <AddFolderRow onAdded={refreshDirs} />
      </div>

      {/* ── MCP server ───────────────────────────────────────────── */}
      <div className="card">
        <div className="card-label">Local Server (MCP)</div>
        <div className="status-row">
          <div className={`status-dot ${mcpRunning ? "running" : "stopped"}`} />
          <span className="status-label">{mcpRunning ? `Listening on :${mcpPort}` : "Not running"}</span>
        </div>
        {mcpRunning && (
          <div className="stat-row">
            <span className="stat-label">URL</span>
            <span className="stat-value" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
              http://localhost:{mcpPort}/mcp
            </span>
          </div>
        )}
        <div className="btn-row">
          {mcpRunning
            ? <button className="btn" onClick={async () => {
                setMcpError(null);
                try { await window.anamnesis.stopMcp(); }
                catch (e) { setMcpError(String(e)); }
              }}>⏹ Stop</button>
            : <button className="btn btn-primary" onClick={async () => {
                setMcpError(null);
                try { await window.anamnesis.startMcp(); }
                catch (e) { setMcpError(String(e)); }
              }}>▶ Start</button>
          }
        </div>
        {mcpError && <span style={{ fontSize: 11, color: "var(--color-error, #e05)" }}>{mcpError}</span>}
        {mcpRunning && (
          <>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Claude Desktop config snippet — click to copy:</span>
            <div
              className={`mcp-snippet${mcpCopied ? " copied" : ""}`}
              onClick={() => void copySnippet()}
              title="Click to copy"
            >
              {mcpCopied ? "Copied!" : mcpSnippet}
            </div>
          </>
        )}
      </div>

      {/* ── Index stats ──────────────────────────────────────────── */}
      <div className="card">
        <div className="card-label">Index</div>
        <div className="stat-row"><span className="stat-label">Chunks</span><span className="stat-value">{(payload.chunkCount ?? 0).toLocaleString()}</span></div>
        <div className="stat-row"><span className="stat-label">Model</span><span className="stat-value">{payload.model?.split("/").pop() ?? "—"}</span></div>
        <div className="stat-row"><span className="stat-label">Provider</span><span className="stat-value">{payload.embeddingProvider === "openai" ? "OpenAI" : "Local (offline)"}</span></div>
        <div className="stat-row"><span className="stat-label">Dimensions</span><span className="stat-value">{payload.dimension ?? "—"}</span></div>
      </div>
    </>
  );
}

function AddFolderRow({ onAdded }: { onAdded: () => void }) {
  const [folderPath, setFolderPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = async () => {
    const selected = await window.anamnesis.openDirDialog();
    if (selected) { setFolderPath(selected); setError(null); }
  };

  const add = async () => {
    const dir = folderPath.trim();
    if (!dir) return;
    setBusy(true);
    setError(null);
    try {
      const cfg = await window.anamnesis.getConfig() as { watchDirs?: string[] };
      const current = cfg.watchDirs ?? [];
      if (!current.includes(dir)) {
        await window.anamnesis.saveConfig({ watchDirs: [...current, dir] });
      }
      setFolderPath("");
      onAdded();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="add-folder-row">
        <input
          className="folder-input"
          placeholder="Add folder path…"
          value={folderPath}
          onChange={(e) => { setFolderPath(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
        />
        <button className="btn btn-icon" onClick={() => void browse()} title="Browse">📁</button>
        <button className="btn btn-primary" onClick={() => void add()} disabled={!folderPath.trim() || busy}>
          {busy ? "…" : "Add"}
        </button>
      </div>
      {error && <span style={{ fontSize: 11, color: "var(--color-error, #e05)", display: "block", marginTop: 4 }}>{error}</span>}
    </div>
  );
}
