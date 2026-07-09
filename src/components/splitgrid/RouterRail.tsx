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
const LABEL_H = 20;
const RAIL_RIGHT = 24; // distance from the wrapper's right edge
const CONTENT_W = 128;
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
    point.x >= contentLeft - 16 &&
    point.x <= size.width &&
    point.y >= blockTop - 24 &&
    point.y <= blockTop + blockH + 24
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
}: {
  wires: RouterWire[];
  nodes: TemplateRFNode[];
  size: RailSize;
  onDisconnectType: (type: string) => void;
}) {
  const viewport = useViewport();
  const { types, railH, blockTop, contentLeft } = useMemo(
    () => railMetrics(wires, size),
    [wires, size]
  );
  const typeIndex = useMemo(() => new Map(types.map((type, i) => [type, i])), [types]);

  if (size.width === 0 || size.height === 0) return null;

  const socketX = contentLeft + SOCKET_LEFT;
  const socketY = (rowIndex: number) => blockTop + rowIndex * ROW_H + ROW_H / 2;

  // Terminal output-handle position in pane coordinates (follows pan + zoom).
  const terminalPos = (wire: RouterWire): { x: number; y: number } | null => {
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
  };

  const rows: (string | null)[] = [...types, null];

  return (
    <>
      {/* Wire edges: terminal output → its type socket (purely visual) */}
      <svg
        className="absolute inset-0 z-10"
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        {wires.map((wire, i) => {
          const from = terminalPos(wire);
          if (!from) return null;
          const to = { x: socketX, y: socketY(typeIndex.get(wire.sourceHandle) ?? 0) };
          const dx = Math.max(40, (to.x - from.x) * 0.5);
          const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y} ${to.x - dx} ${to.y} ${to.x} ${to.y}`;
          const color = TYPE_COLORS[wire.sourceHandle] ?? "#888888";
          return (
            <path
              key={`${wire.source}-${wire.sourceHandle}-${i}`}
              d={d}
              stroke={color}
              strokeWidth={2}
              fill="none"
              opacity={0.9}
            />
          );
        })}
      </svg>

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
          return (
            <div key={type ?? "empty"} className="group">
              {/* Clickable row (typed sockets only) to disconnect that type */}
              {type && (
                <div
                  className="absolute cursor-pointer"
                  style={{
                    top: top - ROW_H / 2,
                    left: 0,
                    width: CONTENT_W,
                    height: ROW_H,
                    pointerEvents: "auto",
                  }}
                  title={`Disconnect ${label}`}
                  onClick={() => onDisconnectType(type)}
                />
              )}
              <div
                className="absolute rounded-full"
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
              {label && (
                <span
                  className="absolute text-[11px] font-medium leading-none whitespace-nowrap select-none group-hover:line-through"
                  style={{ top, left: SOCKET_LEFT + 12, transform: "translateY(-50%)", color }}
                >
                  {label}
                </span>
              )}
            </div>
          );
        })}

        {/* "Router" caption beneath the connector */}
        <span
          className="absolute text-[11px] font-semibold text-neutral-300 whitespace-nowrap select-none"
          style={{ top: railH + 3, left: SOCKET_LEFT, transform: "translateX(-50%)" }}
        >
          Router
        </span>
      </div>
    </>
  );
}
