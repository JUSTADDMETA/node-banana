"use client";

/**
 * Node components for the split-grid cell template editor (the mini canvas).
 * Each card is a simplified stand-in for the real node it will instantiate,
 * rendered at the real node's default dimensions so the materialized layout
 * matches what the user designed.
 */

import { createContext, memo, useContext } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { AspectRatio, ModelType, NodeType, Resolution } from "@/types";
import { MODEL_DISPLAY_NAMES } from "@/types";
import { getTemplateEntry, getTemplateNodeIcon, type TemplateHandleDef } from "./templateCatalog";

export interface TemplateNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  overrides: Record<string, unknown>;
  isBase: boolean;
  sourceImage?: string | null;
}

export type TemplateRFNode = Node<TemplateNodeData, "splitGridTemplateNode">;

interface TemplateEditorContextValue {
  setOverrides: (nodeId: string, overrides: Record<string, unknown>) => void;
}

export const TemplateEditorContext = createContext<TemplateEditorContextValue>({
  setOverrides: () => {},
});

const GEMINI_MODELS: { value: ModelType; label: string }[] = [
  { value: "nano-banana", label: "Nano Banana" },
  { value: "nano-banana-2", label: "Nano Banana 2" },
  { value: "nano-banana-pro", label: "Nano Banana Pro" },
];
const BASE_ASPECT_RATIOS: AspectRatio[] = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const EXTENDED_ASPECT_RATIOS: AspectRatio[] = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const RESOLUTIONS_PRO: Resolution[] = ["1K", "2K", "4K"];
const RESOLUTIONS_NB2: Resolution[] = ["512", "1K", "2K", "4K"];

const SELECT_CLASS =
  "nodrag nopan w-full px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-neutral-100 text-xs focus:outline-none focus:border-neutral-500";

function handleOffset(index: number, count: number): string {
  if (count <= 1) return "50%";
  return `${Math.round(((index + 1) / (count + 1)) * 100)}%`;
}

function TemplateHandles({ handles, side }: { handles: TemplateHandleDef[]; side: "in" | "out" }) {
  return (
    <>
      {handles.map((handle, index) => (
        <Handle
          key={`${side}-${handle.id}`}
          type={side === "in" ? "target" : "source"}
          position={side === "in" ? Position.Left : Position.Right}
          id={handle.id}
          data-handletype={handle.id}
          title={handle.label}
          style={{ top: handleOffset(index, handles.length), zIndex: 10 }}
        />
      ))}
    </>
  );
}

function BaseImageBody({ sourceImage }: { sourceImage?: string | null }) {
  return (
    <div className="flex-1 min-h-0 m-3 rounded-md border border-dashed border-neutral-600/70 bg-neutral-900/50 flex flex-col items-center justify-center gap-2 overflow-hidden relative">
      {sourceImage ? (
        <>
          <img src={sourceImage} alt="Source" className="absolute inset-0 w-full h-full object-cover opacity-40" />
          <div className="relative z-10 px-3 py-1.5 rounded bg-neutral-950/80 text-[10px] text-neutral-300">
            One slice of this image per cell
          </div>
        </>
      ) : (
        <>
          <svg className="w-6 h-6 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
          <span className="text-[10px] text-neutral-500 text-center px-4">
            Receives one split image per cell
          </span>
        </>
      )}
    </div>
  );
}

function PromptBody({ nodeId, overrides }: { nodeId: string; overrides: Record<string, unknown> }) {
  const { setOverrides } = useContext(TemplateEditorContext);
  const prompt = typeof overrides.prompt === "string" ? overrides.prompt : "";
  return (
    <div className="flex-1 min-h-0 p-3 flex flex-col">
      <textarea
        value={prompt}
        onChange={(event) => setOverrides(nodeId, { ...overrides, prompt: event.target.value })}
        placeholder="Prompt applied to every cell…"
        className="nodrag nopan nowheel flex-1 min-h-0 w-full px-2.5 py-2 bg-neutral-900 border border-neutral-700 rounded text-neutral-100 text-xs resize-none focus:outline-none focus:border-neutral-500 placeholder:text-neutral-600"
      />
    </div>
  );
}

