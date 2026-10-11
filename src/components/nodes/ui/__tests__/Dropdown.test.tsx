import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { Dropdown } from "../Dropdown";
import { pickOption, optionValues } from "@/test/dropdown";

const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];

function setup(props: Partial<React.ComponentProps<typeof Dropdown>> = {}) {
  const onChange = vi.fn();
  const utils = render(<Dropdown value="1:1" options={RATIOS} onChange={onChange} aria-label="Aspect ratio" {...props} />);
  const trigger = screen.getByRole("combobox", { name: props["aria-label"] ?? "Aspect ratio" });
  return { onChange, trigger, ...utils };
}

afterEach(() => vi.useRealTimers());

describe("Dropdown", () => {
  it("shows the selected label, opens on click and picks a row", () => {
    const { trigger, onChange } = setup();
    expect(trigger).toHaveTextContent("1:1");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox");
    expect(screen.getByRole("option", { name: "1:1" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: "16:9" }));
    expect(onChange).toHaveBeenCalledWith("16:9");
    expect(list).not.toBeInTheDocument();
  });

  it("does not fire onChange when the current value is picked again", () => {
    const { trigger, onChange } = setup();
    pickOption(trigger, "1:1");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("walks the list with the keyboard and picks with Enter", () => {
    const { trigger, onChange } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/-2$/);
    fireEvent.keyDown(trigger, { key: "End" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/-4$/);
    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/-4$/);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("16:9");
  });

  it("skips disabled rows and closes on Escape", () => {
    const { trigger } = setup({ options: [{ value: "a", label: "A" }, { value: "b", label: "B", disabled: true }, { value: "c", label: "C" }], value: "a" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/-2$/);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("jumps by typing while closed, like a native select", () => {
    const { trigger, onChange } = setup();
    fireEvent.keyDown(trigger, { key: "9" });
    expect(onChange).toHaveBeenCalledWith("9:16");
  });

  it("closes on an outside pointer press", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("gains a search well past eight options and filters as you type", () => {
    const many = Array.from({ length: 12 }, (_, i) => `Model ${i + 1}`);
    const { trigger, onChange } = setup({ options: many, value: "Model 1" });
    fireEvent.click(trigger);
    const search = screen.getByRole("textbox", { name: "Search options" });
    fireEvent.change(search, { target: { value: "model 1" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Model 1", "Model 10", "Model 11", "Model 12"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.change(search, { target: { value: "12" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Model 12");
  });

  it("renders group labels, meta and the empty option", () => {
    const { trigger } = setup({
      value: "",
      emptyLabel: "Default",
      options: [
        { value: "g1", label: "Nano Banana", group: "Google", meta: "$0.04" },
        { value: "g2", label: "Imagen 4", group: "Google" },
        { value: "o1", label: "GPT Image", group: "OpenAI" },
      ],
    });
    expect(trigger).toHaveTextContent("Default");
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    expect(list).toHaveTextContent("Google");
    expect(list).toHaveTextContent("OpenAI");
    expect(list).toHaveTextContent("$0.04");
    expect(optionValues(trigger)).toEqual(["", "g1", "g2", "o1"]);
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Default");
  });

  it("shows the placeholder when the value matches nothing", () => {
    const { trigger } = setup({ value: "nope", placeholder: "Choose…" });
    expect(trigger).toHaveTextContent("Choose…");
  });

  it("mounts the list in the React Flow viewport, in flow coordinates", () => {
    const flow = document.createElement("div");
    flow.className = "react-flow";
    const viewport = document.createElement("div");
    viewport.className = "react-flow__viewport";
    viewport.style.transform = "matrix(2, 0, 0, 2, 100, 50)";
    flow.appendChild(viewport);
    const host = document.createElement("div");
    flow.appendChild(host);
    document.body.appendChild(flow);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ left: 100, top: 50, width: 0, height: 0, right: 0, bottom: 0, x: 100, y: 50, toJSON: () => ({}) });

    render(<Dropdown value="1:1" options={RATIOS} onChange={() => {}} aria-label="Ratio" />, { container: host });
    const trigger = screen.getByRole("combobox", { name: "Ratio" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 300, top: 250, width: 200, height: 44, right: 500, bottom: 294, x: 300, y: 250, toJSON: () => ({}) });
    act(() => { fireEvent.click(trigger); });
    const list = screen.getByRole("listbox");
    expect(list.parentElement).toBe(viewport);
    expect(list.style.position).toBe("absolute");
    expect(list.style.left).toBe("100px"); // (300 − 100) / 2
    expect(list.style.top).toBe("126px"); // (294 − 50) / 2 + 4
    expect(list.style.width).toBe("160px"); // 200 / 2 = 100, raised to the 160 minimum
    document.body.removeChild(flow);
  });

  it("falls back to a fixed list on the body outside React Flow", () => {
    const { trigger } = setup();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 40, top: 20, width: 220, height: 22, right: 260, bottom: 42, x: 40, y: 20, toJSON: () => ({}) });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    expect(list.parentElement).toBe(document.body);
    expect(list.style.position).toBe("fixed");
    expect(list.style.top).toBe("46px");
    expect(list.style.width).toBe("220px");
  });

  it("flips above the trigger when the window edge is close", () => {
    const { trigger } = setup();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 40, top: window.innerHeight - 60, width: 220, height: 22, right: 260, bottom: window.innerHeight - 38, x: 40, y: window.innerHeight - 60, toJSON: () => ({}) });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    expect(list.style.transform).toBe("translateY(-100%)");
    expect(list.style.top).toBe(`${window.innerHeight - 64}px`);
  });
  it("takes a trigger of its own and lines the list up with the trigger's right edge", () => {
    // An icon button at the right of a settings row: the list hangs from its
    // right edge rather than running off the card.
    render(
      <Dropdown
        value="fixed"
        options={[
          { value: "random", label: "Random", icon: <svg data-testid="icon-random" /> },
          { value: "fixed", label: "Fixed", icon: <svg data-testid="icon-fixed" /> },
        ]}
        onChange={vi.fn()}
        trigger={<svg data-testid="mode-glyph" />}
        triggerClassName="w-[22px] h-[22px]"
        align="end"
        aria-label="After each run: Fixed"
      />
    );
    const trigger = screen.getByRole("combobox", { name: "After each run: Fixed" });
    expect(within(trigger).getByTestId("mode-glyph")).toBeInTheDocument();
    expect(within(trigger).queryByText("Fixed")).toBeNull();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 238, top: 20, width: 22, height: 22, right: 260, bottom: 42, x: 238, y: 20, toJSON: () => ({}) });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    // At the node density's minimum width, ending where the trigger ends.
    expect(list.style.width).toBe("160px");
    expect(list.style.left).toBe("100px");
    expect(within(list).getByTestId("icon-random")).toBeInTheDocument();
  });
});
