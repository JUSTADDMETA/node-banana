import { describe, expect, it } from "vitest";
import { AGENT_MAX_ATTACHMENTS, type AgentAttachment, type AgentRunOutput } from "../../types";
import { attachmentOf, attachmentThumbSrc, mergeAttachments, toggleAttachment } from "../attachments";

function output(extra: Partial<AgentRunOutput> = {}): AgentRunOutput {
  return { id: "o-1", nodeId: "nanoBanana-1", nodeTitle: "Rougher 1", nodeType: "nanoBanana", kind: "image", assetId: "a-1", sha256: "sha", ...extra };
}

const item = (n: number): AgentAttachment => ({ assetId: `a-${n}`, kind: "image", nodeId: `n-${n}`, nodeTitle: `N ${n}` });

describe("attachmentOf", () => {
  it("carries what the library holds and the model can see: an image, or a video with its frame", () => {
    expect(attachmentOf(output(), "tab-a")).toEqual({
      assetId: "a-1",
      kind: "image",
      nodeId: "nanoBanana-1",
      nodeTitle: "Rougher 1",
      tabId: "tab-a",
      sha256: "sha",
    });
    expect(attachmentOf(output({ kind: "video", hasPoster: true }), "tab-a")).toMatchObject({ kind: "video", hasPoster: true });
    expect(attachmentOf(output({ kind: "video" }), "tab-a")).toBeNull();
    expect(attachmentOf(output({ kind: "audio" }), "tab-a")).toBeNull();
    expect(attachmentOf(output({ kind: "text", text: "hi" }), "tab-a")).toBeNull();
    expect(attachmentOf(output({ assetId: undefined, live: true }), "tab-a")).toBeNull();
  });
});

describe("attachmentThumbSrc", () => {
  it("uses the small thumbnail, a video's poster frame, else the image's file", () => {
    expect(attachmentThumbSrc({ ...item(1), sha256: "sha" })).toBe("/api/assets/thumb/sha?w=320");
    expect(attachmentThumbSrc({ ...item(1), kind: "video", sha256: "sha", hasPoster: true })).toBe("/api/assets/thumb/sha?w=320&poster=1");
    expect(attachmentThumbSrc(item(1))).toBe("/api/assets/a-1/file");
  });
});

describe("toggleAttachment and mergeAttachments", () => {
  it("adds, takes out again, and stops at what one message carries", () => {
    expect(toggleAttachment([], item(1))).toEqual({ list: [item(1)] });
    expect(toggleAttachment([item(1), item(2)], item(1))).toEqual({ list: [item(2)] });
    const full = Array.from({ length: AGENT_MAX_ATTACHMENTS }, (_, n) => item(n));
    expect(toggleAttachment(full, item(99))).toEqual({ list: full, full: true });
    // Taking one out of a full list still works.
    expect(toggleAttachment(full, item(0)).list).toHaveLength(AGENT_MAX_ATTACHMENTS - 1);
  });

  it("merges without repeats, the list's own first, up to the cap", () => {
    expect(mergeAttachments([item(1)], [item(1), item(2)])).toEqual([item(1), item(2)]);
    const many = Array.from({ length: 10 }, (_, n) => item(n));
    expect(mergeAttachments([], many)).toHaveLength(AGENT_MAX_ATTACHMENTS);
  });
});
