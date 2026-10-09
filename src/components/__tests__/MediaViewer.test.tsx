import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Download, ImagePlus, Trash2 } from "lucide-react";
import { MediaViewer, STRIP_ACTIVE, STRIP_FAR, STRIP_NEAR, stripShift, stripTileSize, type MediaViewerItem } from "@/components/MediaViewer";

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({ incrementModalCount: vi.fn(), decrementModalCount: vi.fn() }),
}));

const items: MediaViewerItem[] = [
  { id: "a", src: "data:image/png;base64,a", kind: "image", title: "A red shoe", details: [["Model", "Nano Banana Pro"], ["Cost", "$0.13"]] },
  { id: "b", src: "data:image/png;base64,b", kind: "image", title: "A watch" },
  { id: "c", src: "data:video/mp4;base64,c", kind: "video", thumb: "data:image/jpeg;base64,poster", title: "Video 3" },
  { id: "d", src: "data:image/png;base64,d", kind: "image", title: "Dunes" },
];

function renderViewer(overrides: Partial<React.ComponentProps<typeof MediaViewer>> = {}) {
  const props = {
    open: true,
    items,
    index: 0,
    onIndexChange: vi.fn(),
    onClose: vi.fn(),
    actions: [
      { label: "Add to graph", icon: ImagePlus, tone: "primary" as const, shortcut: "Enter", onClick: vi.fn() },
      { label: "Download", icon: Download, shortcut: "d", onClick: vi.fn() },
      { label: "Remove", icon: Trash2, tone: "danger" as const, onClick: vi.fn() },
    ],
    label: "Gallery",
    ...overrides,
  };
  const utils = render(<MediaViewer {...props} />);
  return { ...utils, props };
}

