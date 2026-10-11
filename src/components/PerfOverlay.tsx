"use client";

/**
 * Performance overlay: frame rate now, frame rate over the last 10 seconds, frame-time percentiles,
 * dropped frames and long frames, and the same figures for the last pan or
 * drag, so a change can be judged by what it does on screen.
 *
 * Frames are timed with requestAnimationFrame, which runs once per frame
 * the main thread renders: when the main thread is too busy to keep up with
 * the display, the gaps between them grow and the vsyncs they span count as
 * dropped. The display's rate is taken from the shortest steady gaps.
 *
 * Shown from Settings › Canvas, or __bananaFps(true) in the console; kept
 * in localStorage "node-banana-perf-overlay". It touches the DOM only for
 * its own panel: text four times a second, the graph ten.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useStoreApi } from "@xyflow/react";
import { getLowDetailSettings } from "./nodes/lowDetail";

const STORAGE_KEY = "node-banana-perf-overlay";
const WINDOW_MS = 10_000;
const STATS_MS = 5_000;
const CAPACITY = 8192;
const RATES = [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 360];

let visible = (() => {
  try {
    return typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export function setPerfOverlayVisible(next: boolean) {
  visible = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Storage unavailable: lasts for this session
  }
  for (const listener of listeners) listener();
}

export function getPerfOverlayVisible(): boolean {
  return visible;
}

if (typeof window !== "undefined") {
  (window as unknown as { __bananaFps: typeof setPerfOverlayVisible }).__bananaFps = setPerfOverlayVisible;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function usePerfOverlayVisible(): boolean {
  return useSyncExternalStore(subscribe, () => visible, () => false);
}

export interface FrameSummary {
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  dropped: number;
  droppedPct: number;
  low1s: number;
}

function percentile(sorted: Float64Array, p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

/** Frame figures for the frames ending in [from, to], read from the ring buffers. */
function summarize(times: Float64Array, gaps: Float64Array, count: number, head: number, from: number, to: number, vsync: number): FrameSummary | null {
  const picked: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < count; i++) {
    const index = (head - 1 - i + CAPACITY) % CAPACITY;
    const t = times[index];
    if (t < from) break;
    if (t > to) continue;
    picked.push(gaps[index]);
    ends.push(t);
  }
  return summarizeFrames(picked, ends, vsync);
}

/**
 * Frame figures for frames given newest first: each frame's gap since the
 * one before (ms) and the time it ended. A gap spanning n display intervals
 * dropped n - 1 frames.
 */
export function summarizeFrames(picked: number[], ends: number[], vsync: number): FrameSummary | null {
  if (picked.length < 2) return null;
  const sorted = Float64Array.from(picked).sort();
  const span = ends[0] - ends[ends.length - 1] + picked[picked.length - 1];
  let dropped = 0;
  for (const gap of picked) dropped += Math.max(0, Math.round(gap / vsync) - 1);
  // The slowest second: fewest frames in any whole second, counted back from the newest
  let low1s = Infinity;
  const seconds = Math.floor(span / 1000);
  if (seconds >= 1) {
    const perSecond = new Array<number>(seconds).fill(0);
    for (const t of ends) {
      const bucket = Math.floor((ends[0] - t) / 1000);
      if (bucket < seconds) perSecond[bucket]++;
    }
    low1s = Math.min(...perSecond);
  }
  return {
    fps: (picked.length / span) * 1000,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    worst: sorted[sorted.length - 1],
    dropped,
    droppedPct: (dropped / (picked.length + dropped)) * 100,
    low1s: Number.isFinite(low1s) ? low1s : (picked.length / span) * 1000,
  };
}

const fmt = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : "–");

