"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Handle, NodeProps, Node, Position } from "@xyflow/react";

import { BaseNode } from "./BaseNode";
import { ComfyAppParameters } from "./ComfyAppParameters";
import { HandleLabel } from "./HandleLabel";
import { InlineParameterPanel } from "./InlineParameterPanel";
import { ComfyWorkflowImportModal } from "@/components/modals/ComfyWorkflowImportModal";
import { useShowHandleLabels } from "@/hooks/useShowHandleLabels";
import { useWorkflowStore } from "@/store/workflowStore";
import { appToInputSchema } from "@/lib/comfy/nodeSchema";
import { getComfySettings } from "@/lib/comfy/settings";
import type { ComfyAppDefinition, ComfyInputType, ComfyOutputType } from "@/lib/comfy/types";
import type { ComfyAppNodeData } from "@/types";
import { downloadMedia } from "@/utils/downloadMedia";

type ComfyAppNodeType = Node<ComfyAppNodeData, "comfyApp">;

const HANDLE_COLOR: Record<string, string> = {
  image: "var(--handle-color-image)",
  text: "var(--handle-color-text)",
  audio: "var(--handle-color-audio)",
  video: "var(--handle-color-video)",
  "3d": "var(--handle-color-3d)",
};

/** Evenly space n handles down the node's left or right edge. */
function handleTop(index: number, total: number): string {
  return `${((index + 1) / (total + 1)) * 100}%`;
}

/** Handle id for a connectable input — indexed per type, as the store expects. */
function inputHandleId(type: ComfyInputType, indexWithinType: number): string {
  return `${type}-${indexWithinType}`;
}

