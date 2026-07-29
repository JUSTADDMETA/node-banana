import { describe, it, expect } from "vitest";

import {
  blueprintAppMode,
  blueprintToWorkflowFile,
  ComfyConversionError,
  convertEditorGraph,
  editorNodeTypes,
  extractAppMode,
  extractBlueprints,
  isEditorFormat,
  parseAppModeInputId,
  type EditorWorkflowFile,
} from "../editor";
import type { ComfyObjectInfo } from "../types";

const catalog: ComfyObjectInfo = {
  LoadImage: { input: { required: { image: [["a.png"], { image_upload: true }] } } },
  CLIPTextEncode: {
    input: { required: { text: ["STRING", { multiline: true }], clip: ["CLIP", {}] } },
  },
  KSampler: {
    input: {
      required: {
        seed: ["INT", { default: 0, control_after_generate: true }],
        steps: ["INT", { default: 20 }],
        model: ["MODEL", {}],
      },
    },
  },
  SaveImage: { input: { required: { images: ["IMAGE", {}], filename_prefix: ["STRING", {}] } } },
  ImageCompare: {
    input: { required: { image: ["IMAGE", {}], compare_view: [["side", "slider"], {}] } },
  },
};

describe("isEditorFormat", () => {
  it("distinguishes a save file from an API export", () => {
    expect(isEditorFormat({ nodes: [], links: [] })).toBe(true);
    expect(isEditorFormat({ "1": { class_type: "LoadImage", inputs: {} } })).toBe(false);
  });
});

