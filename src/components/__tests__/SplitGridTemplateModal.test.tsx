import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SplitGridTemplateModal } from "@/components/splitgrid/SplitGridTemplateModal";
import { TEMPLATE_NODE_CATALOG } from "@/components/splitgrid/templateCatalog";
import type { SplitGridNodeData } from "@/types";

// Mock the workflow store (selector-passthrough pattern)
const mockUpdateNodeData = vi.fn();
const mockMaterializeSplitGridCells = vi.fn();
const mockIncrementModalCount = vi.fn();
const mockDecrementModalCount = vi.fn();
let mockIsRunning = false;

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      updateNodeData: mockUpdateNodeData,
      materializeSplitGridCells: mockMaterializeSplitGridCells,
      incrementModalCount: mockIncrementModalCount,
      decrementModalCount: mockDecrementModalCount,
      isRunning: mockIsRunning,
    }),
}));

const NODE_ID = "split-grid-node-1";
const PROMPT_TEXTAREA_PLACEHOLDER = "Prompt applied to every cell…";
const GENERATE_WARNING = "Generate Image nodes need a Prompt connected to their text input";

function createNodeData(overrides: Partial<SplitGridNodeData> = {}): SplitGridNodeData {
  return {
    sourceImage: null,
    gridRows: 2,
    gridCols: 3,
    targetCount: 6,
    defaultPrompt: "",
    generateSettings: {
      aspectRatio: "1:1",
      resolution: "1K",
      model: "nano-banana",
      useGoogleSearch: false,
      useImageSearch: false,
    },
    childNodeIds: [],
    isConfigured: false,
    status: "idle",
    error: null,
    ...overrides,
  };
}

function renderModal(
  options: { nodeData?: Partial<SplitGridNodeData>; onClose?: () => void } = {}
) {
  const onClose = options.onClose ?? vi.fn();
  const result = render(
    <SplitGridTemplateModal
      nodeId={NODE_ID}
      nodeData={createNodeData(options.nodeData)}
      onClose={onClose}
    />
  );
  return { ...result, onClose };
}

