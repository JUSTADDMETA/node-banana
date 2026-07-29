import { describe, it, expect } from "vitest";

import { outputsToNodeData } from "../comfyAppExecutor";

describe("outputsToNodeData", () => {
  const declared = [
    { id: "9", type: "image" },
    { id: "12", type: "image" },
    { id: "20", type: "text" },
    { id: "30", type: "video" },
  ];

  it("keys every result by its handle", () => {
    const data = outputsToNodeData(declared, [
      { handleId: "9", type: "image", value: "data:image/png;base64,AAA" },
      { handleId: "20", type: "text", value: "a caption" },
    ]);
    expect(data.outputs).toEqual({
      "9": "data:image/png;base64,AAA",
      "20": "a caption",
    });
  });

  it("mirrors the first result of each type for downstream consumers", () => {
    const data = outputsToNodeData(declared, [
      { handleId: "12", type: "image", value: "second" },
      { handleId: "9", type: "image", value: "first" },
      { handleId: "20", type: "text", value: "a caption" },
    ]);
    // Declared order decides which is "first", not the order results arrived —
    // otherwise the same run could mirror a different output each time.
    expect(data.outputImage).toBe("first");
    expect(data.outputText).toBe("a caption");
  });

  it("nulls the mirrors for types this run produced nothing for", () => {
    const data = outputsToNodeData(declared, [
      { handleId: "9", type: "image", value: "only-image" },
    ]);
    expect(data.outputVideo).toBeNull();
    expect(data.outputAudio).toBeNull();
    expect(data.outputText).toBeNull();
    expect(data.output3dUrl).toBeNull();
  });

  it("skips a declared handle that produced nothing when picking the mirror", () => {
    const data = outputsToNodeData(declared, [
      { handleId: "12", type: "image", value: "second-only" },
    ]);
    expect(data.outputImage).toBe("second-only");
  });

  it("handles a run that produced nothing at all", () => {
    const data = outputsToNodeData(declared, []);
    expect(data.outputs).toEqual({});
    expect(data.outputImage).toBeNull();
  });
});
