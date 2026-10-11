import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PerfOverlay, setPerfOverlayVisible, getPerfOverlayVisible, summarizeFrames } from "@/components/PerfOverlay";

const VSYNC = 1000 / 180;

/** Frames newest first, from gaps oldest first: [gaps, end times]. */
function frames(gapsOldestFirst: number[]): [number[], number[]] {
  const ends: number[] = [];
  let t = 0;
  for (const gap of gapsOldestFirst) ends.push((t += gap));
  return [[...gapsOldestFirst].reverse(), ends.reverse()];
}

describe("summarizeFrames", () => {
  it("reads a steady display rate with nothing dropped", () => {
    const [gaps, ends] = frames(new Array(360).fill(VSYNC));
    const summary = summarizeFrames(gaps, ends, VSYNC)!;
    expect(summary.fps).toBeCloseTo(180, 0);
    expect(summary.p50).toBeCloseTo(VSYNC);
    expect(summary.p95).toBeCloseTo(VSYNC);
    expect(summary.dropped).toBe(0);
    expect(summary.low1s).toBe(180);
  });

  it("counts the display intervals a slow frame spans beyond its own as dropped", () => {
    // 100 good frames, then one that took four intervals
    const [gaps, ends] = frames([...new Array(100).fill(VSYNC), 4 * VSYNC]);
    const summary = summarizeFrames(gaps, ends, VSYNC)!;
    expect(summary.dropped).toBe(3);
    expect(summary.droppedPct).toBeCloseTo((3 / 104) * 100);
    expect(summary.worst).toBeCloseTo(4 * VSYNC);
  });

  it("puts slow frames in the upper percentiles", () => {
    const [gaps, ends] = frames([...new Array(90).fill(5), ...new Array(10).fill(50)]);
    const summary = summarizeFrames(gaps, ends, 5)!;
    expect(summary.p50).toBe(5);
    expect(summary.p95).toBe(50);
    expect(summary.worst).toBe(50);
  });

  it("has nothing to say about fewer than two frames", () => {
    expect(summarizeFrames([5], [5], 5)).toBeNull();
  });
});

describe("PerfOverlay", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => setPerfOverlayVisible(false));
  });

  it("shows when switched on, remembers it, and hides from its own close button", () => {
    render(
      <ReactFlowProvider>
        <PerfOverlay />
      </ReactFlowProvider>
    );
    expect(document.querySelector("[data-perf-overlay]")).toBeNull();
    act(() => setPerfOverlayVisible(true));
    expect(document.querySelector("[data-perf-overlay]")).not.toBeNull();
    expect(localStorage.getItem("node-banana-perf-overlay")).toBe("on");
    fireEvent.click(screen.getByRole("button", { name: "Hide performance overlay" }));
    expect(document.querySelector("[data-perf-overlay]")).toBeNull();
    expect(getPerfOverlayVisible()).toBe(false);
  });
});
