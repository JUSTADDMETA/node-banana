"use client";

/**
 * Split Grid cell template editor — a mini node graph in a modal.
 *
 * Users design the set of nodes created for every split image: the base cell
 * image node is always present, and any catalog node can be added and wired
 * up. Confirming saves the template and materializes one node group per cell.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import type { NodeType, SplitGridNodeData, SplitGridTemplate } from "@/types";
import { defaultNodeDimensions } from "@/store/utils/nodeDefaults";
import {
  createClassicSplitGridTemplate,
  createDefaultSplitGridTemplate,
  getSplitGridTemplate,
} from "@/store/utils/splitGridTemplate";
import {
  getTemplateEntry,
  getTemplateNodeIcon,
  TEMPLATE_NODE_CATALOG,
  type TemplateHandleKind,
} from "./templateCatalog";
import {
  SplitGridTemplateNode,
  TemplateEditorContext,
  type TemplateNodeData,
  type TemplateRFNode,
} from "./TemplateNodes";

const nodeTypes: NodeTypes = {
  splitGridTemplateNode: SplitGridTemplateNode,
};

const EDGE_COLOR: Record<TemplateHandleKind, string> = {
  image: "#0d9668",
  text: "#2563eb",
};

function edgeStyleFor(sourceHandle: string | null | undefined): React.CSSProperties {
  const kind = (sourceHandle === "text" ? "text" : "image") as TemplateHandleKind;
  return { stroke: EDGE_COLOR[kind], strokeWidth: 2 };
}

function templateToRfNodes(
  template: SplitGridTemplate,
  sourceImage: string | null
): TemplateRFNode[] {
  return template.nodes.map((templateNode) => {
    const dims = defaultNodeDimensions[templateNode.type] ?? { width: 300, height: 280 };
    const isBase = templateNode.id === template.baseNodeId;
    return {
      id: templateNode.id,
      type: "splitGridTemplateNode",
      position: { ...templateNode.position },
      deletable: !isBase,
      style: { width: dims.width, height: dims.height },
      data: {
        nodeType: templateNode.type,
        overrides: { ...(templateNode.data ?? {}) },
        isBase,
        sourceImage: isBase ? sourceImage : undefined,
      } satisfies TemplateNodeData,
    };
  });
}

function templateToRfEdges(template: SplitGridTemplate): Edge[] {
  return template.edges.map((templateEdge) => ({
    id: templateEdge.id,
    source: templateEdge.source,
    sourceHandle: templateEdge.sourceHandle,
    target: templateEdge.target,
    targetHandle: templateEdge.targetHandle,
    style: edgeStyleFor(templateEdge.sourceHandle),
  }));
}

interface SplitGridTemplateModalProps {
  nodeId: string;
  nodeData: SplitGridNodeData;
  onClose: () => void;
}

function SplitGridTemplateModalInner({ nodeId, nodeData, onClose }: SplitGridTemplateModalProps) {
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const materializeSplitGridCells = useWorkflowStore((state) => state.materializeSplitGridCells);
  const incrementModalCount = useWorkflowStore((state) => state.incrementModalCount);
  const decrementModalCount = useWorkflowStore((state) => state.decrementModalCount);

  const initialTemplate = useMemo(() => getSplitGridTemplate(nodeData), [nodeData]);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<TemplateRFNode>(
    templateToRfNodes(initialTemplate, nodeData.sourceImage)
  );
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(
    templateToRfEdges(initialTemplate)
  );
  const idCounterRef = useRef(0);
  const baseNodeId = initialTemplate.baseNodeId;
  const { fitView } = useReactFlow();

  const refitSoon = useCallback(() => {
    requestAnimationFrame(() => {
      fitView({ padding: 0.25, maxZoom: 1, duration: 200 });
    });
  }, [fitView]);

  // Freeze the main canvas while the editor is open
  useEffect(() => {
    incrementModalCount();
    return () => decrementModalCount();
  }, [incrementModalCount, decrementModalCount]);

  // Escape closes without applying
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const setOverrides = useCallback(
    (id: string, overrides: Record<string, unknown>) => {
      setRfNodes((nodes) =>
        nodes.map((node) => (node.id === id ? { ...node, data: { ...node.data, overrides } } : node))
      );
    },
    [setRfNodes]
  );
  const editorContext = useMemo(() => ({ setOverrides }), [setOverrides]);

  const makeTemplateNodeId = useCallback(
    (type: NodeType, existing: TemplateRFNode[]): string => {
      const taken = new Set(existing.map((node) => node.id));
      let id: string;
      do {
        id = `tmpl-${type}-${++idCounterRef.current}`;
      } while (taken.has(id));
      return id;
    },
    []
  );

  const addTemplateNode = useCallback(
    (type: NodeType) => {
      setRfNodes((nodes) => {
        const dims = defaultNodeDimensions[type] ?? { width: 300, height: 280 };
        // Place to the right of the current layout, staggering repeated adds
        let maxRight = -Infinity;
        let minY = Infinity;
        for (const node of nodes) {
          const width = (node.style?.width as number) ?? 300;
          maxRight = Math.max(maxRight, node.position.x + width);
          minY = Math.min(minY, node.position.y);
        }
        if (!Number.isFinite(maxRight)) maxRight = 0;
        if (!Number.isFinite(minY)) minY = 0;
        const stagger = (nodes.length % 3) * 40;
        return [
          ...nodes,
          {
            id: makeTemplateNodeId(type, nodes),
            type: "splitGridTemplateNode" as const,
            position: { x: maxRight + 60, y: minY + stagger },
            deletable: true,
            style: { width: dims.width, height: dims.height },
            data: { nodeType: type, overrides: {}, isBase: false } satisfies TemplateNodeData,
          },
        ];
      });
      refitSoon();
    },
    [makeTemplateNodeId, setRfNodes, refitSoon]
  );

  const applyPreset = useCallback(
    (template: SplitGridTemplate) => {
      setRfNodes(templateToRfNodes(template, nodeData.sourceImage));
      setRfEdges(templateToRfEdges(template));
      idCounterRef.current = 0;
      refitSoon();
    },
    [nodeData.sourceImage, setRfNodes, setRfEdges, refitSoon]
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge): boolean => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target || source === target) return false;
      const sourceNode = rfNodes.find((node) => node.id === source);
      const targetNode = rfNodes.find((node) => node.id === target);
      if (!sourceNode || !targetNode) return false;
      const sourceEntry = getTemplateEntry(sourceNode.data.nodeType);
      const targetEntry = getTemplateEntry(targetNode.data.nodeType);
      const output = sourceEntry.outputs.find((handle) => handle.id === sourceHandle);
      const input = targetEntry.inputs.find((handle) => handle.id === targetHandle);
      return Boolean(output && input && output.id === input.id);
    },
    [rfNodes]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return;
      setRfEdges((edges) => {
        let next = edges;
        // Text inputs accept a single connection — replace the existing one
        if (connection.targetHandle === "text") {
          next = next.filter(
            (edge) =>
              !(edge.target === connection.target && edge.targetHandle === connection.targetHandle)
          );
        }
        return addEdge({ ...connection, style: edgeStyleFor(connection.sourceHandle) }, next);
      });
    },
    [isValidConnection, setRfEdges]
  );

  const cellCount = Math.max(1, nodeData.gridRows || 1) * Math.max(1, nodeData.gridCols || 1);

  // Generate nodes without a prompt input would fail pre-run validation
  const generateMissingPrompt = useMemo(
    () =>
      rfNodes.some(
        (node) =>
          node.data.nodeType === "nanoBanana" &&
          !rfEdges.some((edge) => edge.target === node.id && edge.targetHandle === "text")
      ),
    [rfNodes, rfEdges]
  );

  const handleApply = useCallback(() => {
    const template: SplitGridTemplate = {
      baseNodeId,
      nodes: rfNodes.map((node) => ({
        id: node.id,
        type: node.data.nodeType,
        position: { x: node.position.x, y: node.position.y },
        data: Object.keys(node.data.overrides).length > 0 ? node.data.overrides : undefined,
      })),
      edges: rfEdges
        .filter((edge) => edge.sourceHandle && edge.targetHandle)
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle!,
          target: edge.target,
          targetHandle: edge.targetHandle!,
        })),
    };
    updateNodeData(nodeId, { template });
    materializeSplitGridCells(nodeId, { force: true });
    onClose();
  }, [baseNodeId, rfNodes, rfEdges, nodeId, updateNodeData, materializeSplitGridCells, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onWheelCapture={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-[min(1080px,94vw)] h-[min(720px,88vh)] bg-neutral-800 rounded-xl border border-neutral-700 shadow-2xl overflow-clip flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-700/60 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">Cell Node Set</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              These nodes are created for every split image and grouped per cell
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 rounded transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center flex-wrap gap-2 px-5 py-2.5 border-b border-neutral-700/40 shrink-0">
          <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider shrink-0">
            Add node
          </span>
          {TEMPLATE_NODE_CATALOG.map((entry) => (
            <button
              key={entry.type}
              onClick={() => addTemplateNode(entry.type)}
              title={entry.description}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 rounded-md text-xs text-neutral-300 hover:text-neutral-100 transition-colors shrink-0"
            >
              <span className="[&>svg]:w-3.5 [&>svg]:h-3.5">{getTemplateNodeIcon(entry.type)}</span>
              {entry.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
              Presets
            </span>
            <button
              onClick={() => applyPreset(createDefaultSplitGridTemplate())}
              className="px-2.5 py-1.5 text-xs text-neutral-400 hover:text-neutral-100 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 rounded-md transition-colors"
            >
              Image only
            </button>
            <button
              onClick={() => applyPreset(createClassicSplitGridTemplate(nodeData.defaultPrompt))}
              className="px-2.5 py-1.5 text-xs text-neutral-400 hover:text-neutral-100 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 rounded-md transition-colors"
            >
              Prompt + Generate
            </button>
          </div>
        </div>

        {/* Mini canvas */}
        <div className="flex-1 min-h-0 relative bg-neutral-900">
          <TemplateEditorContext.Provider value={editorContext}>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={handleConnect}
              isValidConnection={isValidConnection}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.5}
              deleteKeyCode={["Backspace", "Delete"]}
              defaultEdgeOptions={{ animated: false }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#404040" />
              <Controls showInteractive={false} className="!bg-neutral-800 !border-neutral-700 !shadow-none [&>button]:!bg-neutral-800 [&>button]:!border-neutral-700 [&>button]:!text-neutral-300 [&>button:hover]:!bg-neutral-700" />
            </ReactFlow>
          </TemplateEditorContext.Provider>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-neutral-700/50 shrink-0">
          <div className="text-xs text-neutral-500 min-w-0">
            <span>
              {rfNodes.length} node{rfNodes.length === 1 ? "" : "s"} per cell · {nodeData.gridRows}×{nodeData.gridCols} grid → {cellCount} group{cellCount === 1 ? "" : "s"}
            </span>
            {generateMissingPrompt && (
              <span className="ml-3 text-amber-400">
                Generate Image nodes need a Prompt connected to their text input
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-2 text-sm bg-white text-neutral-900 rounded-lg hover:bg-neutral-200 transition-colors"
            >
              Apply to {cellCount} cell{cellCount === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function SplitGridTemplateModal(props: SplitGridTemplateModalProps) {
  // Own provider: isolates the mini canvas from the app-level React Flow store
  return (
    <ReactFlowProvider>
      <SplitGridTemplateModalInner {...props} />
    </ReactFlowProvider>
  );
}