describe("SplitGridTemplateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRunning = false;
  });

  describe("Rendering", () => {
    it("should render the modal title", () => {
      renderModal();

      expect(screen.getByText("Cell Node Set")).toBeInTheDocument();
    });

    it("should render a toolbar button for every catalog entry", () => {
      renderModal();

      for (const entry of TEMPLATE_NODE_CATALOG) {
        expect(screen.getByRole("button", { name: entry.label })).toBeInTheDocument();
      }
    });

    it("should render the base Cell Image node on the canvas", () => {
      renderModal();

      expect(screen.getByText("Cell Image")).toBeInTheDocument();
    });

    it("should render both preset buttons", () => {
      renderModal();

      expect(screen.getByRole("button", { name: "Image only" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Prompt + Generate" })).toBeInTheDocument();
    });
  });

  describe("Modal Count", () => {
    it("should increment the modal count on mount", () => {
      renderModal();

      expect(mockIncrementModalCount).toHaveBeenCalledTimes(1);
      expect(mockDecrementModalCount).not.toHaveBeenCalled();
    });

    it("should decrement the modal count on unmount", () => {
      const { unmount } = renderModal();

      unmount();

      expect(mockDecrementModalCount).toHaveBeenCalledTimes(1);
    });
  });

  describe("Adding Nodes", () => {
    it("should add a Prompt node card to the canvas when the Prompt chip is clicked", () => {
      renderModal();

      // Only the toolbar chip carries the "Prompt" label before adding
      expect(screen.getAllByText("Prompt")).toHaveLength(1);
      expect(
        screen.queryByPlaceholderText(PROMPT_TEXTAREA_PLACEHOLDER)
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Prompt" }));

      // Toolbar chip + new node card header
      expect(screen.getAllByText("Prompt")).toHaveLength(2);
      expect(screen.getByPlaceholderText(PROMPT_TEXTAREA_PLACEHOLDER)).toBeInTheDocument();
    });
  });

  describe("Footer", () => {
    it("should show 'Apply to 6 cells' for a 2x3 grid", () => {
      renderModal({ nodeData: { gridRows: 2, gridCols: 3 } });

      expect(screen.getByRole("button", { name: "Apply to 6 cells" })).toBeInTheDocument();
    });

    it("should show singular 'Apply to 1 cell' for a 1x1 grid", () => {
      renderModal({ nodeData: { gridRows: 1, gridCols: 1 } });

      expect(screen.getByRole("button", { name: "Apply to 1 cell" })).toBeInTheDocument();
    });
  });

  describe("Apply", () => {
    it("should materialize with force and the built template in one call, then close", () => {
      const { onClose } = renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Apply to 6 cells" }));

      expect(mockMaterializeSplitGridCells).toHaveBeenCalledWith(NODE_ID, {
        force: true,
        template: expect.objectContaining({ baseNodeId: "cell-image" }),
      });
      // Template save and materialization are atomic (single undo entry) —
      // no separate updateNodeData call
      expect(mockUpdateNodeData).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("should include added nodes in the applied template", () => {
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
      fireEvent.click(screen.getByRole("button", { name: "Apply to 6 cells" }));

      const [, options] = mockMaterializeSplitGridCells.mock.calls[0];
      const template = options.template;
      expect(template.nodes).toHaveLength(2);
      expect(template.nodes.map((node: { type: string }) => node.type)).toEqual(
        expect.arrayContaining(["imageInput", "prompt"])
      );
    });
  });

  describe("Unsaved changes", () => {
    it("asks before discarding when Escape is pressed after edits", () => {
      const { onClose } = renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
      fireEvent.keyDown(window, { key: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Discard changes?")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps editing when the user declines the discard prompt", () => {
      const { onClose } = renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

      expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("While a workflow is running", () => {
    it("disables Apply so cells cannot be rebuilt mid-run", () => {
      mockIsRunning = true;
      renderModal();

      const applyButton = screen.getByRole("button", { name: "Apply to 6 cells" });
      expect(applyButton).toBeDisabled();

      fireEvent.click(applyButton);
      expect(mockMaterializeSplitGridCells).not.toHaveBeenCalled();
    });
  });

  describe("Cancel", () => {
    it("should call onClose without saving the template", () => {
      const { onClose } = renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockUpdateNodeData).not.toHaveBeenCalled();
      expect(mockMaterializeSplitGridCells).not.toHaveBeenCalled();
    });
  });

  describe("Escape Key", () => {
    it("should call onClose when Escape is pressed", () => {
      const { onClose } = renderModal();

      fireEvent.keyDown(window, { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockUpdateNodeData).not.toHaveBeenCalled();
    });
  });

  describe("Presets", () => {
    it("should show Prompt and Generate Image cards after applying 'Prompt + Generate'", () => {
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Prompt + Generate" }));

      // Prompt card body (textarea) and Generate card body (Model select) are unique to the canvas
      expect(screen.getByPlaceholderText(PROMPT_TEXTAREA_PLACEHOLDER)).toBeInTheDocument();
      expect(screen.getByText("Model")).toBeInTheDocument();
      // Toolbar chip + node card header for each
      expect(screen.getAllByText("Prompt")).toHaveLength(2);
      expect(screen.getAllByText("Generate Image")).toHaveLength(2);
    });
  });

  describe("Generate Prompt Warning", () => {
    it("should not show the warning initially", () => {
      renderModal();

      expect(screen.queryByText(GENERATE_WARNING)).not.toBeInTheDocument();
    });

    it("should warn when a Generate Image node has no prompt connected", () => {
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Generate Image" }));

      expect(screen.getByText(GENERATE_WARNING)).toBeInTheDocument();
    });

    it("should not warn when the preset wires a prompt into the generate node", () => {
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Prompt + Generate" }));

      expect(screen.queryByText(GENERATE_WARNING)).not.toBeInTheDocument();
    });
  });
});
