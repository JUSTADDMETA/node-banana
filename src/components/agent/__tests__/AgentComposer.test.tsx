import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/agent/ui/tooltip";
import { AgentComposer, type AgentComposerProps } from "@/components/agent/AgentComposer";

function renderComposer(props: Partial<AgentComposerProps> = {}) {
  const onSend = props.onSend ?? vi.fn(() => true);
  const onStop = props.onStop ?? vi.fn();
  const utils = render(
    <TooltipProvider>
      <AgentComposer
        status="ready"
        busy={false}
        onSend={onSend}
        onStop={onStop}
        {...props}
      />
    </TooltipProvider>,
  );
  const textarea = screen.getByRole("textbox", { name: "Message the agent" }) as HTMLTextAreaElement;
  return { ...utils, textarea, onSend, onStop };
}

describe("AgentComposer", () => {
  it("is a real textarea (so canvas shortcuts ignore typing)", () => {
    const { textarea } = renderComposer();
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("sends on Enter and clears the box", async () => {
    const { textarea, onSend } = renderComposer();
    fireEvent.change(textarea, { target: { value: "Make a text-to-image workflow" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Make a text-to-image workflow"));
    await waitFor(() => expect(textarea.value).toBe(""));
  });

  it("keeps Shift+Enter for a new line", async () => {
    const { textarea, onSend } = renderComposer();
    fireEvent.change(textarea, { target: { value: "line one" } });
    const event = fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    // Not prevented: the browser inserts the newline.
    expect(event).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send an empty message", async () => {
    const { textarea, onSend } = renderComposer();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps the draft when the message was not sent", async () => {
    const onSend = vi.fn(() => false);
    const { textarea } = renderComposer({ onSend });
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(textarea.value).toBe("hello");
  });

  it("while a turn runs, Enter queues the message and the button stops the turn", async () => {
    const { textarea, onSend, onStop } = renderComposer({ busy: true, status: "streaming" });
    expect(textarea.placeholder).toBe("Queue a message…");
    fireEvent.change(textarea, { target: { value: "next question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("next question"));
    await waitFor(() => expect(textarea.value).toBe(""));
    expect(onStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("while a turn runs, Shift+Enter still breaks the line", async () => {
    const { textarea, onSend } = renderComposer({ busy: true, status: "streaming" });
    fireEvent.change(textarea, { target: { value: "line one" } });
    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("lists queued messages with edit and remove", () => {
    const onEditQueued = vi.fn();
    const onRemoveQueued = vi.fn();
    renderComposer({
      busy: true,
      status: "streaming",
      queued: [
        { id: "q1", text: "make it blue" },
        { id: "q2", text: "then add an upscaler" },
      ],
      onEditQueued,
      onRemoveQueued,
      onSendQueuedNow: vi.fn(),
    });
    const strip = screen.getByRole("region", { name: "Queued messages (2)" });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(2);
    expect(strip).toHaveTextContent("make it blue");
    // Only a held queue offers "Send now".
    expect(screen.queryByRole("button", { name: "Send now" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit queued message: make it blue" }));
    expect(onEditQueued).toHaveBeenCalledWith("q1");
    fireEvent.click(screen.getByRole("button", { name: "Remove queued message: then add an upscaler" }));
    expect(onRemoveQueued).toHaveBeenCalledWith("q2");
  });

  it("offers Send now on the first queued message once the queue is held", () => {
    const onSendQueuedNow = vi.fn();
    renderComposer({
      queued: [
        { id: "q1", text: "make it blue" },
        { id: "q2", text: "then add an upscaler" },
      ],
      queueHeld: true,
      onSendQueuedNow,
    });
    expect(screen.getByRole("region", { name: "Queued messages (2)" })).toHaveTextContent("Paused · these wait for you");
    const sendNow = screen.getAllByRole("button", { name: "Send now" });
    expect(sendNow).toHaveLength(1);
    fireEvent.click(sendNow[0]);
    expect(onSendQueuedNow).toHaveBeenCalledTimes(1);
  });

  it("shows no queue strip when nothing is queued", () => {
    renderComposer({ busy: true, status: "streaming" });
    expect(screen.queryByRole("region", { name: /Queued messages/ })).not.toBeInTheDocument();
  });

  it("shows context notes beside send", () => {
    renderComposer({
      notes: [
        { key: "selection", kind: "selection", text: "3 nodes selected — the agent will focus on them" },
        { key: "switch", kind: "switch", text: "Codex picks up from here with the conversation so far" },
      ],
    });
    expect(screen.getByText("3 nodes selected — the agent will focus on them")).toBeInTheDocument();
    expect(screen.getByText("Codex picks up from here with the conversation so far")).toBeInTheDocument();
    // Only a note that can be dismissed gets an ×.
    expect(screen.queryByRole("button", { name: /Remove|Clear/ })).not.toBeInTheDocument();
  });

  it("dismisses a note from its ×", () => {
    const onDismiss = vi.fn();
    renderComposer({
      notes: [{ key: "selection", kind: "selection", text: "2 selected", onDismiss, dismissLabel: "Clear the selection" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear the selection" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("runs an action chip from its button, disabled while a turn runs", () => {
    const onClick = vi.fn();
    const forget = vi.fn();
    const note = {
      key: "research",
      kind: "action" as const,
      text: "Refresh prompting tips for Kling I2V",
      title: "Tips saved 2 Oct.",
      onClick,
      onDismiss: forget,
      dismissLabel: "Forget the saved prompting tips for Kling I2V",
    };
    const { rerender } = renderComposer({ notes: [note] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh prompting tips for Kling I2V" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Forget the saved prompting tips for Kling I2V" }));
    expect(forget).toHaveBeenCalledTimes(1);
    rerender(
      <TooltipProvider>
        <AgentComposer status="streaming" busy onSend={vi.fn(() => true)} onStop={vi.fn()} notes={[note]} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Refresh prompting tips for Kling I2V" })).toBeDisabled();
  });

  // Safari ends the composition before the keydown of the Enter that commits it
  // (keyCode 229, isComposing false): that Enter used to send the half-typed message.
  it("never sends on the Enter that commits an IME conversion (Safari order)", async () => {
    const { textarea, onSend } = renderComposer();
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "日本語" } });
    fireEvent.compositionEnd(textarea);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent(
      textarea,
      new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: false, bubbles: true, cancelable: true }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe("日本語");

    // The next, plain Enter sends.
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("日本語"));
  });

  it("never sends on an Enter inside a composition (Chrome order)", async () => {
    const { textarea, onSend } = renderComposer();
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "日本語" } });
    fireEvent(
      textarea,
      new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true }),
    );
    fireEvent.compositionEnd(textarea);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(onSend).not.toHaveBeenCalled();
  });

  // Spreadsheet cells and Office selections put the text and a rendered image on the
  // clipboard. The agent takes no attachments, so the text must paste as usual.
  it("lets the browser paste the text of a clipboard that also holds an image", () => {
    const { textarea } = renderComposer();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = {
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "file", type: "image/png", getAsFile: () => file },
      ],
      types: ["text/plain", "Files"],
      files: [file],
      getData: (type: string) => (type === "text/plain" ? "A1\tB1" : ""),
    };
    fireEvent(textarea, paste);
    expect(paste.defaultPrevented).toBe(false);
  });

  it("uses the parent's draft when given one", async () => {
    const onDraftChange = vi.fn();
    const { textarea, onSend } = renderComposer({ draft: "kept by the panel", onDraftChange });
    expect(textarea.value).toBe("kept by the panel");
    fireEvent.change(textarea, { target: { value: "kept by the panel!" } });
    expect(onDraftChange).toHaveBeenLastCalledWith("kept by the panel!");

    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("kept by the panel"));
    expect(onDraftChange).toHaveBeenLastCalledWith("");
  });

  it("offers the model's thinking efforts beside send, locked during a turn", () => {
    const onEffortChange = vi.fn();
    const { unmount } = renderComposer({
      efforts: ["low", "medium", "high", "max"],
      effort: "high",
      defaultEffort: "high",
      onEffortChange,
    });
    const trigger = screen.getByRole("button", { name: "Thinking effort: High" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Max/ }));
    expect(onEffortChange).toHaveBeenCalledWith("max");
    unmount();

    renderComposer({ busy: true, status: "submitted", efforts: ["low", "high"], effort: "low", onEffortChange });
    expect(screen.getByRole("button", { name: "Thinking effort: Low" })).toBeDisabled();
  });

  it("hides the effort control for a model without levels", () => {
    renderComposer({ efforts: [], onEffortChange: vi.fn() });
    expect(screen.queryByRole("button", { name: /Thinking effort/ })).not.toBeInTheDocument();
  });

  it("shows the attached results above the text, each with a way to take it out", () => {
    const onRemoveAttachment = vi.fn();
    renderComposer({
      attachments: [
        { assetId: "a-1", kind: "image", nodeId: "n-1", nodeTitle: "Rougher 1", sha256: "sha" },
        { assetId: "a-2", kind: "video", nodeId: "n-2", nodeTitle: "Clip", sha256: "sha2", hasPoster: true },
      ],
      onRemoveAttachment,
    });
    const list = screen.getByRole("list", { name: "Attached to the message (2)" });
    expect(within(list).getByRole("img", { name: "Rougher 1's image" })).toBeInTheDocument();
    expect(within(list).getByRole("img", { name: "Clip's video" })).toHaveAttribute("src", "/api/assets/thumb/sha2?w=320&poster=1");
    fireEvent.click(within(list).getByRole("button", { name: "Remove Clip's video" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("a-2");
  });
});
