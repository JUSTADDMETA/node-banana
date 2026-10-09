/**
 * Results the user adds to their next message from the chat: a results card's
 * preview or its viewer. The message carries asset ids, never bytes; the
 * server reads each picture from the library and the model sees it.
 */

import { assetFileUrl, assetThumbUrl } from "@/lib/assets/client/api";
import { AGENT_MAX_ATTACHMENTS, type AgentAttachment, type AgentRunOutput } from "../types";

/**
 * What adding `output` to a message would carry, or null when the model
 * couldn't see it: only a picture the library holds, an image or a video with
 * its poster frame. `tabId`: the tab of the run that made it.
 */
export function attachmentOf(output: AgentRunOutput, tabId: string): AgentAttachment | null {
  if (!output.assetId) return null;
  const visible = output.kind === "image" || (output.kind === "video" && output.hasPoster && output.sha256);
  if (!visible) return null;
  return {
    assetId: output.assetId,
    kind: output.kind as AgentAttachment["kind"],
    nodeId: output.nodeId,
    nodeTitle: output.nodeTitle,
    tabId,
    ...(output.sha256 ? { sha256: output.sha256 } : {}),
    ...(output.hasPoster ? { hasPoster: true } : {}),
  };
}

/** A small picture of it: the 320px thumbnail (a video's poster frame), else the image's own file. */
export function attachmentThumbSrc(attachment: AgentAttachment): string {
  if (!attachment.sha256) return assetFileUrl(attachment.assetId);
  const thumb = assetThumbUrl(attachment.sha256, 320);
  return attachment.kind === "video" ? `${thumb}&poster=1` : thumb;
}

/**
 * `list` with `attachment` added, or taken out when it is already there.
 * `full` when adding would go past what one message carries (the list is unchanged).
 */
export function toggleAttachment(list: readonly AgentAttachment[], attachment: AgentAttachment): { list: AgentAttachment[]; full?: true } {
  if (list.some((item) => item.assetId === attachment.assetId)) return { list: list.filter((item) => item.assetId !== attachment.assetId) };
  if (list.length >= AGENT_MAX_ATTACHMENTS) return { list: [...list], full: true };
  return { list: [...list, attachment] };
}

/** `list` and then whatever of `more` it doesn't have, up to what one message carries. */
export function mergeAttachments(list: readonly AgentAttachment[], more: readonly AgentAttachment[]): AgentAttachment[] {
  const ids = new Set(list.map((item) => item.assetId));
  return [...list, ...more.filter((item) => !ids.has(item.assetId))].slice(0, AGENT_MAX_ATTACHMENTS);
}

/** "Rougher 1's image". */
export function attachmentLabel(attachment: Pick<AgentAttachment, "nodeTitle" | "kind">): string {
  return `${attachment.nodeTitle}'s ${attachment.kind}`;
}