describe("convertEditorGraph", () => {
  it("maps positional widget values onto named inputs", () => {
    const file: EditorWorkflowFile = {
      nodes: [
        { id: 1, type: "LoadImage", widgets_values: ["cat.png", "image"] },
        { id: 2, type: "CLIPTextEncode", widgets_values: ["a dog"], inputs: [] },
      ],
      links: [],
    };
    const graph = convertEditorGraph(file, catalog);
    expect(graph["1"]?.inputs.image).toBe("cat.png");
    expect(graph["2"]?.inputs.text).toBe("a dog");
  });

  it("skips the control value a seed widget serialises alongside itself", () => {
    const file: EditorWorkflowFile = {
      nodes: [{ id: 3, type: "KSampler", widgets_values: [12345, "randomize", 30], inputs: [] }],
      links: [],
    };
    const graph = convertEditorGraph(file, catalog);
    expect(graph["3"]?.inputs.seed).toBe(12345);
    // Without skipping "randomize", steps would read as a string.
    expect(graph["3"]?.inputs.steps).toBe(30);
  });

  it("fills a required widget the save omitted with the engine's default", () => {
    const file: EditorWorkflowFile = {
      nodes: [{ id: 1, type: "ImageCompare", widgets_values: [], inputs: [] }],
      links: [],
    };
    const graph = convertEditorGraph(file, catalog);
    // The frontend always sends a widget value, so the engine expects one.
    expect(graph["1"]?.inputs.compare_view).toBe("side");
  });

  it("restores connections as [nodeId, slot] links", () => {
    const file: EditorWorkflowFile = {
      nodes: [
        { id: 1, type: "KSampler", widgets_values: [1, "fixed", 20], inputs: [], outputs: [{ type: "IMAGE" }] },
        {
          id: 2,
          type: "SaveImage",
          widgets_values: ["out"],
          inputs: [{ name: "images", type: "IMAGE", link: 7 }],
        },
      ],
      links: [[7, 1, 0, 2, 0, "IMAGE"]],
    };
    const graph = convertEditorGraph(file, catalog);
    expect(graph["2"]?.inputs.images).toEqual(["1", 0]);
  });

  it("drops muted nodes and the links into them", () => {
    const file: EditorWorkflowFile = {
      nodes: [
        { id: 1, type: "KSampler", mode: 2, widgets_values: [1, "fixed", 20], outputs: [{ type: "IMAGE" }] },
        {
          id: 2,
          type: "SaveImage",
          widgets_values: ["out"],
          inputs: [{ name: "images", type: "IMAGE", link: 7 }],
        },
      ],
      links: [[7, 1, 0, 2, 0, "IMAGE"]],
    };
    const graph = convertEditorGraph(file, catalog);
    expect(graph["1"]).toBeUndefined();
    expect(graph["2"]?.inputs.images).toBeUndefined();
  });

  it("routes through a bypassed node to its upstream source", () => {
    const file: EditorWorkflowFile = {
      nodes: [
        { id: 1, type: "LoadImage", widgets_values: ["cat.png", "image"], outputs: [{ type: "IMAGE" }] },
        {
          id: 2,
          type: "ImageCompare",
          mode: 4,
          inputs: [{ name: "image", type: "IMAGE", link: 1 }],
          outputs: [{ type: "IMAGE" }],
        },
        {
          id: 3,
          type: "SaveImage",
          widgets_values: ["out"],
          inputs: [{ name: "images", type: "IMAGE", link: 2 }],
        },
      ],
      links: [
        [1, 1, 0, 2, 0, "IMAGE"],
        [2, 2, 0, 3, 0, "IMAGE"],
      ],
    };
    const graph = convertEditorGraph(file, catalog);
    expect(graph["2"]).toBeUndefined();
    expect(graph["3"]?.inputs.images).toEqual(["1", 0]);
  });

  it("follows a Reroute through to the real origin", () => {
    const file: EditorWorkflowFile = {
      nodes: [
        { id: 1, type: "LoadImage", widgets_values: ["cat.png", "image"], outputs: [{ type: "IMAGE" }] },
        {
          id: 2,
          type: "Reroute",
          inputs: [{ name: "", type: "*", link: 1 }],
          outputs: [{ type: "IMAGE" }],
        },
        {
          id: 3,
          type: "SaveImage",
          widgets_values: ["out"],
          inputs: [{ name: "images", type: "IMAGE", link: 2 }],
        },
      ],
      links: [
        [1, 1, 0, 2, 0, "IMAGE"],
        [2, 2, 0, 3, 0, "IMAGE"],
      ],
    };
    const graph = convertEditorGraph(file, catalog);
    expect(graph["2"]).toBeUndefined();
    expect(graph["3"]?.inputs.images).toEqual(["1", 0]);
  });

  it("expands a subgraph instance with namespaced inner ids", () => {
    const file: EditorWorkflowFile = {
      nodes: [
        {
          id: 50,
          type: "sub-uuid",
          inputs: [],
          outputs: [{ type: "IMAGE" }],
        },
      ],
      links: [],
      definitions: {
        subgraphs: [
          {
            id: "sub-uuid",
            name: "Inner",
            nodes: [{ id: 7, type: "LoadImage", widgets_values: ["inner.png", "image"] }],
            links: [],
            inputs: [],
            outputs: [{ name: "IMAGE", type: "IMAGE", linkIds: [] }],
          },
        ],
      },
    };
    const graph = convertEditorGraph(file, catalog);
    expect(graph["50:7"]?.class_type).toBe("LoadImage");
    expect(graph["50:7"]?.inputs.image).toBe("inner.png");
  });

  it("names every node the catalog is missing rather than the first one", () => {
    const file: EditorWorkflowFile = {
      nodes: [
        { id: 1, type: "SomeCustomNode", widgets_values: [1] },
        { id: 2, type: "AnotherCustomNode", widgets_values: [2] },
      ],
      links: [],
    };
    expect(editorNodeTypes(file)).toEqual(["AnotherCustomNode", "SomeCustomNode"]);
    expect(() => convertEditorGraph(file, catalog)).toThrow(ComfyConversionError);
  });

  it("maps a CustomCombo's full option list, past what the schema declares", () => {
    const file: EditorWorkflowFile = {
      nodes: [{ id: 1, type: "CustomCombo", widgets_values: ["b", 1, "a", "b", "c", "  "] }],
      links: [],
    };
    const graph = convertEditorGraph(file, catalog);
    expect(graph["1"]?.inputs).toMatchObject({
      choice: "b",
      index: 1,
      option1: "a",
      option2: "b",
      option3: "c",
    });
    // The trailing blank the editor leaves to grow into is not an option.
    expect(graph["1"]?.inputs.option4).toBeUndefined();
  });

  it("rejects a workflow with nothing executable in it", () => {
    expect(() =>
      convertEditorGraph({ nodes: [{ id: 1, type: "Note", widgets_values: ["hi"] }], links: [] }, catalog)
    ).toThrow(ComfyConversionError);
  });
});

describe("parseAppModeInputId", () => {
  it("accepts a bare node id", () => {
    expect(parseAppModeInputId("3")).toEqual({ nodeId: "3" });
    expect(parseAppModeInputId(3)).toEqual({ nodeId: "3" });
  });

  it("decodes a WidgetId triple into its node and widget", () => {
    expect(parseAppModeInputId("graph-uuid:12:steps")).toEqual({ nodeId: "12", widget: "steps" });
    expect(parseAppModeInputId("g:12:model.aspect%5Fratio")).toEqual({
      nodeId: "12",
      widget: "model.aspect_ratio",
    });
  });

  it("keeps a legacy pair intact — it is already the namespaced form", () => {
    expect(parseAppModeInputId("50:7")).toEqual({ nodeId: "50:7" });
  });

  it("rejects junk", () => {
    expect(parseAppModeInputId("")).toBeNull();
    expect(parseAppModeInputId(null)).toBeNull();
  });
});

