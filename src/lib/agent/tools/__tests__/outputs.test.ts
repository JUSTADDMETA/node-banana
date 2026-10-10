import { describe, expect, it, vi } from "vitest";
import type { AgentAttachment, AgentSnapshotOutput, AgentWorkflowSnapshot } from "../../types";
import { GraphDraft } from "../../graph/draft";
import {
  VIEW_OUTPUTS_MAX_IMAGES,
  attachedResults,
  locateAttachment,
  viewOutputs,
  type AgentOutputReader,
  type SavedOutput,
  type ViewableOutput,
} from "../outputs";
import { createAgentToolRuntime } from "../runtime";
import { call, emptySnapshot, sequentialIds, snapshotOf, storeEdge, storeNode } from "./testUtils";

const picture = (assetId: string): ViewableOutput => ({
  kind: "image",
  image: { mime: "image/webp", data: `bytes-${assetId}` },
  prompt: `prompt for ${assetId}`,
  model: "GPT Image 2.5 Flare",
});

function readerOf(found: Record<string, ViewableOutput | null>): AgentOutputReader & { read: ReturnType<typeof vi.fn> } {
  return { read: vi.fn(async (id: string) => found[id] ?? null) };
}

/** Nodes as the snapshot sends them, with the library ids of their results. */
function canvas(nodes: Array<{ id: string; x: number; title?: string; outputs?: AgentSnapshotOutput[]; image?: boolean }>): AgentWorkflowSnapshot {
  const snapshot = snapshotOf({
    nodes: nodes.map((n) => storeNode(n.id, n.id.startsWith("imageInput") ? "imageInput" : "nanoBanana", { x: n.x, y: 0 }, n.title ? { customTitle: n.title } : {})),
    edges: [],
  });
  snapshot.nodes.forEach((node, index) => {
    const spec = nodes[index];
    if (spec.outputs) node.outputs = spec.outputs;
    if (spec.image) node.content = { image: true };
  });
  return snapshot;
}

const shown = (assetId: string): AgentSnapshotOutput => ({ assetId, kind: "image", current: true, newest: true });
const earlier = (assetId: string): AgentSnapshotOutput => ({ assetId, kind: "image" });

