/**
 * view_outputs: the results nodes generated, as pictures the model can look
 * at. The snapshot names each node's results by asset id; a reader turns an
 * id into a downsized image and what made it.
 */

import type {
  AgentAttachment,
  AgentSnapshotOutput,
  AgentTabSummary,
  AgentToolImage,
  AgentToolResult,
  AgentWorkflowSnapshot,
} from "../types";
import type { DraftNode, GraphDraft } from "../graph/draft";
import { titleOf } from "../graph/draft";
import { asName } from "../graph/describe";

/** Images per call: about 1,400 tokens each at 1024px, so a dozen stays well inside a turn. */
export const VIEW_OUTPUTS_MAX_IMAGES = 12;
const PROMPT_LIMIT = 280;
/** An attached result's prompt is often what the user wants changed: most of it, not a glimpse. */
const ATTACHED_PROMPT_LIMIT = 1_500;

/** One result as the model sees it: a picture when there is one, and what made it. */
export interface ViewableOutput {
  kind: "image" | "video" | "audio" | "3d";
  image?: { mime: string; data: string };
  prompt?: string;
  model?: string;
  createdAt?: number;
  batch?: { index: number; count: number };
}

/** A result the library holds for a node, from `newestFrom`. */
export interface SavedOutput {
  assetId: string;
  kind: ViewableOutput["kind"];
  /** From the node's newest run. */
  newest: boolean;
}

export interface AgentOutputReader {
  /** Null when the library has no such result (deleted, or made before the library). */
  read(assetId: string): Promise<ViewableOutput | null>;
  /**
   * The results node `nodeId` of workflow `workflowId` saved in its newest
   * `runs` runs, newest first: for a node whose snapshot names none (one that
   * keeps no carousel of asset ids, such as a ComfyUI app or an image tool).
   */
  newestFrom?(workflowId: string, nodeId: string, runs: number): Promise<SavedOutput[]>;
}

