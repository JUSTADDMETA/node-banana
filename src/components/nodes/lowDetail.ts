"use client";

/**
 * Low detail when zoomed out.
 *
 * Below the low-detail zoom (25% unless changed) every node draws as a card
 * with its image as a thumbnail (NodeLowDetail), the floating headers are
 * hidden, and React Flow mounts only the nodes and edges in view. Measured
 * with the threshold at 45%, on a 909-node graph at 25% zoom on a 180 Hz
 * display: pans went from about 14 to about 124 screen updates a second and
 * drags from about 28 to about 120.
 *
 * WorkflowCanvas feeds the zoomed-out state from its one store subscription
 * and nodes read it here, so a pan frame runs no per-node selector.
 *
 * On by default; both the switch and the zoom are in Settings › Canvas,
 * kept in localStorage ("node-banana-low-detail", "node-banana-low-detail-zoom").
 * For comparing from the console: __bananaLowDetail(false),
 * __bananaLowDetailZoom(0.3).
 */
import { useSyncExternalStore } from "react";

/** Below this zoom the canvas draws nodes at low detail, unless changed. */
export const LOW_DETAIL_ZOOM = 0.25;

const STORAGE_KEY = "node-banana-low-detail";
const ZOOM_STORAGE_KEY = "node-banana-low-detail-zoom";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function readThreshold(): number {
  try {
    const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    return stored > 0 && stored < 2 ? stored : LOW_DETAIL_ZOOM;
  } catch {
    return LOW_DETAIL_ZOOM;
  }
}

let enabled = typeof window === "undefined" ? true : readEnabled();
let threshold = typeof window === "undefined" ? LOW_DETAIL_ZOOM : readThreshold();
let zoomedOut = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Called by WorkflowCanvas whenever the zoom crosses the low-detail zoom. */
export function setZoomedOut(next: boolean) {
  if (next === zoomedOut) return;
  zoomedOut = next;
  emit();
}

export function setLowDetailEnabled(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Storage unavailable: the switch lasts for this session
  }
  emit();
}

/** The zoom low detail starts below; anything else resets it to LOW_DETAIL_ZOOM. */
export function setLowDetailZoom(next: number) {
  threshold = next > 0 && next < 2 ? next : LOW_DETAIL_ZOOM;
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(threshold));
  } catch {
    // Storage unavailable: the value lasts for this session
  }
  emit();
}

if (typeof window !== "undefined") {
  const w = window as unknown as { __bananaLowDetail: typeof setLowDetailEnabled; __bananaLowDetailZoom: typeof setLowDetailZoom };
  w.__bananaLowDetail = setLowDetailEnabled;
  w.__bananaLowDetailZoom = setLowDetailZoom;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the canvas is zoomed out past the low-detail zoom, with low detail on. */
export function useLowDetail(): boolean {
  return useSyncExternalStore(subscribe, () => enabled && zoomedOut, () => false);
}

/** Whether low detail is switched on, and the zoom it starts below, as they stand. */
export function getLowDetailSettings(): { enabled: boolean; zoom: number } {
  return { enabled, zoom: threshold };
}

/** The zoom low detail starts below. */
export function useLowDetailZoom(): number {
  return useSyncExternalStore(subscribe, () => threshold, () => LOW_DETAIL_ZOOM);
}

/** Whether low detail is switched on at all (zoom aside). */
export function useLowDetailEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled, () => true);
}
