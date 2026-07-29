import { describe, it, expect } from "vitest";

import { inspectWorkflow, normalizeInputs, uniqueSlug } from "../inspect";
import type { ComfyAppInput, ComfyGraph, ComfyObjectInfo } from "../types";

const graph = (): ComfyGraph => ({
  "16": { class_type: "LoadImage", inputs: { image: "product.png" }, _meta: { title: "Product" } },
  "24": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a cat", clip: ["5", 0] },
    _meta: { title: "Prompt" },
  },
  "31": { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 8, model: ["5", 0] } },
  "9": { class_type: "SaveImage", inputs: { images: ["31", 0], filename_prefix: "ComfyUI" } },
  "5": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd.safetensors" } },
});

describe("uniqueSlug", () => {
  it("slugifies and de-duplicates", () => {
    const taken = new Set<string>();
    expect(uniqueSlug("Product · Image", taken)).toBe("product_image");
    expect(uniqueSlug("Product · Image", taken)).toBe("product_image_2");
    expect(uniqueSlug("!!!", taken)).toBe("input");
  });
});

describe("inspectWorkflow without App Mode", () => {
  const inspection = inspectWorkflow(graph(), { defaultName: "My Workflow" });

  it("finds the loaders, sinks and widgets", () => {
    expect(inspection.imageInputCandidates.map((c) => c.nodeId)).toEqual(["16"]);
    expect(inspection.outputCandidates.map((c) => c.nodeId)).toEqual(["9"]);
    expect(inspection.widgetCandidates.map((c) => `${c.nodeId}.${c.inputKey}`).sort()).toEqual([
      "24.text",
      "31.cfg",
      "31.seed",
      "31.steps",
      "5.ckpt_name",
    ]);
  });

  it("proposes the image loader and the prompt as connectable inputs", () => {
    expect(inspection.suggested.inputs.map((i) => [i.type, i.nodeId, i.inputKey])).toEqual([
      ["image", "16", "image"],
      ["text", "24", "text"],
    ]);
  });

  it("binds the Save node as the output", () => {
    expect(inspection.suggested.outputs).toEqual([
      { id: "9", label: "SaveImage (#9)", type: "image", nodeId: "9", classType: "SaveImage" },
    ]);
  });

  it("suggests no inline parameters until the user picks some", () => {
    expect(inspection.suggested.params).toEqual([]);
  });

  it("marks seed widgets so they can be re-randomised per run", () => {
    expect(inspection.widgetCandidates.find((c) => c.inputKey === "seed")?.isSeed).toBe(true);
    expect(inspection.widgetCandidates.find((c) => c.inputKey === "steps")?.isSeed).toBe(false);
  });

  it("uses the node title in labels when the author set one", () => {
    expect(inspection.suggested.inputs[0]?.label).toBe("Product");
    expect(inspection.widgetCandidates.find((c) => c.nodeId === "24")?.label).toBe("Prompt · Text");
  });
});

describe("inspectWorkflow with App Mode", () => {
  const inspection = inspectWorkflow(graph(), {
    defaultName: "Curated",
    appMode: {
      inputs: [
        { nodeId: "16", widget: "image" },
        { nodeId: "24", widget: "text" },
        { nodeId: "31", widget: "steps" },
        { nodeId: "31", widget: "seed" },
      ],
      outputNodeIds: ["9"],
    },
  });

  it("follows the author's selection, in their order", () => {
    expect(inspection.hasAppMode).toBe(true);
    expect(inspection.suggested.inputs.map((i) => i.id)).toEqual(["16:image", "24:text"]);
    expect(inspection.suggested.params.map((p) => p.id)).toEqual(["31:steps", "31:seed"]);
  });

  it("splits a loader's upload widget into an input, not a text parameter", () => {
    const image = inspection.suggested.inputs[0];
    expect(image).toMatchObject({ type: "image", nodeId: "16", inputKey: "image", required: true });
    expect(inspection.suggested.params.some((p) => p.nodeId === "16")).toBe(false);
  });

  it("carries widget defaults through to the parameters", () => {
    expect(inspection.suggested.params.find((p) => p.id === "31:steps")).toMatchObject({
      type: "integer",
      default: 20,
    });
  });

  it("flags exactly the widgets the author curated", () => {
    const curated = inspection.widgetCandidates.filter((c) => c.fromAppMode);
    expect(curated.map((c) => `${c.nodeId}.${c.inputKey}`).sort()).toEqual([
      "24.text",
      "31.seed",
      "31.steps",
    ]);
  });

  it("ignores App Mode entries for nodes the conversion dropped", () => {
    const partial = inspectWorkflow(graph(), {
      appMode: { inputs: [{ nodeId: "999", widget: "seed" }], outputNodeIds: ["999"] },
    });
    expect(partial.suggested.params).toEqual([]);
    // With no valid App Mode output, every real sink is bound instead — an app
    // that produced nothing would be useless.
    expect(partial.suggested.outputs.map((o) => o.nodeId)).toEqual(["9"]);
  });
});

