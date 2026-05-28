import React, { useState, useEffect } from "react";

interface FileTypes { markdown: boolean; pdf: boolean; docx: boolean; html: boolean; }

interface AnamnesisConfig {
  watchDirs: string[];
  embeddingProvider: "local" | "openai";
  localModelName: string;
  openaiApiKey?: string;
  openaiModelName?: string;
  chunkSize: number;
  chunkOverlap: number;
  excludePatterns: string[];
  autoIndexOnChange: boolean;
  indexingDebounceMs: number;
  fileTypes: FileTypes;
  hybridSearch: boolean;
  importanceWeight: number;
  mcpEnabled: boolean;
  mcpPort: number;
}

const LOCAL_MODELS = [
  { value: "Xenova/all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2 (384d, fast)" },
  { value: "Xenova/all-mpnet-base-v2", label: "all-mpnet-base-v2 (768d, better quality)" },
  { value: "Xenova/paraphrase-MiniLM-L3-v2", label: "paraphrase-MiniLM-L3-v2 (384d, fastest)" },
];

const OPENAI_MODELS = [
  { value: "text-embedding-3-small", label: "text-embedding-3-small" },
  { value: "text-embedding-3-large", label: "text-embedding-3-large" },
  { value: "text-embedding-ada-002", label: "text-embedding-ada-002 (legacy)" },
];

const DEBOUNCE_OPTIONS = [
  { value: 500,   label: "0.5 s" },
  { value: 1000,  label: "1 s" },
  { value: 2000,  label: "2 s" },
  { value: 5000,  label: "5 s (default)" },
  { value: 10000, label: "10 s" },
  { value: 30000, label: "30 s" },
];

const FILE_TYPES: { key: keyof FileTypes; ext: string }[] = [
  { key: "markdown", ext: ".md" },
  { key: "pdf",      ext: ".pdf" },
  { key: "docx",     ext: ".docx" },
  { key: "html",     ext: ".html" },
];