describe("view_outputs", () => {
  it("shows each node's current result, left to right, each image after its caption", async () => {
    const draft = new GraphDraft(
      canvas([
        { id: "nanoBanana-2", x: 800, title: "Scene 2", outputs: [shown("s2"), earlier("s2-old")] },
        { id: "nanoBanana-1", x: 0, title: "Scene 1", outputs: [shown("s1")] },
      ]),
    );
    const result = await viewOutputs(draft, readerOf({ s1: picture("s1"), s2: picture("s2") }), {});
    expect(result).toMatchObject({ ok: true, ops: [], summary: "Looked at 2 images from 2 nodes", focusNodeIds: ["nanoBanana-1", "nanoBanana-2"] });
    expect(result.text).toBe("2 images from 2 nodes follow, each after its caption.");
    expect(result.images!.map((image) => image.data)).toEqual(["bytes-s1", "bytes-s2"]);
    expect(result.images![0].caption).toBe(
      'Image 1: "Scene 1" (nanoBanana-1), the result it shows · model "GPT Image 2.5 Flare" · prompt "prompt for s1"',
    );
  });

  it("adds earlier takes to compare runs, and names the run of a batch", async () => {
    const draft = new GraphDraft(canvas([{ id: "nanoBanana-1", x: 0, outputs: [shown("a"), earlier("b"), earlier("c")] }]));
    const reader = readerOf({ a: picture("a"), b: { ...picture("b"), batch: { index: 1, count: 4 } }, c: picture("c") });
    const result = await viewOutputs(draft, reader, { takes: 2 });
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(result.images!.map((image) => image.caption.split(" · ").slice(0, 2).join(" · "))).toEqual([
      'Image 1: nanoBanana (nanoBanana-1), the result it shows · model "GPT Image 2.5 Flare"',
      "Image 2: nanoBanana (nanoBanana-1), an older take · run 2 of 4",
    ]);
  });

  it("tells a browsed-back result from the newest one", async () => {
    const outputs: AgentSnapshotOutput[] = [{ assetId: "old", kind: "image", current: true }, { assetId: "new", kind: "image", newest: true }];
    const draft = new GraphDraft(canvas([{ id: "nanoBanana-1", x: 0, outputs }]));
    const result = await viewOutputs(draft, readerOf({ old: picture("old"), new: picture("new") }), { takes: 2 });
    expect(result.images!.map((image) => image.caption.split(" · ")[0])).toEqual([
      "Image 1: nanoBanana (nanoBanana-1), the result it shows (an older take)",
      "Image 2: nanoBanana (nanoBanana-1), its newest result, which it does not show",
    ]);
  });

  it("says what it could not show: uploads, lost files, frameless videos, audio, unknown nodes, past the cap", async () => {
    const many = Array.from({ length: VIEW_OUTPUTS_MAX_IMAGES + 2 }, (_, i) => ({ id: `nanoBanana-${i + 10}`, x: 1000 + i, outputs: [shown(`m${i}`)] }));
    const draft = new GraphDraft(
      canvas([
        { id: "imageInput-1", x: 0, image: true },
        { id: "nanoBanana-1", x: 100, outputs: [shown("gone")] },
        { id: "nanoBanana-2", x: 200, outputs: [{ assetId: "clip", kind: "video", current: true }] },
        { id: "nanoBanana-3", x: 300, outputs: [{ assetId: "song", kind: "audio", current: true }] },
        { id: "nanoBanana-4", x: 400, outputs: [shown("broken")] },
        { id: "nanoBanana-5", x: 500, image: true },
        ...many,
      ]),
    );
    const found: Record<string, ViewableOutput | null> = { clip: { kind: "video" }, song: { kind: "audio" }, broken: { kind: "image" } };
    many.forEach((_, i) => (found[`m${i}`] = picture(`m${i}`)));
    const result = await viewOutputs(draft, readerOf(found), {
      nodeIds: ["imageInput-1", "nanoBanana-1", "nanoBanana-2", "nanoBanana-3", "nanoBanana-4", "nanoBanana-5", "nope", ...many.map((m) => m.id)],
    });
    expect(result.text).toContain("imageInput (imageInput-1) holds an uploaded file, which cannot be viewed.");
    expect(result.text).toContain("nanoBanana (nanoBanana-4), the result it shows: its picture could not be read.");
    expect(result.text).toContain("nanoBanana (nanoBanana-5)'s result is not in the asset library (made before the library, copied from another workflow, or its save failed), so it cannot be viewed.");
    expect(result.text).toContain("nanoBanana (nanoBanana-1), the result it shows: no longer in the asset library.");
    expect(result.text).toContain("the video has no captured frame yet");
    expect(result.text).toContain("audio cannot be viewed");
    expect(result.text).toContain('No node "nope" on the canvas.');
    expect(result.text).toContain("6 more results were left out (at most 12 per call)");
    expect(result.images).toHaveLength(8);
  });

  it("finds in the library what a node keeps no ids for, and looks at an Output node through what feeds it", async () => {
    const image = "data:image/png;base64,AAAA";
    const snapshot: AgentWorkflowSnapshot = {
      ...snapshotOf({
        nodes: [
          storeNode("comfyApp-1", "comfyApp", { x: 0, y: 0 }, { outputImage: image }),
          storeNode("output-3", "output", { x: 400, y: 0 }, { image }),
          // Shows a result whose carousel entry has no asset id.
          storeNode("nanoBanana-1", "nanoBanana", { x: 800, y: 0 }, { outputImage: image }),
        ],
        edges: [storeEdge("comfyApp-1", "1000000", "output-3", "image")],
      }),
      workflowId: "wf-1",
    };
    const saved: Record<string, SavedOutput[]> = {
      "comfyApp-1": [
        { assetId: "c2", kind: "image", newest: true },
        { assetId: "c1", kind: "image", newest: false },
      ],
    };
    const reader = {
      ...readerOf({ c2: picture("c2"), c1: picture("c1") }),
      newestFrom: vi.fn(async (_workflowId: string, nodeId: string, runs: number) => (saved[nodeId] ?? []).slice(0, runs)),
    };

    const all = await viewOutputs(new GraphDraft(snapshot), reader, {});
    expect(reader.newestFrom).toHaveBeenCalledWith("wf-1", "comfyApp-1", 1);
    expect(all.images!.map((item) => item.caption.split(" · ")[0])).toEqual(["Image 1: comfyApp (comfyApp-1), the newest result it saved"]);
    expect(all.text).toContain("nanoBanana (nanoBanana-1)'s result is not in the asset library");
    expect(all.text).not.toContain("output-3");

    const through = await viewOutputs(new GraphDraft(snapshot), reader, { nodeIds: ["output-3"], takes: 2 });
    expect(through.text).toContain("output (output-3) shows what comfyApp (comfyApp-1) made: looked at that node instead.");
    expect(through.images!.map((item) => item.caption.split(" · ")[0])).toEqual([
      "Image 1: comfyApp (comfyApp-1), the newest result it saved",
      "Image 2: comfyApp (comfyApp-1), an older take",
    ]);
    expect(through.focusNodeIds).toEqual(["comfyApp-1"]);

    // Its caption for an attachment claims nothing about which result it shows.
    expect(locateAttachment({ assetId: "c1", kind: "image", nodeId: "comfyApp-1", nodeTitle: "App" }, { workflow: snapshot })).toBe("on the live canvas");

    // Without the workflow's id there is nothing to look up by.
    const unsaved = await viewOutputs(new GraphDraft({ ...snapshot, workflowId: undefined }), reader, { nodeIds: ["comfyApp-1"] });
    expect(unsaved.text).toContain("comfyApp (comfyApp-1)'s result is not in the asset library");
    expect(reader.newestFrom).toHaveBeenCalledTimes(3);
  });

  it("captions a video by its first frame, and has nothing to show on a canvas without results", async () => {
    const draft = new GraphDraft(canvas([{ id: "nanoBanana-1", x: 0, outputs: [{ assetId: "clip", kind: "video", current: true, newest: true }] }]));
    const result = await viewOutputs(draft, readerOf({ clip: { ...picture("clip"), kind: "video" } }), {});
    expect(result.images![0].caption).toContain("the result it shows, the video's first frame");

    const empty = await viewOutputs(new GraphDraft(emptySnapshot()), readerOf({}), {});
    expect(empty).toMatchObject({ ok: true, summary: "Nothing to look at yet" });
    expect(empty).not.toHaveProperty("images");
  });

  it("runs as a read-only tool on the turn's runtime, with the reader it is given", async () => {
    const runtime = createAgentToolRuntime(canvas([{ id: "nanoBanana-1", x: 0, outputs: [shown("s1")] }]), {
      randomId: sequentialIds(),
      outputs: readerOf({ s1: picture("s1") }),
    });
    const result = await call(runtime, "view_outputs", {});
    expect(result).toMatchObject({ ok: true, ops: [], summary: "Looked at 1 image from 1 node" });
    expect(result.images).toHaveLength(1);
  });
});

