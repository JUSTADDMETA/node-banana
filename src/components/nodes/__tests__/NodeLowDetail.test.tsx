import { describe, it, expect, vi } from "vitest";
import { useLayoutEffect, useState } from "react";
import { act, render } from "@testing-library/react";
import { ReactFlowProvider, useStoreApi, Position } from "@xyflow/react";
import { NodeLowDetail } from "@/components/nodes/NodeLowDetail";
import { useWorkflowStore } from "@/store/workflowStore";

vi.mock("@/hooks/useAdaptiveImageSrc", () => ({ useAdaptiveImageSrc: (value: string) => value }));

/** Puts a measured node with one handle per side in the store, then renders it at low detail. */
function Seeded({ selected = false, data = {} }: { selected?: boolean; data?: Record<string, unknown> }) {
  const store = useStoreApi();
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    store.getState().setNodes([{ id: "n", position: { x: 0, y: 0 }, data: {}, measured: { width: 200, height: 100 } }]);
    store.getState().nodeLookup.get("n")!.internals.handleBounds = {
      source: [{ id: "image", type: "source", nodeId: "n", position: Position.Right, x: 196, y: 42, width: 8, height: 8 }],
      target: [{ id: "text", type: "target", nodeId: "n", position: Position.Left, x: -4, y: 20, width: 8, height: 8 }],
    };
    setReady(true);
  }, [store]);
  return ready ? <NodeLowDetail id="n" type="nanoBanana" width={200} height={100} selected={selected} data={data} /> : null;
}

function renderSeeded(props: Parameters<typeof Seeded>[0] = {}) {
  return render(
    <ReactFlowProvider>
      <Seeded {...props} />
    </ReactFlowProvider>
  );
}

describe("NodeLowDetail", () => {
  it("keeps the node's size and its handles where React Flow measured them, so edges keep their ends", () => {
    const { container } = renderSeeded();
    expect(container.firstElementChild).toHaveStyle({ width: "200px", height: "100px" });
    expect(container.querySelector(".source")).toHaveAttribute("data-handleid", "image");
    expect(container.querySelector(".source")).toHaveStyle({ left: "196px", top: "42px" });
    expect(container.querySelector(".target")).toHaveAttribute("data-handlepos", "left");
  });

  it("shows the node's output image, else its input image, as a thumbnail", () => {
    expect(renderSeeded({ data: { outputImage: "data:image/png;base64,out", image: "data:image/png;base64,in" } }).container.querySelector("img"))
      .toHaveAttribute("src", "data:image/png;base64,out");
    expect(renderSeeded({ data: { image: "data:image/png;base64,in" } }).container.querySelector("img"))
      .toHaveAttribute("src", "data:image/png;base64,in");
    expect(renderSeeded().container.querySelector("img")).toBeNull();
  });

  it("outlines the node while it is selected", () => {
    const card = (selected: boolean) => renderSeeded({ selected }).container.firstElementChild!.firstElementChild as HTMLElement;
    expect(card(false).style.borderWidth).toBe("1px");
    expect(card(true).style.borderWidth).toBe("3px");
    expect(card(true).style.borderColor).toBe("rgb(229, 229, 229)");
  });

  it("tints the node while it runs, in a run or on its own, and not for another node's run", () => {
    const tinted = (container: HTMLElement) => !!container.querySelector("[data-running]");
    try {
      const idle = renderSeeded();
      expect(tinted(idle.container)).toBe(false);

      act(() => useWorkflowStore.setState({ isRunning: true, currentNodeIds: ["other"] }));
      expect(tinted(idle.container)).toBe(false);

      act(() => useWorkflowStore.setState({ currentNodeIds: ["other", "n"] }));
      expect(tinted(idle.container)).toBe(true);
      // The selection outline stays; the tint shows the run under it
      expect(tinted(renderSeeded({ selected: true }).container)).toBe(true);

      act(() => useWorkflowStore.setState({ isRunning: false, currentNodeIds: [] }));
      expect(tinted(idle.container)).toBe(false);
      expect(tinted(renderSeeded({ data: { status: "loading" } }).container)).toBe(true);
    } finally {
      act(() => useWorkflowStore.setState({ isRunning: false, currentNodeIds: [] }));
    }
  });
});