function Panel() {
  const flowStore = useStoreApi();
  const fpsRef = useRef<HTMLSpanElement>(null);
  const hzRef = useRef<HTMLSpanElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    const times = new Float64Array(CAPACITY);
    const gaps = new Float64Array(CAPACITY);
    let head = 0;
    let count = 0;
    let last = 0;
    let frame = 0;
    let vsync = 1000 / 60;
    // Gestures: spans while <html> carries canvas-interacting
    const spans: { start: number; end: number | null; drag: boolean }[] = [];
    let lastGesture: { kind: string; ms: number; summary: FrameSummary | null } | null = null;
    const longFrames: { t: number; ms: number }[] = [];

    resetRef.current = () => {
      head = 0;
      count = 0;
      last = 0;
      spans.length = 0;
      longFrames.length = 0;
      lastGesture = null;
    };

    const tick = (t: number) => {
      if (last) {
        times[head] = t;
        gaps[head] = t - last;
        head = (head + 1) % CAPACITY;
        count = Math.min(count + 1, CAPACITY);
        const open = spans[spans.length - 1];
        if (open && open.end === null && document.querySelector(".react-flow__node.dragging")) open.drag = true;
      }
      last = t;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const root = document.documentElement;
    let interacting = root.classList.contains("canvas-interacting");
    const observer = new MutationObserver(() => {
      const now = root.classList.contains("canvas-interacting");
      if (now === interacting) return;
      interacting = now;
      const t = performance.now();
      if (now) {
        spans.push({ start: t, end: null, drag: false });
        if (spans.length > 50) spans.shift();
      } else {
        const span = spans[spans.length - 1];
        if (span && span.end === null) {
          span.end = t;
          lastGesture = { kind: span.drag ? "drag" : "pan/zoom", ms: t - span.start, summary: summarize(times, gaps, count, head, span.start, t, vsync) };
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    let loaf: PerformanceObserver | null = null;
    try {
      loaf = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longFrames.push({ t: entry.startTime + entry.duration, ms: entry.duration });
        while (longFrames.length > 200) longFrames.shift();
      });
      loaf.observe({ type: "long-animation-frame", buffered: false });
    } catch {
      loaf = null;
    }

    const estimateVsync = (now: number) => {
      // The display's interval: the shortest steady gaps, snapped to a common rate
      const recent: number[] = [];
      for (let i = 0; i < count && recent.length < 1200; i++) {
        const index = (head - 1 - i + CAPACITY) % CAPACITY;
        if (times[index] < now - WINDOW_MS) break;
        recent.push(gaps[index]);
      }
      if (recent.length < 30) return;
      recent.sort((a, b) => a - b);
      const fast = recent[Math.floor(recent.length * 0.1)];
      const hz = RATES.reduce((best, rate) => (Math.abs(1000 / rate - fast) < Math.abs(1000 / best - fast) ? rate : best), 60);
      vsync = 1000 / hz;
    };

    const drawGraph = (now: number) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const hz = 1000 / vsync;
      const top = hz * 1.1;
      const x = (t: number) => width - ((now - t) / WINDOW_MS) * width;
      const y = (fps: number) => height - (Math.min(fps, top) / top) * height;
      // Gestures, shaded
      context.fillStyle = "rgba(96, 165, 250, 0.14)";
      for (const span of spans) {
        const end = span.end ?? now;
        if (end < now - WINDOW_MS) continue;
        context.fillRect(x(Math.max(span.start, now - WINDOW_MS)), 0, x(end) - x(Math.max(span.start, now - WINDOW_MS)), height);
      }
      // Reference lines: the display's rate and 60
      context.strokeStyle = "rgba(255,255,255,0.18)";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      for (const fps of [hz, 60]) {
        if (fps > top) continue;
        context.beginPath();
        context.moveTo(0, Math.round(y(fps)) + 0.5);
        context.lineTo(width, Math.round(y(fps)) + 0.5);
        context.stroke();
      }
      context.setLineDash([]);
      // Each frame as its instantaneous rate, coloured by how close to the display it kept
      let worst: { t: number; gap: number } | null = null;
      for (let i = 0; i < count; i++) {
        const index = (head - 1 - i + CAPACITY) % CAPACITY;
        const t = times[index];
        if (t < now - WINDOW_MS) break;
        const gap = gaps[index];
        const fps = 1000 / gap;
        if (!worst || gap > worst.gap) worst = { t, gap };
        context.strokeStyle = fps >= hz * 0.9 ? "#4ade80" : fps >= hz * 0.5 ? "#facc15" : "#f87171";
        const x1 = x(t), x0 = Math.max(0, x(t - gap));
        context.beginPath();
        context.moveTo(x0, y(fps));
        context.lineTo(x1, y(fps));
        context.stroke();
      }
      // The worst frame in view
      if (worst) {
        context.fillStyle = "#f87171";
        context.beginPath();
        context.arc(x(worst.t), y(1000 / worst.gap), 3, 0, Math.PI * 2);
        context.fill();
        context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(`${Math.round(worst.gap)} ms`, Math.min(width - 40, Math.max(2, x(worst.t) + 5)), Math.min(height - 3, y(1000 / worst.gap) + 12));
      }
    };

    const writeText = (now: number) => {
      const stats = summarize(times, gaps, count, head, now - STATS_MS, now, vsync);
      const quick = summarize(times, gaps, count, head, now - 500, now, vsync);
      if (fpsRef.current) fpsRef.current.textContent = quick ? Math.round(quick.fps).toString() : "–";
      if (hzRef.current) hzRef.current.textContent = `display ${Math.round(1000 / vsync)} Hz`;
      const recentLong = longFrames.filter((f) => f.t >= now - STATS_MS);
      const worstLong = recentLong.reduce((m, f) => Math.max(m, f.ms), 0);
      if (windowRef.current) {
        windowRef.current.textContent = stats
          ? `last 5 s  ${fmt(stats.fps, 0)} fps · slowest 1 s ${fmt(stats.low1s, 0)}\n` +
            `frame ms  p50 ${fmt(stats.p50)}  p95 ${fmt(stats.p95)}  p99 ${fmt(stats.p99)}  max ${fmt(stats.worst, 0)}\n` +
            `dropped   ${stats.dropped} (${fmt(stats.droppedPct, 0)}%) · long frames ${recentLong.length}${recentLong.length ? ` (max ${Math.round(worstLong)} ms)` : ""}`
          : "collecting…";
      }
      if (gestureRef.current) {
        const g = lastGesture;
        gestureRef.current.textContent = g?.summary
          ? `last ${g.kind} (${fmt(g.ms / 1000)} s)  ${fmt(g.summary.fps, 0)} fps\n` +
            `frame ms  p50 ${fmt(g.summary.p50)}  p95 ${fmt(g.summary.p95)}  p99 ${fmt(g.summary.p99)}  max ${fmt(g.summary.worst, 0)}\n` +
            `dropped   ${g.summary.dropped} (${fmt(g.summary.droppedPct, 0)}%)`
          : "last pan/drag  –  (pan or drag the canvas)";
      }
      if (contextRef.current) {
        const zoom = flowStore.getState().transform[2];
        const lowDetail = getLowDetailSettings();
        const active = lowDetail.enabled && zoom < lowDetail.zoom;
        const nodes = document.querySelectorAll(".react-flow__node").length;
        const edges = document.querySelectorAll(".react-flow__edge").length;
        contextRef.current.textContent =
          `zoom ${Math.round(zoom * 100)}% · low detail ${lowDetail.enabled ? (active ? "ON" : `off above ${Math.round(lowDetail.zoom * 100)}%`) : "disabled"}\n` +
          `mounted ${nodes} nodes · ${edges} edges`;
      }
    };

    let textTimer = 0;
    let graphTimer = 0;
    textTimer = window.setInterval(() => {
      const now = performance.now();
      estimateVsync(now);
      writeText(now);
    }, 250);
    graphTimer = window.setInterval(() => drawGraph(performance.now()), 100);

    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(textTimer);
      window.clearInterval(graphTimer);
      observer.disconnect();
      loaf?.disconnect();
    };
  }, [flowStore]);

  const line = "whitespace-pre font-mono text-[11px] leading-[15px] text-neutral-300";
  return (
    <div
      data-perf-overlay
      className="fixed bottom-4 left-4 z-[60] w-[310px] select-none rounded-lg border border-neutral-700 bg-neutral-900/95 p-2.5 shadow-lg"
      style={{ contain: "layout paint" }}
    >
      <div className="flex items-baseline gap-2">
        <span ref={fpsRef} className="font-mono text-2xl font-semibold text-neutral-50 tabular-nums">–</span>
        <span className="text-xs text-neutral-400">fps</span>
        <span ref={hzRef} className="ml-auto text-[11px] text-neutral-500" />
        <button type="button" onClick={() => resetRef.current()} className="text-[11px] text-neutral-400 hover:text-neutral-100">Reset</button>
        <button type="button" aria-label="Hide performance overlay" onClick={() => setPerfOverlayVisible(false)} className="text-sm leading-none text-neutral-400 hover:text-neutral-100">×</button>
      </div>
      <canvas ref={canvasRef} className="mt-1.5 block h-20 w-full rounded bg-neutral-950" />
      <div className="mt-0.5 flex justify-between text-[10px] text-neutral-500"><span>10 s ago</span><span>blue: pan/drag · red dot: slowest frame</span><span>now</span></div>
      <div ref={windowRef} className={`${line} mt-1.5`} />
      <div ref={gestureRef} className={`${line} mt-1.5 border-t border-neutral-800 pt-1.5 text-neutral-100`} />
      <div ref={contextRef} className={`${line} mt-1.5 border-t border-neutral-800 pt-1.5 text-neutral-400`} />
    </div>
  );
}

/** The overlay, when switched on. */
export function PerfOverlay() {
  const shown = usePerfOverlayVisible();
  if (!shown || typeof document === "undefined") return null;
  return createPortal(<Panel />, document.body);
}