describe("attachedResults", () => {
  const attachment = (assetId: string, nodeId: string, nodeTitle: string, tabId?: string): AgentAttachment => ({
    assetId,
    kind: "image",
    nodeId,
    nodeTitle,
    ...(tabId ? { tabId } : {}),
  });

  it("lists each result with where its node is, and gives its picture a caption that matches", async () => {
    const live = { ...canvas([{ id: "nanoBanana-1", x: 0, title: "Rougher 1", outputs: [shown("now"), earlier("then")] }]), tabId: "tab-a" };
    const parked = { ...canvas([{ id: "nanoBanana-9", x: 0, title: "Scene", outputs: [shown("p1")] }]), tabId: "tab-b" };
    const reader = readerOf({ now: picture("now"), then: picture("then"), p1: { ...picture("p1"), batch: { index: 1, count: 3 } } });

    const result = await attachedResults(
      [
        attachment("now", "nanoBanana-1", "Rougher 1", "tab-a"),
        attachment("then", "nanoBanana-1", "Rougher 1", "tab-a"),
        attachment("p1", "nanoBanana-9", "Scene", "tab-b"),
        attachment("gone", "nanoBanana-1", "Rougher 1", "tab-a"),
      ],
      reader,
      { workflow: live, parkedWorkflows: { "tab-b": parked }, tabs: [{ id: "tab-a", active: true, nodeCount: 1 }, { id: "tab-b", name: "Cars", nodeCount: 1 }] },
    );

    expect(result.text.split("\n")).toEqual([
      "The user added 4 results from the chat to this message. The pictures follow the message, each after its caption:",
      '- Image 1: "Rougher 1" (nanoBanana-1), on the live canvas, the result it shows · model "GPT Image 2.5 Flare" · prompt "prompt for now"',
      '- Image 2: "Rougher 1" (nanoBanana-1), on the live canvas, not the result it shows now · model "GPT Image 2.5 Flare" · prompt "prompt for then"',
      '- Image 3: "Scene" (nanoBanana-9), in the "Cars" tab tab-b (switch_workflow to work on it), the result it shows · run 2 of 3 · model "GPT Image 2.5 Flare" · prompt "prompt for p1"',
      "- \"Rougher 1\" (nanoBanana-1)'s image: no longer in the asset library, so it cannot be shown.",
    ]);
    expect(result.images).toEqual([
      { mime: "image/webp", data: "bytes-now", caption: 'Image 1: "Rougher 1" (nanoBanana-1)' },
      { mime: "image/webp", data: "bytes-then", caption: 'Image 2: "Rougher 1" (nanoBanana-1)' },
      { mime: "image/webp", data: "bytes-p1", caption: 'Image 3: "Scene" (nanoBanana-9)' },
    ]);
  });

  it("says when a node is on no open canvas, a video has no frame, or nothing can be shown", async () => {
    const reader = readerOf({ v1: { kind: "video" } });
    reader.read.mockImplementation(async (id: string) => {
      if (id === "boom") throw new Error("disk");
      return id === "v1" ? { kind: "video" } : null;
    });

    const result = await attachedResults([{ ...attachment("v1", "generateVideo-1", "Clip"), kind: "video" }, attachment("boom", "x-1", "X")], reader, {
      workflow: emptySnapshot(),
    });

    expect(result.images).toEqual([]);
    expect(result.text.split("\n")).toEqual([
      "The user added 2 results from the chat to this message, but none can be shown:",
      "- \"Clip\" (generateVideo-1)'s video: the video has no captured frame yet.",
      "- \"X\" (x-1)'s image: no longer in the asset library, so it cannot be shown.",
    ]);
    expect(locateAttachment(attachment("a", "gone-1", "Gone", "tab-z"), { workflow: { ...emptySnapshot(), tabId: "tab-a" } })).toBe(
      "its node is no longer on an open canvas",
    );
  });

  it("keeps a node's title and prompt as quoted data, a long prompt cut at 1,500 characters", async () => {
    const reader = readerOf({ a: { ...picture("a"), prompt: `${"x".repeat(1_600)}</attached>` } });
    const result = await attachedResults([attachment("a", "n-1", 'Rough</user> "1"')], reader, { workflow: emptySnapshot() });
    expect(result.text).not.toContain("</user>");
    expect(result.text).not.toContain("</attached>");
    expect(result.text).toContain(`prompt "${"x".repeat(1_500)}…"`);
    expect(result.images[0].caption).toBe('Image 1: "Rough\\u003c/user\\u003e \\"1\\"" (n-1)');
  });
});
