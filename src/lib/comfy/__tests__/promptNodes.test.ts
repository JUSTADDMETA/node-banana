import { describe, it, expect } from "vitest";
import { promptNodesFor } from "../promptNodes";
import type { ComfyAppDefinition } from "../types";

const app = (inputs: ComfyAppDefinition["inputs"]): ComfyAppDefinition => ({
  id: "app", name: "Krea", description: "", source: "upload", graph: {}, inputs, params: [], outputs: [], classTypes: [], nodeCount: 3, createdAt: 0,
});
const text = (id: string, label: string, def?: string) => ({ id, name: label.toLowerCase().replace(/\W+/g, "_"), label, type: "text" as const, nodeId: id.split(":")[0]!, inputKey: "value", required: false, ...(def !== undefined ? { default: def } : {}) });

describe("promptNodesFor", () => {
  it("seeds one Prompt node per text input that carries saved text, in a column to the left, wired by handle", () => {
    const seeds = promptNodesFor(app([
      text("18:value", "Text String (System Prompt)", "You are an expert prompt engineer."),
      { id: "16:image", name: "image", label: "Image", type: "image", nodeId: "16", inputKey: "image", required: true },
      text("19:value", "Text String (User Prompt)", "a soccer player"),
      text("20:value", "Empty", "   "),
      text("21:value", "Unsaved"),
    ]), { x: 1000, y: 300 });
    expect(seeds).toEqual([
      { handleId: "text-0", label: "Text String (System Prompt)", text: "You are an expert prompt engineer.", position: { x: 600, y: 300 } },
      { handleId: "text-1", label: "Text String (User Prompt)", text: "a soccer player", position: { x: 600, y: 544 } },
    ]);
  });

  it("leaves a handle that already has a wire alone", () => {
    const seeds = promptNodesFor(app([text("18:value", "System", "sys"), text("19:value", "User", "usr")]), { x: 0, y: 0 }, new Set(["text-0"]));
    expect(seeds.map((s) => s.handleId)).toEqual(["text-1"]);
  });
});