describe("MediaViewer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the item on the stage with its title, details and the host's actions in the rail", () => {
    renderViewer();
    const dialog = screen.getByRole("dialog", { name: "Gallery" });
    expect(within(screen.getByTestId("media-viewer-stage")).getByRole("img", { name: "A red shoe" })).toHaveAttribute("src", items[0].src);
    const rail = screen.getByTestId("media-viewer-rail");
    expect(rail).toHaveTextContent("1 of 4");
    expect(rail).toHaveTextContent("A red shoe");
    expect(rail).toHaveTextContent("Nano Banana Pro");
    expect(within(rail).getByRole("button", { name: "Add to graph" })).toHaveClass("bg-neutral-200");
    expect(within(rail).getByRole("button", { name: "Remove" })).toHaveClass("text-red-400");
    expect(dialog).toBeInTheDocument();
  });

  it("scales the strip like a dock around the active tile", () => {
    renderViewer({ index: 1 });
    const strip = screen.getByTestId("media-viewer-strip");
    const tiles = within(strip).getAllByRole("button");
    expect(tiles).toHaveLength(4);
    expect(tiles[1]).toHaveAttribute("aria-current", "true");
    expect(tiles[1]).toHaveStyle({ width: `${STRIP_ACTIVE}px`, height: `${STRIP_ACTIVE}px` });
    expect(tiles[0]).toHaveStyle({ width: `${STRIP_NEAR}px` });
    expect(tiles[2]).toHaveStyle({ width: `${STRIP_NEAR}px` });
    expect(tiles[3]).toHaveStyle({ width: `${STRIP_FAR}px` });
    // A video tile shows its poster
    expect(within(tiles[2]).getByRole("presentation", { hidden: true })).toHaveAttribute("src", items[2].thumb);
  });

  it("keeps the active tile under the middle of the stage", () => {
    expect(stripTileSize(3, 3)).toBe(STRIP_ACTIVE);
    expect(stripTileSize(2, 3)).toBe(STRIP_NEAR);
    expect(stripTileSize(0, 3)).toBe(STRIP_FAR);
    // First of four: track is 72+4+52+4+40+4+40 = 216 wide, the tile's centre at 36 → shift by 72
    expect(stripShift(4, 0)).toBe(72);
    // Symmetric layouts need no shift
    expect(stripShift(3, 1)).toBe(0);
    expect(stripShift(0, 0)).toBe(0);
  });

  it("steps with the arrows, the strip and the keyboard, and stays inside the list", () => {
    const { props, rerender } = renderViewer({ index: 1 });
    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]);
    expect(props.onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Previous" })[1]);
    expect(props.onIndexChange).toHaveBeenLastCalledWith(0);
    fireEvent.click(within(screen.getByTestId("media-viewer-strip")).getByRole("button", { name: "Dunes" }));
    expect(props.onIndexChange).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(props.onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(props.onIndexChange).toHaveBeenLastCalledWith(0);

    vi.mocked(props.onIndexChange).mockClear();
    rerender(<MediaViewer {...props} index={0} />);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(props.onIndexChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Previous" })[0]).toBeDisabled();
  });

  it("fires the actions' shortcuts, never from a text field", () => {
    const { props } = renderViewer();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(props.actions[0].onClick).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "D" });
    expect(props.actions[1].onClick).toHaveBeenCalledTimes(1);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.actions[0].onClick).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("holds the old image until the new one has loaded, then crossfades and lets the old one go", () => {
    const { props, rerender } = renderViewer({ index: 0 });
    expect(screen.queryByTestId("media-viewer-leaving")).toBeNull();
    rerender(<MediaViewer {...props} index={1} />);

    // Same element for the outgoing image: it moved to the back, it was not remounted
    const leaving = screen.getByTestId("media-viewer-leaving");
    const oldImg = leaving.querySelector("img")!;
    expect(oldImg).toHaveAttribute("src", items[0].src);
    // Nothing moves until the incoming image has loaded: the old one stays opaque, the new one is held invisible
    expect(leaving).not.toHaveClass("animate-viewer-out-left");
    const incoming = screen.getByTestId("media-viewer-current");
    expect(incoming).toHaveClass("opacity-0");

    // The rail swaps at once, with no animation
    const rail = screen.getByTestId("media-viewer-rail");
    expect(rail).toHaveTextContent("A watch");
    expect(rail).not.toHaveTextContent("A red shoe");
    expect(rail.querySelector('[class*="animate-"]')).toBeNull();

    fireEvent.load(incoming.querySelector("img")!);
    expect(leaving).toHaveClass("animate-viewer-out-left");
    expect(incoming).toHaveClass("animate-viewer-in-right");
    expect(incoming).not.toHaveClass("opacity-0");

    fireEvent.animationEnd(leaving);
    expect(screen.queryByTestId("media-viewer-leaving")).toBeNull();

    // Going back, the motion reverses; a source that never loads is not waited on forever
    rerender(<MediaViewer {...props} index={0} />);
    expect(screen.getByTestId("media-viewer-leaving")).not.toHaveClass("animate-viewer-out-right");
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(screen.getByTestId("media-viewer-leaving")).toHaveClass("animate-viewer-out-right");
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.queryByTestId("media-viewer-leaving")).toBeNull();
  });

  it("plays a video on the stage", () => {
    renderViewer({ index: 2 });
    // The dialog is portaled to the body
    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
  });

  it("closes from the button and Escape", () => {
    const { props } = renderViewer();
    // The close button sits in the rail header, clear of the desktop window's drag strip
    fireEvent.click(within(screen.getByTestId("media-viewer-rail")).getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("opens a prompt longer than four lines in full, and starts the next item closed", () => {
    // jsdom lays nothing out: a clamped heading overflows when its text is long.
    const overflows = (element: Element) => element.classList.contains("line-clamp-4") && (element.textContent ?? "").length > 80;
    const scroll = vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
      return overflows(this) ? 140 : 80;
    });
    const client = vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(80);
    try {
      const prompt = "A ripe banana on a wooden table, in soft window light from the left, shot on a 50mm lens with a shallow depth of field and grain";
      const long = [{ ...items[0], title: prompt }, ...items.slice(1)];
      const { props, rerender } = renderViewer({ items: long });
      const rail = screen.getByTestId("media-viewer-rail");
      const text = within(rail).getByText(prompt);
      expect(text).toHaveClass("line-clamp-4");

      const more = within(rail).getByRole("button", { name: "Show full prompt" });
      expect(more).toHaveAttribute("aria-expanded", "false");
      expect(more).toHaveAttribute("aria-controls", text.id);
      fireEvent.click(more);
      expect(text).not.toHaveClass("line-clamp-4");
      expect(text).toHaveClass("overflow-y-auto");
      fireEvent.click(within(rail).getByRole("button", { name: "Show less" }));
      expect(text).toHaveClass("line-clamp-4");

      fireEvent.click(within(rail).getByRole("button", { name: "Show full prompt" }));
      // A short heading has nothing more to show; the long one is closed again when it comes back.
      rerender(<MediaViewer {...props} items={long} index={1} />);
      expect(within(rail).queryByRole("button", { name: /Show (full prompt|less)/ })).toBeNull();
      rerender(<MediaViewer {...props} items={long} index={0} />);
      expect(within(rail).getByText(prompt)).toHaveClass("line-clamp-4");
      expect(within(rail).getByRole("button", { name: "Show full prompt" })).toHaveAttribute("aria-expanded", "false");
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it("renders nothing while closed", () => {
    renderViewer({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