export function ComfyAppNode({ id, data, selected }: NodeProps<ComfyAppNodeType>) {
  const nodeData = data;
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const showLabels = useShowHandleLabels(selected);
  const [importOpen, setImportOpen] = useState(false);

  // Created from the connection menu, which had nowhere to attach its wire —
  // go straight to choosing a workflow so the node becomes usable.
  useEffect(() => {
    if (!nodeData._autoOpenImport) return;
    setImportOpen(true);
    updateNodeData(id, { _autoOpenImport: false });
  }, [nodeData._autoOpenImport, id, updateNodeData]);

  const edges = useWorkflowStore((state) => state.edges);
  const removeEdge = useWorkflowStore((state) => state.removeEdge);

  const app = nodeData.app;

  // Handles are derived from the app contract, and `inputSchema` is what maps a
  // handle back to its graph binding at run time (via `dynamicInputs`). Keep it
  // in sync whenever the attached workflow changes.
  useEffect(() => {
    if (!app) return;
    const schema = appToInputSchema(app);
    const current = nodeData.inputSchema;
    if (JSON.stringify(current) === JSON.stringify(schema)) return;
    updateNodeData(id, { inputSchema: schema });
  }, [app, id, nodeData.inputSchema, updateNodeData]);

  /** Input handles, grouped by type so ids stay `image-0`, `text-0`, … */
  const inputHandles = useMemo(() => {
    if (!app) return [];
    const counters: Record<string, number> = {};
    return app.inputs.map((input) => {
      const index = counters[input.type] ?? 0;
      counters[input.type] = index + 1;
      return { ...input, handleId: inputHandleId(input.type, index) };
    });
  }, [app]);

  const outputHandles = useMemo(() => app?.outputs ?? [], [app]);

  const handleAttach = useCallback(
    (attached: ComfyAppDefinition) => {
      // A different workflow means different handles. Any edge still pointing
      // at one this contract does not declare would otherwise hang off the
      // node with nowhere to attach, and would silently feed nothing.
      const inputHandleIds = new Set(
        (() => {
          const counters: Record<string, number> = {};
          return attached.inputs.map((input) => {
            const index = counters[input.type] ?? 0;
            counters[input.type] = index + 1;
            return inputHandleId(input.type, index);
          });
        })()
      );
      const outputHandleIds = new Set(attached.outputs.map((o) => o.id));
      for (const edge of edges) {
        if (edge.target === id && edge.targetHandle && !inputHandleIds.has(edge.targetHandle)) {
          removeEdge(edge.id);
        } else if (edge.source === id && edge.sourceHandle && !outputHandleIds.has(edge.sourceHandle)) {
          removeEdge(edge.id);
        }
      }

      updateNodeData(id, {
        app: attached,
        inputSchema: appToInputSchema(attached),
        // A new contract invalidates the previous run entirely — old parameter
        // ids point at nodes the new graph may not even have.
        paramValues: Object.fromEntries(
          attached.params
            .filter((p) => p.default !== undefined && !p.isSeed)
            .map((p) => [p.id, p.default])
        ),
        outputs: {},
        outputImage: null,
        outputVideo: null,
        outputAudio: null,
        outputText: null,
        output3dUrl: null,
        status: "idle",
        error: null,
        runStatus: null,
        jobId: null,
      });
      setImportOpen(false);
    },
    [id, updateNodeData, edges, removeEdge]
  );

  const handleParamsChange = useCallback(
    (values: Record<string, unknown>) => updateNodeData(id, { paramValues: values }),
    [id, updateNodeData]
  );

  const primaryPreview = useMemo(() => {
    if (!app) return null;
    for (const output of app.outputs) {
      const value = nodeData.outputs?.[output.id];
      if (value) return { type: output.type as ComfyOutputType, value, label: output.label };
    }
    return null;
  }, [app, nodeData.outputs]);

  const settingsPanel =
    app && app.params.length > 0 ? (
      <InlineParameterPanel
        expanded={Boolean(nodeData.parametersExpanded)}
        onToggle={() => updateNodeData(id, { parametersExpanded: !nodeData.parametersExpanded })}
        nodeId={id}
      >
        <ComfyAppParameters
          params={app.params}
          values={nodeData.paramValues ?? {}}
          onChange={handleParamsChange}
        />
      </InlineParameterPanel>
    ) : undefined;

  const isRunning = nodeData.status === "loading";

  return (
    <>
      <BaseNode
        id={id}
        selected={selected}
        isExecuting={isRunning}
        hasError={nodeData.status === "error"}
        minWidth={260}
        minHeight={220}
        aspectFitMedia={primaryPreview?.type === "image" ? primaryPreview.value : null}
        settingsExpanded={Boolean(nodeData.parametersExpanded)}
        {...(settingsPanel ? { settingsPanel } : {})}
      >
        {/* Input handles — one per connectable input the workflow exposes */}
        {inputHandles.map((input, index) => {
          const top = handleTop(index, inputHandles.length);
          return (
            <React.Fragment key={input.id}>
              <Handle
                type="target"
                position={Position.Left}
                id={input.handleId}
                style={{ top, zIndex: 10 }}
                data-handletype={input.type}
                data-schema-name={input.name}
                title={input.description || input.label}
                isConnectable
              />
              <HandleLabel
                label={input.label}
                side="target"
                color={HANDLE_COLOR[input.type] ?? "var(--handle-color-image)"}
                top={`calc(${top} - 18px)`}
                visible={showLabels}
              />
            </React.Fragment>
          );
        })}

        {/* Output handles — one per bound output node */}
        {outputHandles.map((output, index) => {
          const top = handleTop(index, outputHandles.length);
          return (
            <React.Fragment key={output.id}>
              <Handle
                type="source"
                position={Position.Right}
                id={output.id}
                style={{ top, zIndex: 10 }}
                data-handletype={output.type}
                title={output.label}
              />
              <HandleLabel
                label={output.label}
                side="source"
                color={HANDLE_COLOR[output.type] ?? "var(--handle-color-image)"}
                top={`calc(${top} - 18px)`}
                visible={showLabels}
              />
            </React.Fragment>
          );
        })}

        <div className="relative w-full h-full min-h-0 flex flex-col overflow-hidden">
          {!app ? (
            <EmptyState onImport={() => setImportOpen(true)} />
          ) : (
            <>
              <ComfyAppHeader
                app={app}
                onReplace={() => setImportOpen(true)}
                runStatus={isRunning ? nodeData.runStatus ?? "running" : null}
              />
              <div className="flex-1 min-h-0 rounded-md overflow-hidden bg-neutral-900/60 flex items-center justify-center">
                <Preview
                  preview={primaryPreview}
                  isRunning={isRunning}
                  error={nodeData.status === "error" ? nodeData.error : null}
                />
              </div>
            </>
          )}
        </div>
      </BaseNode>

      <ComfyWorkflowImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onAttach={handleAttach}
        {...(app ? { existingName: app.name } : {})}
      />
    </>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  const mode = getComfySettings().mode;
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
      <svg
        className="w-8 h-8 text-neutral-600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <path d="M10 6.5h2.5a1.5 1.5 0 0 1 1.5 1.5v9.5" />
      </svg>
      <div>
        <p className="text-sm text-neutral-300 font-medium">ComfyUI App</p>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          Attach a ComfyUI workflow to turn it into a node
        </p>
      </div>
      <button
        type="button"
        onClick={onImport}
        className="nodrag nopan px-3 py-1.5 text-xs rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-100 transition-colors"
      >
        Choose a workflow
      </button>
      <span className="text-[10px] text-neutral-600">
        Running on {mode === "cloud" ? "Comfy Cloud" : mode === "local" ? "local ComfyUI" : "a remote ComfyUI"}
      </span>
    </div>
  );
}