export function Settings() {
  const [config, setConfig] = useState<AnamnesisConfig | null>(null);
  const [draft,  setDraft]  = useState<AnamnesisConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState<{ text: string; ok: boolean } | null>(null);

  const dirty = config !== null && draft !== null
    && JSON.stringify(config) !== JSON.stringify(draft);

  useEffect(() => {
    void (async () => {
      try {
        const c = await window.anamnesis.getConfig() as AnamnesisConfig;
        setConfig(c);
        setDraft(c);
      } catch (e) {
        setMsg({ text: `Could not load config: ${String(e)}`, ok: false });
      }
    })();
  }, []);

  function patch<K extends keyof AnamnesisConfig>(key: K, value: AnamnesisConfig[K]) {
    setDraft(d => d ? { ...d, [key]: value } : d);
  }

  function patchFileTypes(ft: Partial<FileTypes>) {
    setDraft(d => d ? { ...d, fileTypes: { ...d.fileTypes, ...ft } } : d);
  }

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      await window.anamnesis.saveConfig(draft);
      setConfig({ ...draft });
      setMsg({ text: "Saved!", ok: true });
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg({ text: `Save failed: ${String(e)}`, ok: false });
    }
    setSaving(false);
  };

  const revert = () => { if (config) { setDraft({ ...config }); setMsg(null); } };

  if (!draft) {
    return (
      <div className="settings-shell">
        <div className="scroll">
          <div className="settings-placeholder">{msg?.text ?? "Loading config…"}</div>
        </div>
      </div>
    );
  }

  const isCustomModel = !LOCAL_MODELS.find(m => m.value === draft.localModelName);

  return (
    <div className="settings-shell">
      <div className="scroll">

        {/* ── Embedding ───────────────────────────────────────────── */}
        <div className="card">
          <div className="card-label">Embedding</div>

          <div className="form-row">
            <span className="form-label">Provider</span>
            <div className="radio-group">
              <label className="radio-option">
                <input type="radio" name="s-provider" value="local"
                  checked={draft.embeddingProvider === "local"}
                  onChange={() => patch("embeddingProvider", "local")} />
                Local (offline)
              </label>
              <label className="radio-option">
                <input type="radio" name="s-provider" value="openai"
                  checked={draft.embeddingProvider === "openai"}
                  onChange={() => patch("embeddingProvider", "openai")} />
                OpenAI
              </label>
            </div>
          </div>

          {draft.embeddingProvider === "local" && (
            <div className="form-row">
              <div className="form-label-stack">
                <span className="form-label">Model</span>
                <span className="form-hint">Requires re-index if changed</span>
              </div>
              <select className="select-input"
                value={isCustomModel ? "__custom__" : draft.localModelName}
                onChange={e => { if (e.target.value !== "__custom__") patch("localModelName", e.target.value); }}>
                {LOCAL_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                {isCustomModel && <option value="__custom__">{draft.localModelName} (custom)</option>}
              </select>
            </div>
          )}

          {draft.embeddingProvider === "openai" && (
            <>
              <div className="form-row">
                <span className="form-label">API key</span>
                <input type="password" className="text-input" placeholder="sk-…"
                  value={draft.openaiApiKey ?? ""}
                  onChange={e => patch("openaiApiKey", e.target.value)} />
              </div>
              <div className="form-row">
                <div className="form-label-stack">
                  <span className="form-label">Model</span>
                  <span className="form-hint">Requires re-index if changed</span>
                </div>
                <select className="select-input"
                  value={draft.openaiModelName ?? "text-embedding-3-small"}
                  onChange={e => patch("openaiModelName", e.target.value)}>
                  {OPENAI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </>
          )}
        </div>

        {/* ── Indexing ─────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-label">Indexing</div>

          <div className="form-row">
            <span className="form-label">Chunk size</span>
            <div className="slider-row">
              <input type="range" className="slider" min={128} max={2048} step={64}
                value={draft.chunkSize}
                onChange={e => patch("chunkSize", Number(e.target.value))} />
              <span className="slider-val">{draft.chunkSize}</span>
            </div>
          </div>

          <div className="form-row">
            <span className="form-label">Overlap</span>
            <div className="slider-row">
              <input type="range" className="slider" min={0} max={256} step={16}
                value={draft.chunkOverlap}
                onChange={e => patch("chunkOverlap", Number(e.target.value))} />
              <span className="slider-val">{draft.chunkOverlap}</span>
            </div>
          </div>

          <div className="form-row">
            <span className="form-label">Debounce</span>
            <select className="select-input"
              value={draft.indexingDebounceMs}
              onChange={e => patch("indexingDebounceMs", Number(e.target.value))}>
              {DEBOUNCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-row">
            <span className="form-label">File types</span>
            <div className="checkbox-group">
              {FILE_TYPES.map(({ key, ext }) => (
                <label key={key} className="checkbox-option">
                  <input type="checkbox"
                    checked={draft.fileTypes[key]}
                    onChange={e => patchFileTypes({ [key]: e.target.checked })} />
                  {ext}
                </label>
              ))}
            </div>
          </div>

          <div className="form-row">
            <span className="form-label">Auto-index on change</span>
            <label className="toggle">
              <input type="checkbox"
                checked={draft.autoIndexOnChange}
                onChange={e => patch("autoIndexOnChange", e.target.checked)} />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        {/* ── Exclude Patterns ─────────────────────────────────────── */}
        <div className="card">
          <div className="card-label">Exclude Patterns</div>
          <span className="form-hint-block">One glob pattern per line (.git, node_modules, etc.)</span>
          <textarea className="textarea-input" rows={4}
            value={draft.excludePatterns.join("\n")}
            onChange={e => patch("excludePatterns", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
          />
        </div>

        {/* ── Search ───────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-label">Search</div>

          <div className="form-row">
            <div className="form-label-stack">
              <span className="form-label">Hybrid search</span>
              <span className="form-hint">BM25 + vector via RRF</span>
            </div>
            <label className="toggle">
              <input type="checkbox"
                checked={draft.hybridSearch}
                onChange={e => patch("hybridSearch", e.target.checked)} />
              <span className="toggle-track" />
            </label>
          </div>

          <div className="form-row">
            <div className="form-label-stack">
              <span className="form-label">Backlink boost</span>
              <span className="form-hint">Importance weight</span>
            </div>
            <div className="slider-row">
              <input type="range" className="slider" min={0} max={0.5} step={0.01}
                value={draft.importanceWeight}
                onChange={e => patch("importanceWeight", Number(e.target.value))} />
              <span className="slider-val">{draft.importanceWeight.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* ── MCP ──────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-label">MCP Server</div>

          <div className="form-row">
            <span className="form-label">Enable on startup</span>
            <label className="toggle">
              <input type="checkbox"
                checked={draft.mcpEnabled}
                onChange={e => patch("mcpEnabled", e.target.checked)} />
              <span className="toggle-track" />
            </label>
          </div>

          <div className="form-row">
            <div className="form-label-stack">
              <span className="form-label">Port</span>
              <span className="form-hint">MCP on this port, mgmt on +1</span>
            </div>
            <input type="number" className="text-input text-input-sm"
              min={1024} max={65535}
              value={draft.mcpPort}
              onChange={e => patch("mcpPort", Number(e.target.value))} />
          </div>
        </div>

        <div style={{ height: 52 }} />
      </div>

      {/* ── Save bar ─────────────────────────────────────────────── */}
      <div className={`save-bar${(dirty || msg) ? " visible" : ""}`}>
        {msg
          ? <span className={`save-msg${msg.ok ? " ok" : " err"}`}>{msg.text}</span>
          : dirty
            ? <span className="save-msg">Unsaved changes</span>
            : null
        }
        <div style={{ flex: 1 }} />
        {dirty && (
          <button className="btn" onClick={revert} disabled={saving}>Revert</button>
        )}
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
