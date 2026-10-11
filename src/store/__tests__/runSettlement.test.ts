/**
 * When one node fails, the run aborts the nodes running beside it. Their
 * executors rethrow the abort without touching their node, so the run has to
 * put them back to idle itself, or their spinners stay on.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WorkflowNode } from "@/types";
import type { NodeExecutionContext } from "../execution";

const pending = vi.hoisted(() => new Map<string, { resolve: () => void; reject: (error: unknown) => void }>());

vi.mock("../execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../execution")>();
  return {
    ...actual,
    executeOutput: vi.fn(
      (ctx: NodeExecutionContext) =>
        new Promise<void>((resolve, reject) => {
          ctx.updateNodeData(ctx.node.id, { status: "loading" } as never);
          ctx.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          pending.set(ctx.node.id, { resolve, reject });
        })
    ),
  };
});

import { useWorkflowStore } from "../workflowStore";
import { useToast } from "@/components/Toast";

const initial = useWorkflowStore.getState();
const outputNode = (id: string): WorkflowNode => ({ id, type: "output", position: { x: 0, y: 0 }, data: { status: "idle" } } as WorkflowNode);
const status = (id: string) => (useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data as { status?: string }).status;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a run that ends early settles the nodes it cut off", () => {
  beforeEach(() => {
    pending.clear();
    useToast.getState().hide();
    useWorkflowStore.setState({
      ...initial,
      nodes: [outputNode("a"), outputNode("b"), outputNode("c")],
      edges: [],
      groups: {},
      isRunning: false,
      currentNodeIds: [],
      batch: null,
      maxConcurrentCalls: 3,
    });
  });

  it("puts the nodes running beside a failed one back to idle, and leaves the failed one as its executor left it", async () => {
    const run = useWorkflowStore.getState().executeWorkflow();
    await flush();
    expect(["a", "b", "c"].map(status)).toEqual(["loading", "loading", "loading"]);

    useWorkflowStore.getState().updateNodeData("a", { status: "error", error: "Generation failed" } as never);
    pending.get("a")!.reject(new Error("Generation failed"));
    await run;

    expect(useWorkflowStore.getState().isRunning).toBe(false);
    expect(["a", "b", "c"].map(status)).toEqual(["error", "idle", "idle"]);
  });

  it("puts every running node back to idle on Stop", async () => {
    const run = useWorkflowStore.getState().executeWorkflow();
    await flush();
    useWorkflowStore.getState().stopWorkflow();
    await run;
    expect(["a", "b", "c"].map(status)).toEqual(["idle", "idle", "idle"]);
  });

  it("does the same for a run of selected nodes", async () => {
    const run = useWorkflowStore.getState().executeSelectedNodes(["a", "b"]);
    await flush();
    expect(["a", "b", "c"].map(status)).toEqual(["loading", "loading", "idle"]);
    pending.get("b")!.reject(new Error("Generation failed"));
    await run;
    expect(["a", "b"].map(status)).toEqual(["idle", "idle"]);
  });
});