describe("extractAppMode", () => {
  const base = (extra: EditorWorkflowFile["extra"]): EditorWorkflowFile => ({
    nodes: [
      { id: 3, type: "KSampler" },
      { id: 9, type: "SaveImage" },
      { id: 16, type: "LoadImage" },
    ],
    links: [],
    extra,
  });

  it("reads a modern export that omits the linearMode flag", () => {
    const result = extractAppMode(
      base({ linearData: { inputs: [["3", "seed"], ["3", "steps"]], outputs: ["9"] } })
    );
    expect(result).toEqual({
      inputs: [
        { nodeId: "3", widget: "seed" },
        { nodeId: "3", widget: "steps" },
      ],
      outputNodeIds: ["9"],
    });
  });

  it("honours an explicit linearMode: false", () => {
    expect(
      extractAppMode(base({ linearMode: false, linearData: { inputs: [["3", "seed"]], outputs: ["9"] } }))
    ).toBeNull();
  });

  it("keeps every output node, not just the first", () => {
    const result = extractAppMode(
      base({ linearData: { inputs: [["16", "image"]], outputs: ["9", "16", "3"] } })
    );
    expect(result?.outputNodeIds).toEqual(["9", "16", "3"]);
  });

  it("drops entries pointing at nodes that no longer exist", () => {
    const result = extractAppMode(
      base({ linearData: { inputs: [["3", "seed"], ["99", "seed"]], outputs: ["9", "404"] } })
    );
    expect(result?.inputs).toEqual([{ nodeId: "3", widget: "seed" }]);
    expect(result?.outputNodeIds).toEqual(["9"]);
  });

  it("tolerates the optional third layout element", () => {
    const result = extractAppMode(
      base({ linearData: { inputs: [["3", "seed", { height: 98 }]], outputs: [] } })
    );
    expect(result?.inputs).toEqual([{ nodeId: "3", widget: "seed" }]);
  });

  it("resolves a WidgetId against the namespaced ids conversion produced", () => {
    const file: EditorWorkflowFile = {
      nodes: [{ id: 50, type: "sub-uuid" }],
      links: [],
      extra: { linearData: { inputs: [["sub-uuid:7:image", "image"]], outputs: ["8"] } },
    };
    const result = extractAppMode(file, ["50:7", "50:8"]);
    expect(result?.inputs).toEqual([{ nodeId: "50:7", widget: "image" }]);
    expect(result?.outputNodeIds).toEqual(["50:8"]);
  });

  it("drops an ambiguous namespaced match rather than binding the wrong node", () => {
    const file: EditorWorkflowFile = {
      nodes: [{ id: 50, type: "sub-uuid" }],
      links: [],
      extra: { linearData: { inputs: [["g:5:seed", "seed"]], outputs: ["8"] } },
    };
    // Bare id "5" suffix-matches both "140:5" and "77:5" — binding it to either
    // would silently apply the author's selection to the wrong node, so it is
    // dropped. The unambiguous output still resolves.
    const ambiguous = extractAppMode(file, ["140:5", "77:5", "140:8"]);
    expect(ambiguous?.inputs).toEqual([]);
    expect(ambiguous?.outputNodeIds).toEqual(["140:8"]);
    // With only one candidate it resolves.
    expect(extractAppMode(file, ["140:5", "140:8"])?.inputs).toEqual([
      { nodeId: "140:5", widget: "seed" },
    ]);
  });

  it("de-duplicates repeated selections", () => {
    const result = extractAppMode(
      base({ linearData: { inputs: [["3", "seed"], ["3", "seed"]], outputs: ["9", "9"] } })
    );
    expect(result?.inputs).toHaveLength(1);
    expect(result?.outputNodeIds).toEqual(["9"]);
  });

  it("returns null when nothing survives", () => {
    expect(extractAppMode(base({ linearData: { inputs: [], outputs: [] } }))).toBeNull();
    expect(extractAppMode(base({}))).toBeNull();
  });
});

