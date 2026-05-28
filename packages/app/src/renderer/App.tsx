import React, { useState, useEffect } from "react";
import { Dashboard } from "./components/Dashboard.js";
import { GraphPanel } from "./components/GraphPanel.js";

type Tab = "dashboard" | "graph";

interface StatusPayload {
  indexStatus?: { state?: string };
}

function headerDotClass(payload: StatusPayload): string {
  const s = payload.indexStatus?.state;
  if (!s || s === "idle") return "idle";
  return s;
}

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [status, setStatus] = useState<StatusPayload>({});

  useEffect(() => {
    void (async () => {
      try { setStatus(await window.anamnesis.getStatus() as StatusPayload); } catch { /* ignore */ }
    })();
    const unsub = window.anamnesis.onStatusUpdate((p) => setStatus(p as StatusPayload));
    return () => { unsub(); };
  }, []);

  return (
    <div className="app">
      <div className="header">
        <div className={`header-status-dot ${headerDotClass(status)}`} />
        <span className="header-title">Anamnesis</span>
      </div>

      <div className="tabs">
        <div className={`tab${tab === "dashboard" ? " active" : ""}`} onClick={() => setTab("dashboard")}>
          Dashboard
        </div>
        <div className={`tab${tab === "graph" ? " active" : ""}`} onClick={() => setTab("graph")}>
          Vector Graph
        </div>
      </div>

      {tab === "dashboard" ? (
        <div className="scroll">
          <Dashboard />
        </div>
      ) : (
        <GraphPanel />
      )}
    </div>
  );
}
