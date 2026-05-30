import React, { useRef, useState, useEffect, useCallback } from "react";
import { UMAP } from "umap-js";

const PALETTE = [
  "#7c8cff","#ff7c8c","#7cffb0","#ffd97c","#c87cff","#7ce8ff",
  "#ff9f7c","#b0ff7c","#ff7ce8","#7cccff","#ffe07c","#a0ffc8",
];
const K = 5;

interface Node { x: number; y: number; path: string; label: string; snippet: string; color: string; }
interface Edge { a: number; b: number; strength: number; }

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function knnEdges(vecs: number[][], k: number): Edge[] {
  const n = vecs.length;
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const sims = [];
    for (let j = 0; j < n; j++) { if (i !== j) sims.push({ j, sim: cosine(vecs[i], vecs[j]) }); }
    sims.sort((a, b) => b.sim - a.sim);
    for (const { j, sim } of sims.slice(0, k)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key) && sim > 0) { seen.add(key); edges.push({ a: i, b: j, strength: sim }); }
    }
  }
  return edges;
}

export function GraphPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState("Click Rebuild to load graph.");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [folderColors, setFolderColors] = useState(new Map<string, string>());
  const [building, setBuilding] = useState(false);

  const stateRef = useRef({ nodes, edges, pan: { x: 0, y: 0 }, zoom: 1, dragging: false, dragStart: { x: 0, y: 0 }, panStart: { x: 0, y: 0 }, hovered: null as Node | null });
  stateRef.current.nodes = nodes;
  stateRef.current.edges = edges;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { nodes, edges, pan, zoom } = stateRef.current;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;

    ctx.clearRect(0, 0, W * devicePixelRatio, H * devicePixelRatio);
    if (nodes.length === 0) return;

    const pad = 48;
    const scaleX = (W - 2*pad) * zoom;
    const scaleY = (H - 2*pad) * zoom;
    const sx = (wx: number) => pad + (wx + pan.x) * scaleX;
    const sy = (wy: number) => pad + (wy + pan.y) * scaleY;

    // Edges
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.strokeStyle = `rgba(150,150,160,${e.strength * 0.35})`;
      ctx.lineWidth = e.strength * 1.5;
      ctx.stroke();
    }

    // Nodes
    const r0 = Math.max(3, Math.min(7, zoom * 5));
    for (const node of nodes) {
      const x = sx(node.x), y = sy(node.y);
      const hov = node === stateRef.current.hovered;
      const r = hov ? r0 * 1.8 : r0;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = hov ? 1 : 0.8;
      ctx.fill();
      if (hov) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(232,232,239,0.9)";
        ctx.font = `${Math.max(10, zoom * 11)}px Inter, sans-serif`;
        ctx.fillText(node.label, x + r + 4, y + 4);
      }
    }
    ctx.globalAlpha = 1;
  }, []);

  // Resize canvas to DPR
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = devicePixelRatio ?? 1;
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx?.scale(dpr, dpr);
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [nodes, edges, draw]);

  // Mouse events
  useEffect(() => {
    const canvas = canvasRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const pad = 48;
      const { zoom, pan } = stateRef.current;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const mx = (e.clientX - rect.left - pad) / ((W - 2*pad) * zoom);
      const my = (e.clientY - rect.top - pad) / ((H - 2*pad) * zoom);
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const newZoom = Math.max(0.2, Math.min(20, zoom * factor));
      stateRef.current.pan = { x: mx - (mx - pan.x) * (newZoom / zoom), y: my - (my - pan.y) * (newZoom / zoom) };
      stateRef.current.zoom = newZoom;
      draw();
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      stateRef.current.dragging = true;
      stateRef.current.dragStart = { x: e.clientX, y: e.clientY };
      stateRef.current.panStart = { ...stateRef.current.pan };
      canvas.style.cursor = "grabbing";
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const { dragging, dragStart, panStart, nodes, zoom } = stateRef.current;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const pad = 48;

      if (dragging) {
        stateRef.current.pan = {
          x: panStart.x + (e.clientX - dragStart.x) / ((W - 2*pad) * zoom),
          y: panStart.y + (e.clientY - dragStart.y) / ((H - 2*pad) * zoom),
        };
        draw();
        return;
      }

      const scaleX = (W - 2*pad) * zoom, scaleY = (H - 2*pad) * zoom;
      const sx = (wx: number) => pad + (wx + stateRef.current.pan.x) * scaleX;
      const sy = (wy: number) => pad + (wy + stateRef.current.pan.y) * scaleY;

      let found: Node | null = null;
      for (const node of nodes) {
        if (Math.hypot(cx - sx(node.x), cy - sy(node.y)) < 10) { found = node; break; }
      }

      if (found !== stateRef.current.hovered) {
        stateRef.current.hovered = found;
        draw();
      }

      if (found && tooltip) {
        const parentRect = wrapRef.current?.getBoundingClientRect();
        tooltip.style.display = "flex";
        tooltip.style.left = `${e.clientX - (parentRect?.left ?? 0) + 14}px`;
        tooltip.style.top = `${e.clientY - (parentRect?.top ?? 0) + 14}px`;
        tooltip.innerHTML = `<span class="tooltip-title">${found.label}</span><span class="tooltip-snippet">${found.snippet}…</span>`;
      } else if (tooltip) {
        tooltip.style.display = "none";
      }
    };

    const onUp = () => { stateRef.current.dragging = false; canvas.style.cursor = "crosshair"; };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draw]);

  const buildGraph = useCallback(async () => {
    setBuilding(true);
    setStatus("Fetching vectors…");
    setNodes([]); setEdges([]);
    stateRef.current.pan = { x: 0, y: 0 };
    stateRef.current.zoom = 1;

    try {
      const rawNodes = await window.anamnesis.getVectors() as { id: string; vector: number[]; text: string }[];
      if (rawNodes.length === 0) { setStatus("No indexed files yet — run re-index first."); setBuilding(false); return; }

      setStatus(`Computing layout for ${rawNodes.length} notes…`);
      const vecs = rawNodes.map((n: { vector: number[] }) => n.vector);

      // Determine folder grouping by finding the first path component that diverges across files
      const allParts = rawNodes.map((n: { id: string }) => n.id.replace(/\\/g, "/").split("/").filter(Boolean));
      let commonDepth = 0;
      if (allParts.length > 1) {
        const minLen = Math.min(...allParts.map((p: string[]) => p.length));
        for (let d = 0; d < minLen; d++) {
          if (allParts.every((p: string[]) => p[d] === allParts[0][d])) commonDepth = d + 1;
          else break;
        }
      }

      let colorIdx = 0;
      const fc = new Map<string, string>();
      const getColor = (fp: string) => {
        const parts = fp.replace(/\\/g, "/").split("/").filter(Boolean);
        const folder = parts[commonDepth] ?? parts[parts.length - 1] ?? "root";
        if (!fc.has(folder)) fc.set(folder, PALETTE[colorIdx++ % PALETTE.length]);
        return fc.get(folder)!;
      };

      const nNeighbors = Math.min(15, Math.max(2, rawNodes.length - 1));
      const umap = new UMAP({ nComponents: 2, nEpochs: 300, nNeighbors, minDist: 0.05 });

      const coords = await umap.fitAsync(vecs, (epoch: number) => {
        if (epoch % 30 === 0) setStatus(`Layout ${Math.round((epoch / 300) * 100)}%…`);
      });

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of coords) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      const rX = maxX - minX || 1, rY = maxY - minY || 1;

      const builtNodes: Node[] = rawNodes.map((n: { id: string; vector: number[]; text: string }, i: number) => ({
        x: (coords[i][0] - minX) / rX,
        y: (coords[i][1] - minY) / rY,
        path: n.id,
        label: n.id.replace(/\.[^.]+$/, "").split("/").pop() ?? n.id,
        snippet: n.text,
        color: getColor(n.id),
      }));

      setStatus("Computing edges…");
      const builtEdges = knnEdges(vecs, K);

      setNodes(builtNodes);
      setEdges(builtEdges);
      setFolderColors(new Map(fc));
      setStatus(`${rawNodes.length} notes · ${builtEdges.length} edges — scroll to zoom, drag to pan`);
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setBuilding(false);
    }
  }, []);

  return (
    <div className="graph-panel">
      <div className="graph-top-bar">
        <span className="graph-status">{status}</span>
        <button className="btn" disabled={building} onClick={() => void buildGraph()}>
          {building ? "Building…" : "Rebuild"}
        </button>
      </div>
      <div className="graph-canvas-wrap" ref={wrapRef}>
        <canvas className="graph-canvas" ref={canvasRef} />
        <div className="graph-tooltip" ref={tooltipRef} style={{ display: "none" }} />
        {folderColors.size > 0 && (
          <div className="graph-legend">
            <div className="legend-title">Folders</div>
            {[...folderColors.entries()].map(([folder, color]) => (
              <div key={folder} className="legend-row">
                <div className="legend-dot" style={{ background: color }} />
                <span className="legend-label">{folder}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
