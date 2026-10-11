"use client";

/**
 * Low detail when zoomed out (exp/zoomed-out-low-detail, for trying out).
 *
 * Below LOW_DETAIL_ZOOM every node draws as a card with its image as a
 * thumbnail (NodeLowDetail), the floating headers are hidden, and React Flow
 * mounts only the nodes and edges in view. Measured on a 909-node graph at
 * 25% zoom on a 180 Hz display: pans go from about 15 to about 130 screen
 * updates a second and drags from about 30 to about 155.
 *
 * WorkflowCanvas feeds the zoomed-out state from its one store subscription
 * and nodes read it here, so a pan frame runs no per-node selector.
 *
 * On by default. Turned off (and back on) for comparison with
 * localStorage "node-banana-low-detail" = "off", or at runtime from the
 * console: __bananaLowDetail(false).
 */
import { useSyncExternalStore } from "react";

/** Below this zoom the canvas draws nodes at low detail. */
export const LOW_DETAIL_ZOOM = 0.45;

const STORAGE_KEY = "node-banana-low-detail";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

let enabled = typeof window === "undefined" ? true : readEnabled();
let zoomedOut = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Called by WorkflowCanvas whenever the zoom crosses LOW_DETAIL_ZOOM. */
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

if (typeof window !== "undefined") {
  (window as unknown as { __bananaLowDetail: typeof setLowDetailEnabled }).__bananaLowDetail = setLowDetailEnabled;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the canvas is zoomed out past LOW_DETAIL_ZOOM, with low detail on. */
export function useLowDetail(): boolean {
  return useSyncExternalStore(subscribe, () => enabled && zoomedOut, () => false);
}

/** Whether low detail is switched on at all (zoom aside). */
export function useLowDetailEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled, () => true);
}