function GenerateBody({ nodeId, overrides }: { nodeId: string; overrides: Record<string, unknown> }) {
  const { setOverrides } = useContext(TemplateEditorContext);
  const model = (overrides.model as ModelType | undefined) ?? "";
  const aspectRatio = (overrides.aspectRatio as AspectRatio | undefined) ?? "1:1";
  const resolution = (overrides.resolution as Resolution | undefined) ?? "1K";
  const aspectRatios = model === "nano-banana-2" ? EXTENDED_ASPECT_RATIOS : BASE_ASPECT_RATIOS;
  const resolutions = model === "nano-banana-2" ? RESOLUTIONS_NB2 : RESOLUTIONS_PRO;
  const showResolution = model === "nano-banana-pro" || model === "nano-banana-2";

  const handleModelChange = (value: string) => {
    if (!value) {
      // Inherit the user's sticky generate defaults at materialization time
      setOverrides(nodeId, {});
      return;
    }
    const newModel = value as ModelType;
    const nextAspectRatios = newModel === "nano-banana-2" ? EXTENDED_ASPECT_RATIOS : BASE_ASPECT_RATIOS;
    const nextResolutions = newModel === "nano-banana-2" ? RESOLUTIONS_NB2 : RESOLUTIONS_PRO;
    setOverrides(nodeId, {
      ...overrides,
      model: newModel,
      selectedModel: {
        provider: "gemini",
        modelId: newModel,
        displayName: MODEL_DISPLAY_NAMES[newModel] || newModel,
      },
      aspectRatio: nextAspectRatios.includes(aspectRatio) ? aspectRatio : nextAspectRatios[0],
      resolution: nextResolutions.includes(resolution) ? resolution : nextResolutions[0],
    });
  };

  return (
    <div className="flex-1 min-h-0 p-3 space-y-2 overflow-hidden">
      <div>
        <label className="block text-[10px] text-neutral-500 mb-1">Model</label>
        <select value={model} onChange={(e) => handleModelChange(e.target.value)} className={SELECT_CLASS}>
          <option value="">Default (my settings)</option>
          {GEMINI_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      {model && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-neutral-500 mb-1">Aspect</label>
            <select
              value={aspectRatio}
              onChange={(e) => setOverrides(nodeId, { ...overrides, aspectRatio: e.target.value })}
              className={SELECT_CLASS}
            >
              {aspectRatios.map((ar) => (
                <option key={ar} value={ar}>{ar}</option>
              ))}
            </select>
          </div>
          {showResolution && (
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1">Resolution</label>
              <select
                value={resolution}
                onChange={(e) => setOverrides(nodeId, { ...overrides, resolution: e.target.value })}
                className={SELECT_CLASS}
              >
                {resolutions.map((res) => (
                  <option key={res} value={res}>{res}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-neutral-600 leading-snug">
        {model ? "Applied to every cell's generate node." : "Each cell uses your default generate settings."}
      </p>
    </div>
  );
}

function GenericBody({ description }: { description: string }) {
  return (
    <div className="flex-1 min-h-0 p-3 flex flex-col items-center justify-center gap-1.5 text-center">
      <span className="text-[11px] text-neutral-400">{description}</span>
      <span className="text-[10px] text-neutral-600">Uses default settings — editable per cell after creation</span>
    </div>
  );
}

function TemplateNodeComponent({ id, data, selected }: NodeProps<TemplateRFNode>) {
  const entry = getTemplateEntry(data.nodeType);
  const icon = getTemplateNodeIcon(data.nodeType);

  return (
    <div
      className={`h-full w-full rounded-lg bg-neutral-800 shadow-lg border flex flex-col overflow-hidden transition-colors ${
        selected
          ? "border-blue-500 ring-2 ring-blue-500/40 shadow-blue-500/25"
          : "border-neutral-700/60"
      }`}
    >
      <TemplateHandles handles={entry.inputs} side="in" />
      <TemplateHandles handles={entry.outputs} side="out" />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-700/50 shrink-0">
        <span className="text-neutral-400 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
        <span className="text-xs font-medium text-neutral-200">{entry.label}</span>
        {data.isBase && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25">
            1 per cell
          </span>
        )}
      </div>

      {data.isBase ? (
        <BaseImageBody sourceImage={data.sourceImage} />
      ) : data.nodeType === "prompt" ? (
        <PromptBody nodeId={id} overrides={data.overrides} />
      ) : data.nodeType === "nanoBanana" ? (
        <GenerateBody nodeId={id} overrides={data.overrides} />
      ) : (
        <GenericBody description={entry.description} />
      )}
    </div>
  );
}

export const SplitGridTemplateNode = memo(TemplateNodeComponent);