interface ViewOutputsArgs {
  nodeIds?: string[];
  takes?: number;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const nameOf = (node: DraftNode) => {
  const title = titleOf(node);
  return `${title ? asName(title) : node.type} (${node.id})`;
};
const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
/** Nodes that hold a file the user brought, never a generated result. */
const UPLOAD_TYPES: ReadonlySet<string> = new Set(["imageInput", "videoInput", "audioInput"]);
/** Nodes that show what another node made: view_outputs looks at that node instead. */
const DISPLAY_TYPES: ReadonlySet<string> = new Set(["output", "outputGallery", "imageCompare"]);

const holdsMedia = (node: DraftNode) => Boolean(node.content?.image || node.content?.video || node.content?.audio || node.content?.model3d);

/** The nodes feeding `node`, in the order of their connections. */
function feedersOf(draft: GraphDraft, node: DraftNode): DraftNode[] {
  const feeders: DraftNode[] = [];
  for (const edge of draft.edges) {
    if (edge.target !== node.id) continue;
    const source = draft.getNode(edge.source);
    if (source && !feeders.includes(source)) feeders.push(source);
  }
  return feeders;
}

type Wanted = { node: DraftNode; output: Pick<AgentSnapshotOutput, "assetId" | "current" | "newest">; saved: boolean };

export async function viewOutputs(draft: GraphDraft, reader: AgentOutputReader, args: ViewOutputsArgs): Promise<AgentToolResult> {
  const notes: string[] = [];
  const workflowId = draft.workflowId;
  const lookUp = reader.newestFrom && workflowId ? reader.newestFrom.bind(reader) : null;
  // The library can name a result its snapshot doesn't: a node with media but no asset ids.
  const findable = (node: DraftNode) => Boolean(lookUp) && holdsMedia(node) && !UPLOAD_TYPES.has(node.type);
  let nodes: DraftNode[] = [];
  const add = (node: DraftNode) => {
    if (!nodes.includes(node)) nodes.push(node);
  };
  if (args.nodeIds?.length) {
    for (const key of args.nodeIds) {
      const node = draft.getNode(key) ?? draft.getNode(draft.refs.get(key) ?? "");
      if (!node) {
        notes.push(`No node "${key}" on the canvas.`);
        continue;
      }
      const feeders = !node.outputs?.length && DISPLAY_TYPES.has(node.type) ? feedersOf(draft, node) : [];
      if (feeders.length === 0) {
        add(node);
        continue;
      }
      notes.push(`${nameOf(node)} shows what ${list(feeders.map(nameOf))} made: looked at ${feeders.length === 1 ? "that node" : "those nodes"} instead.`);
      feeders.forEach(add);
    }
  } else {
    // Every node with a result, left to right as the canvas reads.
    nodes = [...draft.nodes.values()]
      .filter((node) => node.outputs?.length || (findable(node) && !DISPLAY_TYPES.has(node.type)))
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  }

  const takes = Math.min(Math.max(args.takes ?? 1, 1), 4);
  const found = await Promise.all(
    nodes.map((node) =>
      !node.outputs?.length && findable(node) ? lookUp!(workflowId!, node.id, takes).catch(() => [] as SavedOutput[]) : Promise.resolve([] as SavedOutput[]),
    ),
  );
  const wanted: Wanted[] = [];
  nodes.forEach((node, index) => {
    const outputs = node.outputs ?? [];
    if (outputs.length > 0) {
      for (const output of outputs.slice(0, takes)) wanted.push({ node, output, saved: false });
      return;
    }
    const saved = found[index];
    if (saved.length > 0) {
      for (const output of saved) wanted.push({ node, output: { assetId: output.assetId, ...(output.newest ? { newest: true as const } : {}) }, saved: true });
      return;
    }
    const content = node.content;
    notes.push(
      !holdsMedia(node)
        ? `${nameOf(node)} has no generated result to look at.`
        : UPLOAD_TYPES.has(node.type)
          ? `${nameOf(node)} holds an uploaded file, which cannot be viewed.`
          : DISPLAY_TYPES.has(node.type)
            ? `${nameOf(node)} shows a result no connected node made, so it cannot be viewed.`
            : !content?.image && !content?.video
              ? `${nameOf(node)}'s result is ${content?.audio ? "audio" : "a 3D model"}, which cannot be viewed.`
              : `${nameOf(node)}'s result is not in the asset library (made before the library, copied from another workflow, or its save failed), so it cannot be viewed.`,
    );
  });
  const shown = wanted.slice(0, VIEW_OUTPUTS_MAX_IMAGES);
  if (wanted.length > shown.length) {
    notes.push(`${wanted.length - shown.length} more results were left out (at most ${VIEW_OUTPUTS_MAX_IMAGES} per call): ask for fewer nodes or takes to see them.`);
  }

  const read = await Promise.all(shown.map(({ output }) => reader.read(output.assetId).catch(() => null)));
  const images: AgentToolImage[] = [];
  const seenNodes = new Set<string>();
  shown.forEach(({ node, output, saved }, index) => {
    const found = read[index];
    const which = saved
      ? output.newest
        ? "the newest result it saved"
        : "an older take"
      : output.current
        ? `the result it shows${output.newest ? "" : " (an older take)"}`
        : output.newest
          ? "its newest result, which it does not show"
          : "an older take";
    if (!found) {
      notes.push(`${nameOf(node)}, ${which}: no longer in the asset library.`);
      return;
    }
    if (!found.image) {
      const why =
        found.kind === "video"
          ? "the video has no captured frame yet"
          : found.kind === "audio"
            ? "audio cannot be viewed"
            : found.kind === "3d"
              ? "3D models cannot be viewed"
              : "its picture could not be read";
      notes.push(`${nameOf(node)}, ${which}: ${why}.`);
      return;
    }
    seenNodes.add(node.id);
    const caption = [
      `Image ${images.length + 1}: ${nameOf(node)}, ${which}${found.kind === "video" ? ", the video's first frame" : ""}`,
      found.batch ? `run ${found.batch.index + 1} of ${found.batch.count}` : "",
      found.model ? `model ${asName(found.model)}` : "",
      found.prompt ? `prompt ${asName(found.prompt, PROMPT_LIMIT)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    images.push({ mime: found.image.mime, data: found.image.data, caption });
  });

  const head =
    images.length > 0
      ? `${plural(images.length, "image")} from ${plural(seenNodes.size, "node")} follow, each after its caption.`
      : "There is nothing to look at: no node has a generated image or video frame in the asset library yet.";
  return {
    ok: true,
    text: [head, ...notes].join("\n"),
    summary: images.length > 0 ? `Looked at ${plural(images.length, "image")} from ${plural(seenNodes.size, "node")}` : "Nothing to look at yet",
    ops: [],
    ...(seenNodes.size > 0 ? { focusNodeIds: [...seenNodes] } : {}),
    ...(images.length > 0 ? { images } : {}),
  };
}

/** The canvases a turn was sent with: where an attached result's node is now. */
export interface AttachmentCanvases {
  workflow: AgentWorkflowSnapshot;
  parkedWorkflows?: Record<string, AgentWorkflowSnapshot>;
  tabs?: readonly AgentTabSummary[];
}

/** Where an attached result's node is, and whether it still shows that result: for its caption. */
export function locateAttachment(attachment: AgentAttachment, canvases: AttachmentCanvases): string {
  const { workflow, parkedWorkflows, tabs } = canvases;
  const live = !attachment.tabId || !workflow.tabId || attachment.tabId === workflow.tabId;
  const snapshot = live ? workflow : parkedWorkflows?.[attachment.tabId!];
  const node = snapshot?.nodes.find((candidate) => candidate.id === attachment.nodeId);
  if (!snapshot || !node) return "its node is no longer on an open canvas";
  // A node that keeps no carousel of asset ids (a ComfyUI app, an image tool) can't say which it shows.
  const shown = node.outputs?.some((output) => output.assetId === attachment.assetId && output.current);
  const state = !node.outputs?.length ? "" : shown ? ", the result it shows" : ", not the result it shows now";
  if (live) return `on the live canvas${state}`;
  const name = tabs?.find((tab) => tab.id === attachment.tabId)?.name;
  return `in the ${name ? `${asName(name)} ` : ""}tab ${attachment.tabId} (switch_workflow to work on it)${state}`;
}

/**
 * The results the user attached to their message, read as view_outputs reads
 * a node's. `text` lists them for the turn's prompt (where each node is, its
 * model and prompt, or why it can't be shown); each picture follows the
 * message after a short caption that matches its line.
 */
export async function attachedResults(
  attachments: readonly AgentAttachment[],
  reader: AgentOutputReader,
  canvases: AttachmentCanvases,
): Promise<{ text: string; images: AgentToolImage[] }> {
  const read = await Promise.all(attachments.map((attachment) => reader.read(attachment.assetId).catch(() => null)));
  const lines: string[] = [];
  const images: AgentToolImage[] = [];
  attachments.forEach((attachment, index) => {
    const name = `${asName(attachment.nodeTitle)} (${attachment.nodeId})`;
    const found = read[index];
    if (!found) {
      lines.push(`- ${name}'s ${attachment.kind}: no longer in the asset library, so it cannot be shown.`);
      return;
    }
    if (!found.image) {
      const why = found.kind === "video" ? "the video has no captured frame yet" : "its picture could not be read";
      lines.push(`- ${name}'s ${found.kind}: ${why}.`);
      return;
    }
    const label = `Image ${images.length + 1}: ${name}`;
    lines.push(
      [
        `- ${label}, ${locateAttachment(attachment, canvases)}${found.kind === "video" ? ", the video's first frame" : ""}`,
        found.batch ? `run ${found.batch.index + 1} of ${found.batch.count}` : "",
        found.model ? `model ${asName(found.model)}` : "",
        found.prompt ? `prompt ${asName(found.prompt, ATTACHED_PROMPT_LIMIT)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    images.push({ mime: found.image.mime, data: found.image.data, caption: label });
  });
  const head =
    images.length > 0
      ? `The user added ${plural(attachments.length, "result")} from the chat to this message. The pictures follow the message, each after its caption:`
      : `The user added ${plural(attachments.length, "result")} from the chat to this message, but none can be shown:`;
  return { text: [head, ...lines].join("\n"), images };
}
