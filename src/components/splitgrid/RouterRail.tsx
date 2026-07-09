"use client";

/**
 * Downstream-router rail — a fixed overlay pinned to the right edge of the cell
 * node set editor (it does not pan or zoom with the canvas). Users drag any
 * terminal's output onto it; each wired type grows a colored socket with a
 * label, and a rounded bracket groups them with a "Router" caption beneath. An
 * empty gray socket at the bottom is the persistent drop target.
 *
 * The rail is NOT a React Flow node, so its edges are drawn here: each wire runs
 * from the terminal's output handle (converted from flow to pane coordinates via
 * the live viewport) to its type socket (fixed pane coordinates).
 *
 * Rendering is split across two layers so the wires read like normal edges:
 * `RouterWires` draws just the strokes and is mounted BEHIND the React Flow
 * canvas (so opaque nodes occlude it); `RouterRail` draws the fixed rail plus
 * the per-wire delete buttons ON TOP.
 */

import { useMemo } from "react";
import { useViewport } from "@xyflow/react";
import type { TemplateRFNode } from "./TemplateNodes";

export interface RouterWire {
  source: string;
  sourceHandle: string;
}

export interface RailSize {
  width: number;
  height: number;
}

interface RouterViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface RouterWireGeom {
  wire: RouterWire;
  path: string;
  mid: { x: number; y: number };
}

const TYPE_COLORS: Record<string, string> = {
  image: "#10b981",
  text: "#3b82f6",
  video: "#ec4899",
  audio: "rgb(167, 139, 250)",
  "3d": "#f97316",
  easeCurve: "#ffffff",
};
const TYPE_LABELS: Record<string, string> = {
  image: "Image",
  text: "Text",
  video: "Video",
  audio: "Audio",
  "3d": "3D",
  easeCurve: "Curve",
};
const EMPTY_COLOR = "#6b7280";

const ROW_H = 28;
const LABEL_H = 28; // room for the "Router" caption + its top gap
const CAPTION_GAP = 10; // vertical gap between the sockets and the "Router" caption
const RAIL_RIGHT = 14; // distance from the wrapper's right edge
const CONTENT_W = 42; // no per-type labels, so the socket can hug the edge
const SOCKET_LEFT = 26; // socket center, measured from the rail content's left

/** Distinct wired types, in a stable order (one socket row per type). */
export function railTypes(wires: RouterWire[]): string[] {
  return Array.from(new Set(wires.map((wire) => wire.sourceHandle))).sort();
}

function railMetrics(wires: RouterWire[], size: RailSize) {
  const types = railTypes(wires);
  const rowCount = types.length + 1; // + the empty drop socket
  const railH = rowCount * ROW_H;
  const blockH = railH + LABEL_H;
  const blockTop = size.height / 2 - blockH / 2;
  const contentLeft = size.width - RAIL_RIGHT - CONTENT_W;
  return { types, railH, blockH, blockTop, contentLeft };
}

/** True when a wrapper-relative point is over the rail's drop zone. */
export function isInRailDropZone(
  point: { x: number; y: number },
  size: RailSize,
  wires: RouterWire[]
): boolean {
  if (size.width === 0) return false;
  const { blockTop, blockH, contentLeft } = railMetrics(wires, size);
  return (
    point.x >= contentLeft - 56 &&
    point.x <= size.width &&
    point.y >= blockTop - 24 &&
    point.y <= blockTop + blockH + 24
  );
}

/** Terminal output-handle position in pane coordinates (follows pan + zoom). */
function terminalPos(
  wire: RouterWire,
  nodes: TemplateRFNode[],
  viewport: RouterViewport
): { x: number; y: number } | null {
  const node = nodes.find((n) => n.id === wire.source);
  if (!node) return null;
  const width =
    node.measured?.width ??
    (node.width as number | undefined) ??
    (node.style?.width as number | undefined) ??
    300;
  const height =
    node.measured?.height ??
    (node.height as number | undefined) ??
    (node.style?.height as number | undefined) ??
    200;
  const flowX = node.position.x + width;
  const flowY = node.position.y + height / 2;
  return { x: flowX * viewport.zoom + viewport.x, y: flowY * viewport.zoom + viewport.y };
}

/**
 * Per-wire geometry (path + midpoint), shared by the stroke layer and the
 * delete-button layer so both agree exactly. Midpoint is the cubic bezier
 * evaluated at t=0.5.
 */
