/**
 * Prompt nodes for a Comfy app's text inputs.
 *
 * A workflow's saved prompts are often what makes it run as intended the
 * first time (a system prompt for its prompt-rewriting model, say), and the
 * canvas only shows them as empty handles. When a workflow is attached, each
 * text input that carries the author's text gets a Prompt node holding it,
 * wired to that handle, laid out in a column to the node's left.
 */
import type { ComfyAppDefinition } from "./types";
import { appInputHandles } from "./nodeSchema";

export interface SeededPromptNode {
  /** The Comfy app's target handle. */
  handleId: string;
  label: string;
  text: string;
  position: { x: number; y: number };
}

/** The Prompt node's default width and height (see nodeDefaults), and the air around them. */
const PROMPT_W = 320;
const PROMPT_H = 220;
const COLUMN_GAP = 80;
const ROW_GAP = 24;

/**
 * The Prompt nodes to create for `app` attached to a node at `node`, in the
 * app's input order; empty when no text input carries saved text.
 * `connected` names the handles that already have a wire, which keep it.
 */
export function promptNodesFor(
  app: ComfyAppDefinition,
  node: { x: number; y: number },
  connected: ReadonlySet<string> = new Set()
): SeededPromptNode[] {
  const seeded = appInputHandles(app).filter(
    (input) => input.type === "text" && typeof input.default === "string" && input.default.trim() && !connected.has(input.handleId)
  );
  return seeded.map((input, index) => ({
    handleId: input.handleId,
    label: input.label,
    text: input.default as string,
    position: { x: node.x - PROMPT_W - COLUMN_GAP, y: node.y + index * (PROMPT_H + ROW_GAP) },
  }));
}
