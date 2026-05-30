import React, { useState, useRef, useCallback } from "react";

interface SearchResult {
  file_path: string;
  heading: string;
  context_path: string;
  chunk_index: number;
  text: string;
  tags: string;
  importance_score: number;
  match_sources: ("semantic" | "bm25")[];
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function friendlyName(filePath: string): string {
  return filePath.replace(/\.[^.]+$/, "").replace(/\\/g, "/").split("/").pop() ?? filePath;
}

function ResultCard({ filePath, chunks }: { filePath: string; chunks: SearchResult[] }) {
  const sources = chunks[0].match_sources;
  const hasSemantic = sources.includes("semantic");
  const hasKeyword = sources.includes("bm25");

  return (
    <div className="card" style={{ marginBottom: 8, cursor: "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <a
          href="#"
          style={{ fontWeight: 600, fontSize: 13, color: "var(--text-normal)", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={filePath}
          onClick={(e) => { e.preventDefault(); void window.anamnesis.openFileFolder(filePath); }}
        >
          {friendlyName(filePath)}
        </a>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {hasSemantic && (
            <span className="badge" style={{ background: "var(--color-accent, #7c8cff)", color: "#fff", fontFamily: "var(--font-mono)", fontSize: 10, padding: "1px 5px" }} title="Semantic match">S</span>
          )}
          {hasKeyword && (
            <span className="badge" style={{ background: "var(--color-success, #3a3)", color: "#fff", fontFamily: "var(--font-mono)", fontSize: 10, padding: "1px 5px" }} title="Keyword match">K</span>
          )}
        </div>
      </div>
      {chunks.slice(0, 2).map((chunk, i) => (
        <div key={i} style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>
          {chunk.context_path && (
            <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>{chunk.context_path} — </span>
          )}
          <span>{truncate(chunk.text, 160)}</span>
        </div>
      ))}
    </div>
  );
}

export function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); setStatus(""); return; }
    setStatus("Searching…");
    try {
      const hits = await window.anamnesis.search(trimmed) as SearchResult[];
      setResults(hits);
      setStatus(hits.length === 0 ? "No results." : `${hits.length} result${hits.length !== 1 ? "s" : ""}`);
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    }
  }, []);

  const onInput = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(value), 400);
  };

  // Group by file, preserve result order
  const byFile = new Map<string, SearchResult[]>();
  for (const hit of results) {
    const arr = byFile.get(hit.file_path) ?? [];
    arr.push(hit);
    byFile.set(hit.file_path, arr);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Input bar */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color, #333)" }}>
        <input
          className="folder-input"
          style={{ width: "100%", fontSize: 13, boxSizing: "border-box" }}
          placeholder="Search your vault…"
          value={query}
          autoFocus
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              void runSearch(query);
            }
          }}
        />
      </div>

      {/* Status */}
      {status && (
        <div style={{ padding: "4px 12px", fontSize: 11, color: "var(--text-faint)" }}>{status}</div>
      )}

      {/* Results */}
      <div className="scroll" style={{ flex: 1, padding: "8px 12px" }}>
        {[...byFile.entries()].map(([fp, chunks]) => (
          <ResultCard key={fp} filePath={fp} chunks={chunks} />
        ))}
      </div>
    </div>
  );
}
