"use client";

/**
 * A node drawn at low detail while the canvas is zoomed out (see
 * lowDetail.ts): a plain card the node's size, a stripe in the node type's
 * minimap colour, the node's image as a thumbnail, an outline while selected,
 * and a pulsing tint while it runs.
 * It carries the same handle elements as the culling placeholder, built
 * from the handles React Flow last read, so edges stay attached and React
 * Flow sees the same node.
 */
import { useStoreApi } from "@xyflow/react";
import { exactNodeSize } from "./nodeCulling";
import { useAdaptiveImageSrc } from "@/hooks/useAdaptiveImageSrc";
import { useWorkflowStore } from "@/store/workflowStore";
import { miniMapTypeColor } from "@/components/CanvasMinimap";

interface NodeLowDetailProps {
  id: string;
  type: string;
  width: number;
  height: number;
  selected: boolean;
  data: Record<string, unknown>;
}

function Thumbnail({ id, src }: { id: string; src: string }) {
  const shown = useAdaptiveImageSrc(src, id);
  if (!shown) return null;
  return (
    <img
      src={shown}
      alt=""
      draggable={false}
      style={{ position: "absolute", left: 6, top: 14, width: "calc(100% - 12px)", height: "calc(100% - 20px)", objectFit: "cover", borderRadius: 6 }}
    />
  );
}

/** The image a node shows: its output, else its input. */
function nodeImage(data: Record<string, unknown>): string | null {
  const image = data.outputImage ?? data.image;
  return typeof image === "string" && image ? image : null;
}

export function NodeLowDetail({ id, type, width, height, selected, data }: NodeLowDetailProps) {
  const handleBounds = useStoreApi().getState().nodeLookup.get(id)?.internals.handleBounds;
  const handles = [...(handleBounds?.source ?? []), ...(handleBounds?.target ?? [])];
  const exact = exactNodeSize(id);
  const image = nodeImage(data);
  // Running in a run (currentNodeIds), or on its own. Not the full node's
  // isExecuting, which most nodes set for any run and would light every card.
  const inRun = useWorkflowStore((state) => state.currentNodeIds?.includes(id) ?? false);
  const running = inRun || data.status === "loading";
  return (
    <div style={{ position: "relative", width: exact?.width ?? width, height: exact?.height ?? height }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#262626",
          border: selected ? "3px solid #e5e5e5" : running ? "4px solid var(--color-running)" : "1px solid #404040",
          borderRadius: 12,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 8,
          background: miniMapTypeColor(type),
          borderRadius: "12px 12px 0 0",
        }}
      />
      {image && <Thumbnail id={id} src={image} />}
      {running && <div data-running className="node-low-detail-running" style={{ position: "absolute", inset: 0, borderRadius: 12 }} />}
      {handles.map((h) => (
        <div
          key={`${h.type}-${h.id ?? ""}`}
          className={h.type}
          data-handleid={h.id ?? undefined}
          data-handlepos={h.position}
          style={{ position: "absolute", left: h.x, top: h.y, width: h.width, height: h.height }}
        />
      ))}
    </div>
  );
}