export function routerWireGeoms(
  wires: RouterWire[],
  nodes: TemplateRFNode[],
  size: RailSize,
  viewport: RouterViewport
): RouterWireGeom[] {
  const { types, blockTop, contentLeft } = railMetrics(wires, size);
  const typeIndex = new Map(types.map((type, i) => [type, i]));
  const socketX = contentLeft + SOCKET_LEFT;
  const socketY = (rowIndex: number) => blockTop + rowIndex * ROW_H + ROW_H / 2;

  const geoms: RouterWireGeom[] = [];
  for (const wire of wires) {
    const from = terminalPos(wire, nodes, viewport);
    if (!from) continue;
    const to = { x: socketX, y: socketY(typeIndex.get(wire.sourceHandle) ?? 0) };
    const dx = Math.max(40, (to.x - from.x) * 0.5);
    const c1 = { x: from.x + dx, y: from.y };
    const c2 = { x: to.x - dx, y: to.y };
    const path = `M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;
    const mid = {
      x: 0.125 * from.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * to.x,
      y: 0.125 * from.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * to.y,
    };
    geoms.push({ wire, path, mid });
  }
  return geoms;
}

/**
 * Just the wire strokes — mounted BEHIND the React Flow canvas so nodes occlude
 * them (the pane is transparent, so the wires show through the gaps).
 */
export function RouterWires({
  wires,
  nodes,
  size,
}: {
  wires: RouterWire[];
  nodes: TemplateRFNode[];
  size: RailSize;
}) {
  const viewport = useViewport();
  const geoms = useMemo(
    () => routerWireGeoms(wires, nodes, size, viewport),
    [wires, nodes, size, viewport]
  );
  if (size.width === 0 || size.height === 0) return null;
  return (
    <svg className="absolute inset-0" style={{ overflow: "visible", pointerEvents: "none" }}>
      {geoms.map((geom, i) => (
        <path
          key={`${geom.wire.source}-${geom.wire.sourceHandle}-${i}`}
          d={geom.path}
          stroke={TYPE_COLORS[geom.wire.sourceHandle] ?? "#888888"}
          strokeWidth={2}
          fill="none"
          opacity={0.9}
        />
      ))}
    </svg>
  );
}

/** A rounded curly brace opening toward the sockets on its right. */
function bracePath(height: number): string {
  const h = Math.max(height, 30);
  const mid = h / 2;
  const arm = Math.min(9, mid - 6);
  return [
    `M 11 2`,
    `Q 6 2 6 8`,
    `L 6 ${mid - arm}`,
    `Q 6 ${mid} 1 ${mid}`,
    `Q 6 ${mid} 6 ${mid + arm}`,
    `L 6 ${h - 8}`,
    `Q 6 ${h - 2} 11 ${h - 2}`,
  ].join(" ");
}

export function RouterRail({
  wires,
  nodes,
  size,
  onDisconnectType,
  onDisconnectWire,
}: {
  wires: RouterWire[];
  nodes: TemplateRFNode[];
  size: RailSize;
  onDisconnectType: (type: string) => void;
  onDisconnectWire: (source: string, sourceHandle: string) => void;
}) {
  const viewport = useViewport();
  const { types, railH, blockTop, contentLeft } = useMemo(
    () => railMetrics(wires, size),
    [wires, size]
  );
  // Wire midpoints for the delete buttons (same geometry as the stroke layer)
  const geoms = useMemo(
    () => routerWireGeoms(wires, nodes, size, viewport),
    [wires, nodes, size, viewport]
  );

  if (size.width === 0 || size.height === 0) return null;

  const rows: (string | null)[] = [...types, null];

  return (
    <>
      {/* Per-wire delete buttons at each wire's midpoint (revealed on hover) */}
      {geoms.map((geom, i) => (
        <div
          key={`del-${geom.wire.source}-${geom.wire.sourceHandle}-${i}`}
          className="absolute z-[21]"
          style={{ left: geom.mid.x, top: geom.mid.y, transform: "translate(-50%, -50%)" }}
        >
          <button
            type="button"
            onClick={() => onDisconnectWire(geom.wire.source, geom.wire.sourceHandle)}
            title="Delete router connection"
            aria-label="Delete router connection"
            className="group grid place-items-center"
            style={{ width: 28, height: 28, background: "transparent", pointerEvents: "auto" }}
          >
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-neutral-800 border border-neutral-600 text-neutral-400 shadow-md opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-hover:text-red-400 group-hover:border-red-500 group-hover:bg-red-500/20">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </span>
          </button>
        </div>
      ))}

      {/* The fixed rail */}
      <div
        className="absolute z-20"
        style={{
          top: blockTop,
          right: RAIL_RIGHT,
          width: CONTENT_W,
          height: railH + LABEL_H,
          pointerEvents: "none",
        }}
      >
        <svg
          width="12"
          height={railH}
          viewBox={`0 0 12 ${railH}`}
          className="absolute left-0 top-0"
          style={{ overflow: "visible" }}
          fill="none"
        >
          <path
            d={bracePath(railH)}
            stroke="#9a9a9a"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {rows.map((type, i) => {
          const top = i * ROW_H + ROW_H / 2;
          const label = type ? TYPE_LABELS[type] ?? type : null;
          const color = type ? TYPE_COLORS[type] ?? EMPTY_COLOR : EMPTY_COLOR;
          // Type is conveyed by socket color (matching the main-canvas handles);
          // the label lives in the hover tooltip so the rail can hug the edge.
          return (
            <div key={type ?? "empty"} className="group">
              {type && (
                <div
                  className="absolute cursor-pointer"
                  style={{
                    top: top - 12,
                    left: SOCKET_LEFT - 12,
                    width: 24,
                    height: 24,
                    pointerEvents: "auto",
                  }}
                  title={`Disconnect ${label}`}
                  onClick={() => onDisconnectType(type)}
                />
              )}
              <div
                className="absolute rounded-full transition-shadow group-hover:ring-2 group-hover:ring-white/30"
                style={{
                  top,
                  left: SOCKET_LEFT,
                  width: 11,
                  height: 11,
                  transform: "translate(-50%, -50%)",
                  backgroundColor: color,
                  border: "2px solid #1e1e1e",
                  boxShadow: "0 0 0 1px rgba(0,0,0,.35)",
                }}
              />
            </div>
          );
        })}

        {/* "Router" caption beneath the connector */}
        <span
          className="absolute text-[11px] font-semibold text-neutral-300 whitespace-nowrap select-none"
          style={{ top: railH + CAPTION_GAP, left: SOCKET_LEFT, transform: "translateX(-50%)" }}
        >
          Router
        </span>
      </div>
    </>
  );
}