describe("inspectWorkflow parameter typing", () => {
  const objectInfo: ComfyObjectInfo = {
    KSampler: {
      input: {
        required: {
          sampler_name: [["euler", "dpmpp_2m"], { tooltip: "Which sampler." }],
          steps: ["INT", { default: 20, min: 1, max: 150 }],
        },
      },
    },
  };

  it("turns a combo widget into a select with its options", () => {
    const withCombo: ComfyGraph = {
      "1": { class_type: "KSampler", inputs: { sampler_name: "euler", steps: 20 } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const inspection = inspectWorkflow(withCombo, {
      objectInfo,
      appMode: { inputs: [{ nodeId: "1", widget: "sampler_name" }], outputNodeIds: ["2"] },
    });
    expect(inspection.suggested.params[0]).toMatchObject({
      type: "string",
      enum: ["euler", "dpmpp_2m"],
      default: "euler",
      description: "Which sampler.",
    });
  });

  it("carries numeric bounds so the node can validate input", () => {
    const withNumber: ComfyGraph = {
      "1": { class_type: "KSampler", inputs: { steps: 20 } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const inspection = inspectWorkflow(withNumber, {
      objectInfo,
      appMode: { inputs: [{ nodeId: "1", widget: "steps" }], outputNodeIds: ["2"] },
    });
    expect(inspection.suggested.params[0]).toMatchObject({ minimum: 1, maximum: 150 });
  });
});

describe("inspectWorkflow warnings", () => {
  it("warns when the workflow produces nothing", () => {
    const sinkless: ComfyGraph = { "1": { class_type: "KSampler", inputs: { steps: 20 } } };
    const inspection = inspectWorkflow(sinkless);
    expect(inspection.suggested.outputs).toEqual([]);
    expect(inspection.warnings.join(" ")).toMatch(/no Save or Preview node/);
  });

  it("warns when nothing can be fed in", () => {
    const closed: ComfyGraph = {
      "1": { class_type: "KSampler", inputs: { steps: 20 } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    expect(inspectWorkflow(closed).warnings.join(" ")).toMatch(/No inputs were detected/);
  });

  it("prefers a Save node over a Preview when both exist", () => {
    const both: ComfyGraph = {
      "1": { class_type: "PreviewImage", inputs: { images: ["3", 0] } },
      "2": { class_type: "SaveImage", inputs: { images: ["3", 0] } },
      "3": { class_type: "KSampler", inputs: { steps: 20 } },
    };
    expect(inspectWorkflow(both).suggested.outputs.map((o) => o.nodeId)).toEqual(["2"]);
  });

  it("falls back to a Preview when it is the only sink", () => {
    const previewOnly: ComfyGraph = {
      "1": { class_type: "PreviewImage", inputs: { images: ["3", 0] } },
      "3": { class_type: "KSampler", inputs: { steps: 20 } },
    };
    expect(inspectWorkflow(previewOnly).suggested.outputs.map((o) => o.nodeId)).toEqual(["1"]);
  });
});

describe("normalizeInputs", () => {
  it("re-derives unique names after the user renames labels", () => {
    const inputs: ComfyAppInput[] = [
      { id: "a", name: "x", label: "Reference", type: "image", nodeId: "1", inputKey: "image", required: true },
      { id: "b", name: "x", label: "Reference", type: "image", nodeId: "2", inputKey: "image", required: true },
    ];
    expect(normalizeInputs(inputs).map((i) => i.name)).toEqual(["reference", "reference_2"]);
  });
});