describe("blueprints", () => {
  const blueprintFile = (): EditorWorkflowFile => ({
    nodes: [
      {
        id: 135,
        type: "3b5ed000",
        title: "Crop Images 2x2",
        inputs: [{ name: "image", type: "IMAGE", link: null }],
        outputs: [{ name: "IMAGE", type: "IMAGE" }],
        widgets_values: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ properties: { proxyWidgets: [["45", "text"], ["31", "seed"], ["31", "control_after_generate"]] } } as any),
      },
    ],
    links: [],
    definitions: {
      subgraphs: [
        {
          id: "3b5ed000",
          name: "Crop Images 2x2",
          nodes: [
            { id: 45, type: "CLIPTextEncode", widgets_values: ["a cat"], inputs: [] },
            { id: 31, type: "KSampler", widgets_values: [1, "fixed", 20], inputs: [] },
          ],
          links: [],
          inputs: [{ name: "image", type: "IMAGE", linkIds: [] }],
          outputs: [
            { name: "IMAGE", type: "IMAGE", linkIds: [] },
            { name: "LATENT", type: "LATENT", linkIds: [] },
          ],
        },
      ],
    },
    extra: { BlueprintDescription: "Splits an image into four." } as EditorWorkflowFile["extra"],
  });

  it("summarises each subgraph's boundary slots", () => {
    const [blueprint] = extractBlueprints(blueprintFile());
    expect(blueprint).toMatchObject({
      id: "3b5ed000",
      name: "Crop Images 2x2",
      description: "Splits an image into four.",
      inputNames: ["image"],
      outputNames: ["IMAGE", "LATENT"],
      nodeCount: 2,
      source: "workflow",
    });
  });

  it("appends a sink per displayable boundary output", () => {
    const { workflow, instanceNodeId, skippedOutputs } = blueprintToWorkflowFile(
      blueprintFile(),
      "3b5ed000"
    );
    expect(instanceNodeId).toBe("135");
    // A blueprint's results leave through slots, not a SaveImage — without an
    // appended sink the run would persist nothing.
    expect(workflow.nodes.filter((n) => n.type === "SaveImage")).toHaveLength(1);
    // LATENT has nothing a node could display.
    expect(skippedOutputs).toEqual(["LATENT (LATENT)"]);
  });

  it("materialises a loader for each media boundary input", () => {
    const { workflow } = blueprintToWorkflowFile(blueprintFile(), "3b5ed000");
    const loader = workflow.nodes.find((n) => n.type === "LoadImage");
    // A blueprint takes its image through a boundary *slot*, so without a
    // materialised loader it would inspect as having no inputs at all.
    expect(loader).toBeDefined();
    // The instance's socket must now point at that loader's link.
    const instance = workflow.nodes.find((n) => String(n.id) === "135");
    const socket = instance?.inputs?.find((i) => i.name === "image");
    expect(socket?.link).toEqual(expect.any(Number));
    expect(workflow.links?.some((l) => Array.isArray(l) && l[0] === socket?.link)).toBe(true);
  });

  it("leaves the caller's file untouched so a second blueprint still converts", () => {
    const file = blueprintFile();
    blueprintToWorkflowFile(file, "3b5ed000");
    // The instance's sockets are rewritten during lifting — on a copy, not the
    // source, which the caller may inspect again.
    expect(file.nodes[0]?.inputs?.[0]?.link).toBeNull();
  });

  it("carries the author's widget rename so proxied widgets stay distinguishable", () => {
    const file = blueprintFile();
    // Two PrimitiveFloat.value widgets would otherwise share a label.
    file.definitions!.subgraphs![0]!.nodes[0]!.inputs = [
      { name: "text", type: "STRING", label: "prompt", widget: { name: "text" } },
    ];
    const appMode = blueprintAppMode(file, "3b5ed000", "135");
    expect(appMode?.inputs[0]).toEqual({ nodeId: "135:45", widget: "text", label: "prompt" });
  });

  it("treats proxied widgets as the author's curated parameters", () => {
    const appMode = blueprintAppMode(blueprintFile(), "3b5ed000", "135");
    expect(appMode?.inputs).toEqual([
      { nodeId: "135:45", widget: "text" },
      { nodeId: "135:31", widget: "seed" },
    ]);
    // `control_after_generate` is a frontend affordance, not an engine input.
    expect(appMode?.inputs.some((i) => i.widget === "control_after_generate")).toBe(false);
  });

  it("reports a boundary input it cannot supply instead of building a broken app", () => {
    const file = blueprintFile();
    file.definitions!.subgraphs![0]!.inputs = [
      { name: "image", type: "IMAGE", linkIds: [] },
      { name: "model", type: "MODEL", linkIds: [] },
    ];
    file.nodes[0]!.inputs = [
      { name: "image", type: "IMAGE", link: null },
      { name: "model", type: "MODEL", link: null },
    ];
    const { unsupportedInputs } = blueprintToWorkflowFile(file, "3b5ed000");
    // A MODEL slot has no loader and is not a widget, so the inner node would
    // be missing a required input the engine rejects.
    expect(unsupportedInputs).toEqual(["model (MODEL)"]);
  });

  it("reports a blueprint id that is not in the file", () => {
    expect(() => blueprintToWorkflowFile(blueprintFile(), "nope")).toThrow(ComfyConversionError);
  });
});