function ComfyAppHeader({
  app,
  onReplace,
  runStatus,
}: {
  app: ComfyAppDefinition;
  onReplace: () => void;
  runStatus: string | null;
}) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1.5 shrink-0">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-neutral-200 truncate" title={app.name}>
          {app.name}
        </p>
        <p className="text-[9px] text-neutral-500 truncate">
          {runStatus
            ? runStatus.replace(/_/g, " ")
            : `${app.nodeCount} node${app.nodeCount === 1 ? "" : "s"}${
                app.source === "blueprint" ? " · Blueprint" : ""
              }`}
        </p>
      </div>
      <button
        type="button"
        onClick={onReplace}
        title="Replace this workflow"
        className="nodrag nopan shrink-0 text-neutral-500 hover:text-neutral-200 transition-colors"
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 2v6h-6" />
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M3 22v-6h6" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
      </button>
    </div>
  );
}

function Preview({
  preview,
  isRunning,
  error,
}: {
  preview: { type: ComfyOutputType; value: string; label: string } | null;
  isRunning: boolean;
  error: string | null;
}) {
  if (isRunning) {
    return (
      <div className="flex flex-col items-center gap-2 text-neutral-500">
        <div className="w-5 h-5 border-2 border-neutral-600 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-[10px]">Rendering…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-3 py-2 max-h-full overflow-y-auto nowheel">
        <p className="text-[10px] text-red-400 whitespace-pre-wrap break-words">{error}</p>
      </div>
    );
  }
  if (!preview) {
    return <span className="text-[10px] text-neutral-600">No output yet</span>;
  }
  if (preview.type === "text") {
    return (
      <div className="w-full h-full px-3 py-2 overflow-y-auto nowheel nodrag">
        <p className="text-[11px] text-neutral-200 whitespace-pre-wrap break-words">
          {preview.value}
        </p>
      </div>
    );
  }
  if (preview.type === "video") {
    return (
      <video
        src={preview.value}
        className="w-full h-full object-contain"
        controls
        loop
        muted
        playsInline
      />
    );
  }
  if (preview.type === "audio") {
    return (
      <div className="w-full px-3">
        <audio src={preview.value} controls className="w-full nodrag nopan" />
      </div>
    );
  }
  if (preview.type === "3d") {
    return (
      <button
        type="button"
        onClick={() => downloadMedia(preview.value, "image", "comfy-model")}
        className="nodrag nopan text-[10px] text-neutral-300 underline underline-offset-2"
      >
        Download 3D model
      </button>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={preview.value} alt={preview.label} className="w-full h-full object-contain" />
  );
}
