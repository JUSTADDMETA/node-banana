import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LLMGenerateNode } from "@/components/nodes/LLMGenerateNode";
import { ReactFlowProvider } from "@xyflow/react";
import { LLMGenerateNodeData } from "@/types";

// Mock the workflow store
const mockUpdateNodeData = vi.fn();
const mockRegenerateNode = vi.fn();
const mockUseWorkflowStore = vi.fn();

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector?: (state: unknown) => unknown) => {
    if (selector) {
      return mockUseWorkflowStore(selector);
    }
    return mockUseWorkflowStore((s: unknown) => s);
  },
}));

// Wrapper component for React Flow context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe("LLMGenerateNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation
    mockUseWorkflowStore.mockImplementation((selector) => {
      const state = {
        updateNodeData: mockUpdateNodeData,
        regenerateNode: mockRegenerateNode,
        isRunning: false,
        currentNodeId: null,
        groups: {},
        nodes: [],
      };
      return selector(state);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createNodeData = (overrides: Partial<LLMGenerateNodeData> = {}): LLMGenerateNodeData => ({
    inputPrompt: null,
    inputImages: [],
    outputText: null,
    provider: "google",
    model: "gemini-3-flash-preview",
    temperature: 1.0,
    maxTokens: 2048,
    status: "idle",
    error: null,
    ...overrides,
  });

  const createNodeProps = (data: Partial<LLMGenerateNodeData> = {}) => ({
    id: "test-llm-1",
    type: "llmGenerate" as const,
    data: createNodeData(data),
    selected: false,
  });

  describe("Basic Rendering", () => {
    it("should render with title 'LLM Generate'", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps()} />
        </TestWrapper>
      );

      expect(screen.getByText("LLM Generate")).toBeInTheDocument();
    });

    it("should render text input handle on left", () => {
      const { container } = render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps()} />
        </TestWrapper>
      );

      const textHandle = container.querySelector('[data-handletype="text"][class*="target"]');
      expect(textHandle).toBeInTheDocument();
    });

    it("should render image input handle on left", () => {
      const { container } = render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps()} />
        </TestWrapper>
      );

      const imageHandle = container.querySelector('[data-handletype="image"][class*="target"]');
      expect(imageHandle).toBeInTheDocument();
    });

    it("should render text output handle on right", () => {
      const { container } = render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps()} />
        </TestWrapper>
      );

      const outputHandle = container.querySelector('[data-handletype="text"][class*="source"]');
      expect(outputHandle).toBeInTheDocument();
    });
  });

  describe("Provider Selector", () => {
    it("should render provider selector with Google selected by default", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ provider: "google" })} />
        </TestWrapper>
      );

      const providerSelect = screen.getByDisplayValue("Google");
      expect(providerSelect).toBeInTheDocument();
    });

    it("should show Google and OpenAI as provider options", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps()} />
        </TestWrapper>
      );

      expect(screen.getByRole("option", { name: "Google" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "OpenAI" })).toBeInTheDocument();
    });

    it("should call updateNodeData when provider is changed", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ provider: "google" })} />
        </TestWrapper>
      );

      const providerSelect = screen.getByDisplayValue("Google");
      fireEvent.change(providerSelect, { target: { value: "openai" } });

      expect(mockUpdateNodeData).toHaveBeenCalledWith("test-llm-1", {
        provider: "openai",
        model: "gpt-4.1-mini",
      });
    });
  });

  describe("Model Selector", () => {
    it("should show Google models when Google provider is selected", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ provider: "google" })} />
        </TestWrapper>
      );

      expect(screen.getByRole("option", { name: "Gemini 3 Flash" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Gemini 2.5 Flash" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Gemini 3.0 Pro" })).toBeInTheDocument();
    });

    it("should show OpenAI models when OpenAI provider is selected", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ provider: "openai", model: "gpt-4.1-mini" })} />
        </TestWrapper>
      );

      expect(screen.getByRole("option", { name: "GPT-4.1 Mini" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "GPT-4.1 Nano" })).toBeInTheDocument();
    });

    it("should call updateNodeData when model is changed", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ provider: "google", model: "gemini-3-flash-preview" })} />
        </TestWrapper>
      );

      const modelSelect = screen.getByDisplayValue("Gemini 3 Flash");
      fireEvent.change(modelSelect, { target: { value: "gemini-2.5-flash" } });

      expect(mockUpdateNodeData).toHaveBeenCalledWith("test-llm-1", {
        model: "gemini-2.5-flash",
      });
    });
  });

  describe("Temperature Slider", () => {
    it("should render temperature slider with current value", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ temperature: 0.7 })} />
        </TestWrapper>
      );

      expect(screen.getByText("Temp: 0.7")).toBeInTheDocument();
    });

    it("should call updateNodeData when temperature is changed", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ temperature: 1.0 })} />
        </TestWrapper>
      );

      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "1.5" } });

      expect(mockUpdateNodeData).toHaveBeenCalledWith("test-llm-1", {
        temperature: 1.5,
      });
    });
  });

  describe("Idle State", () => {
    it("should show 'Run to generate' message when idle and no output", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ status: "idle", outputText: null })} />
        </TestWrapper>
      );

      expect(screen.getByText("Run to generate")).toBeInTheDocument();
    });
  });

  describe("Loading State", () => {
    it("should show loading spinner when status is loading", () => {
      const { container } = render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ status: "loading" })} />
        </TestWrapper>
      );

      const spinner = container.querySelector(".animate-spin");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    it("should show error message when status is error", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ status: "error", error: "API rate limit exceeded" })} />
        </TestWrapper>
      );

      expect(screen.getByText("API rate limit exceeded")).toBeInTheDocument();
    });

    it("should show 'Failed' when error message is null", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ status: "error", error: null })} />
        </TestWrapper>
      );

      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
  });

  describe("Output Text Display", () => {
    it("should display output text when data.outputText exists", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ outputText: "Generated response text" })} />
        </TestWrapper>
      );

      expect(screen.getByText("Generated response text")).toBeInTheDocument();
    });

    it("should render regenerate button when output exists", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ outputText: "Some output" })} />
        </TestWrapper>
      );

      const regenerateButton = screen.getByTitle("Regenerate");
      expect(regenerateButton).toBeInTheDocument();
    });

    it("should call regenerateNode when regenerate button is clicked", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ outputText: "Some output" })} />
        </TestWrapper>
      );

      const regenerateButton = screen.getByTitle("Regenerate");
      fireEvent.click(regenerateButton);

      expect(mockRegenerateNode).toHaveBeenCalledWith("test-llm-1");
    });

    it("should disable regenerate button when workflow is running", () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        const state = {
          updateNodeData: mockUpdateNodeData,
          regenerateNode: mockRegenerateNode,
          isRunning: true,
          currentNodeId: null,
          groups: {},
          nodes: [],
        };
        return selector(state);
      });

      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ outputText: "Some output" })} />
        </TestWrapper>
      );

      const regenerateButton = screen.getByTitle("Regenerate");
      expect(regenerateButton).toBeDisabled();
    });
  });

  describe("Clear Output Button", () => {
    it("should render clear output button when output exists", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ outputText: "Some output" })} />
        </TestWrapper>
      );

      const clearButton = screen.getByTitle("Clear output");
      expect(clearButton).toBeInTheDocument();
    });

    it("should call updateNodeData to clear output when clear button is clicked", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ outputText: "Some output" })} />
        </TestWrapper>
      );

      const clearButton = screen.getByTitle("Clear output");
      fireEvent.click(clearButton);

      expect(mockUpdateNodeData).toHaveBeenCalledWith("test-llm-1", {
        outputText: null,
        status: "idle",
        error: null,
      });
    });
  });

  describe("Custom Title and Comment", () => {
    it("should display custom title when provided", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({ customTitle: "My LLM" })} />
        </TestWrapper>
      );

      expect(screen.getByText(/My LLM/)).toBeInTheDocument();
    });

    it("should call updateNodeData when custom title is changed", () => {
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps()} />
        </TestWrapper>
      );

      // Click on title to edit
      const title = screen.getByText("LLM Generate");
      fireEvent.click(title);

      const input = screen.getByPlaceholderText("Custom title...");
      fireEvent.change(input, { target: { value: "Custom LLM Title" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(mockUpdateNodeData).toHaveBeenCalledWith("test-llm-1", { customTitle: "Custom LLM Title" });
    });
  });

  describe("Model Fallback", () => {
    it("should fall back to first available model when current model is invalid for provider", () => {
      // When provider is google but model is an OpenAI model, should show first Google model
      render(
        <TestWrapper>
          <LLMGenerateNode {...createNodeProps({
            provider: "google",
            model: "gpt-4.1-mini" as any // Invalid model for Google provider
          })} />
        </TestWrapper>
      );

      // Should show first Google model in select
      const modelSelect = screen.getByDisplayValue("Gemini 3 Flash");
      expect(modelSelect).toBeInTheDocument();
    });
  });
});
