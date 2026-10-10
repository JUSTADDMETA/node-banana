import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { ComfyNodePreview } from "@/components/modals/ComfyNodePreview";
import { optionValues, pickOption } from "@/test/dropdown";
import type { ComfyAppInput, ComfyAppOutput, ComfyAppParam } from "@/lib/comfy/types";

/**
 * The preview is the node the import dialog is about to build, drawn as the
 * canvas draws it: header above, sockets in the media card's border, the
 * controls card with its summary row and settings below.
 */

const input = (over: Partial<ComfyAppInput> = {}): ComfyAppInput => ({
  id: "139:123",
  name: "prompt",
  label: "prompt",
  type: "text",
  nodeId: "139",
  inputKey: "123",
  required: false,
  ...over,
});

const output = (over: Partial<ComfyAppOutput> = {}): ComfyAppOutput => ({
  id: "9",
  label: "IMAGE",
  type: "image",
  nodeId: "9",
  classType: "SaveImage",
  ...over,
});

/** The shape of a Blueprint the dialog confirms: two inputs, one output, a few settings and a seed. */
const blueprint = {
  name: "Image Edit (Flux.2 Dev)",
  source: "blueprint" as const,
  nodeCount: 23,
  inputs: [input(), input({ id: "1000000:image", name: "image", label: "image", type: "image" })],
  outputs: [output()],
  params: [
    { id: "10:vae_name", label: "vae_name", nodeId: "10", inputKey: "vae_name", type: "string", enum: ["full_encoder.safetensors"], default: "full_encoder.safetensors" },
    { id: "31:steps", label: "steps", nodeId: "31", inputKey: "steps", type: "integer", default: 20 },
    { id: "25:noise_seed", label: "Noise Seed", nodeId: "25", inputKey: "noise_seed", type: "integer", default: 342971778941390, isSeed: true },
  ] satisfies ComfyAppParam[],
};

const marks = (container: HTMLElement, side: "left" | "right") =>
  [...container.querySelectorAll<HTMLElement>(`[data-socket-mark="${side}"]`)];

describe("ComfyNodePreview", () => {
  it("titles the node in the floating header with the name being typed", () => {
    const { container } = render(<ComfyNodePreview {...blueprint} />);
    const preview = container.querySelector("[data-comfy-node-preview]") as HTMLElement;
    // Above the media card, as on the canvas, not inside it.
    const card = preview.querySelector("[data-media-card]") as HTMLElement;
    expect(within(card).queryByText(blueprint.name)).toBeNull();
    expect(screen.getByText(blueprint.name)).toBeInTheDocument();
    // The wordmark leads the header and the summary row, as on the node.
    expect(screen.getAllByRole("img", { name: "ComfyUI app" })).toHaveLength(2);
  });

  it("puts one socket per input on the left and per output on the right, in order, each labelled", () => {
    const { container } = render(<ComfyNodePreview {...blueprint} />);
    const left = marks(container, "left");
    const right = marks(container, "right");
    expect(left.map((el) => el.dataset.handletype)).toEqual(["text", "image"]);
    expect(right.map((el) => el.dataset.handletype)).toEqual(["image"]);
    // At the socket pitch, from the card's top: 24px to the first centre, then 30px.
    expect(left.map((el) => el.style.top)).toEqual(["10px", "40px"]);
    for (const label of ["prompt", "image", "IMAGE"]) {
      expect(screen.getByText(label)).toHaveStyle({ opacity: "1" });
    }
  });

  it("sits the sockets in the media card's border", () => {
    const { container } = render(<ComfyNodePreview {...blueprint} />);
    const card = container.querySelector("[data-media-card]") as HTMLElement;
    expect(marks(container, "left").every((el) => el.parentElement === card)).toBe(true);
    expect(card.querySelector("[data-media-clip]")).toHaveTextContent("No output yet");
  });

  it("summarises the workflow in the controls card: where it came from and how big it is", () => {
    render(<ComfyNodePreview {...blueprint} />);
    expect(screen.getByText("Blueprint")).toBeInTheDocument();
    expect(screen.getByText("23 nodes")).toBeInTheDocument();
    render(<ComfyNodePreview {...blueprint} source="upload" nodeCount={1} />);
    expect(screen.getByText("App workflow")).toBeInTheDocument();
    expect(screen.getByText("1 node")).toBeInTheDocument();
  });

  it("opens with the settings showing, seeded as the node seeds them", () => {
    render(<ComfyNodePreview {...blueprint} />);
    expect(screen.getByRole("button", { name: "Collapse settings" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("vae_name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
    // A seed shows the seed its first run uses, chosen as a new node chooses it.
    const seed = screen.getByPlaceholderText("342971778941390") as HTMLInputElement;
    expect(Number.isInteger(seed.valueAsNumber)).toBe(true);
  });

  it("offers what a seed does after each run, beside the seed", () => {
    render(<ComfyNodePreview {...blueprint} />);
    const mode = screen.getByRole("combobox", { name: "After each run: Random" });
    expect(optionValues(mode)).toEqual(["random", "fixed", "increment", "decrement"]);
    pickOption(mode, "fixed");
    expect(screen.getByRole("combobox", { name: "After each run: Fixed" })).toBeInTheDocument();
  });

  it("folds the settings away from the chevron, and keeps an edit", () => {
    render(<ComfyNodePreview {...blueprint} />);
    fireEvent.change(screen.getByDisplayValue("20"), { target: { value: "30" } });
    fireEvent.blur(screen.getByDisplayValue("30"));
    fireEvent.click(screen.getByRole("button", { name: "Collapse settings" }));
    expect(screen.getByRole("button", { name: "Expand settings" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Expand settings" }));
    expect(screen.getByDisplayValue("30")).toBeInTheDocument();
  });

  it("is only the summary row when the workflow exposes no settings, as on the canvas", () => {
    render(<ComfyNodePreview {...blueprint} params={[]} />);
    expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
    expect(screen.getByText("Blueprint")).toBeInTheDocument();
  });

  it("keeps the seed it chose while the other picks change", () => {
    const { rerender } = render(<ComfyNodePreview {...blueprint} />);
    const before = (screen.getByPlaceholderText("342971778941390") as HTMLInputElement).value;
    rerender(<ComfyNodePreview {...blueprint} name="Renamed" outputs={[output(), output({ id: "12", label: "MASK" })]} />);
    expect((screen.getByPlaceholderText("342971778941390") as HTMLInputElement).value).toBe(before);
  });

  it("follows the picks as they change", () => {
    const { container, rerender } = render(<ComfyNodePreview {...blueprint} />);
    rerender(
      <ComfyNodePreview
        {...blueprint}
        name="Renamed"
        inputs={[blueprint.inputs[1]]}
        outputs={[output(), output({ id: "12", label: "MASK", type: "image" })]}
      />
    );
    expect(screen.getByText("Renamed")).toBeInTheDocument();
    expect(marks(container, "left")).toHaveLength(1);
    expect(marks(container, "right")).toHaveLength(2);
    expect(screen.queryByText("prompt")).toBeNull();
    expect(screen.getByText("MASK")).toBeInTheDocument();
  });
});
