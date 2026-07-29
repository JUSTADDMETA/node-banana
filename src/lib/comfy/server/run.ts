/**
 * Running one Comfy app: bind the node's live inputs into its stored graph,
 * hand it to the engine, and turn what comes back into data URLs the canvas
 * can render.
 *
 * Submission and collection are deliberately split. A diffusion run routinely
 * outlives a serverless invocation, so the client submits once and then polls a
 * separate short-lived route — the same shape the Kie provider already uses for
 * long video jobs.
 */

import { patchGraph, pruneToOutputs } from "../graph";
import type {
  ComfyAppDefinition,
  ComfyGraph,
  ComfyResolvedOutput,
} from "../types";
import type { ComfyEngine, ComfyOutputAsset } from "./engine";
import { ComfyEngineError } from "./engine";

/** Seeds must stay inside the range JSON can round-trip without precision loss. */
const MAX_SEED = Number.MAX_SAFE_INTEGER;

/** A deterministic seed derived from a run key. */
export function hashSeed(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return Math.abs(h) % MAX_SEED;
}

/** One connected input, already resolved to bytes by the caller. */
export interface ResolvedInputMedia {
  /** `ComfyAppInput.name` this satisfies. */
  name: string;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export interface BuildRunGraphOptions {
  app: ComfyAppDefinition;
  /** Text values for text-typed inputs, keyed by `ComfyAppInput.name`. */
  text: Record<string, string>;
  /** Media already uploaded to the engine, keyed by `ComfyAppInput.name`. */
  uploads: Record<string, unknown>;
  /** Inline parameter values, keyed by `ComfyAppParam.id`. */
  params: Record<string, unknown>;
  /** When set, every unpinned seed widget is replaced with this value. */
  seed?: number;
}

/**
 * The graph to submit for one run.
 *
 * Inputs the user left unconnected keep whatever the workflow was saved with,
 * so a partially-wired app still runs — the author's own values are a sensible
 * default, and refusing to run would be worse than producing their example.
 */
export function buildRunGraph(options: BuildRunGraphOptions): ComfyGraph {
  const { app, text, uploads, params } = options;

  const media: Array<{ nodeId: string; inputKey: string; value: unknown }> = [];
  const assignments: Array<{ nodeId: string; inputKey: string; value: unknown }> = [];

  for (const input of app.inputs) {
    if (input.type === "text") {
      const value = text[input.name];
      if (value !== undefined) {
        assignments.push({ nodeId: input.nodeId, inputKey: input.inputKey, value });
      }
      continue;
    }
    const uploaded = uploads[input.name];
    if (uploaded !== undefined) {
      media.push({ nodeId: input.nodeId, inputKey: input.inputKey, value: uploaded });
    }
  }

  const pinnedSeeds: Array<{ nodeId: string; inputKey: string }> = [];
  for (const param of app.params) {
    const value = params[param.id];
    if (value === undefined || value === null || value === "") continue;
    assignments.push({ nodeId: param.nodeId, inputKey: param.inputKey, value });
    // A seed the user typed is a deliberate choice — never overwrite it.
    if (param.isSeed) pinnedSeeds.push({ nodeId: param.nodeId, inputKey: param.inputKey });
  }

  // Only the bound outputs are kept, so the engine does not execute (and bill
  // for) branches whose results the node would discard.
  //
  // Bound input and parameter nodes are kept as roots too. Pruning purely from
  // the outputs would drop a loader whose branch happens not to reach a bound
  // sink — and then patching its upload would fail on a node that is no longer
  // there. An unreferenced node is validated but never executed, so keeping it
  // costs nothing.
  const outputNodeIds = app.outputs.map((o) => o.nodeId);
  const keepRoots = [
    ...outputNodeIds,
    ...app.inputs.map((i) => i.nodeId),
    ...app.params.map((p) => p.nodeId),
  ];
  const pruned = outputNodeIds.length > 0 ? pruneToOutputs(app.graph, keepRoots) : app.graph;

  return patchGraph(pruned, {
    media,
    assignments,
    outputNodeIds,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    pinnedSeeds,
  });
}

/** Upload every connected media input, returning values ready for the graph. */
export async function uploadInputs(
  engine: ComfyEngine,
  inputs: ResolvedInputMedia[],
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const uploads: Record<string, unknown> = {};
  for (const input of inputs) {
    uploads[input.name] = await engine.upload(
      { bytes: input.bytes, filename: input.filename, contentType: input.contentType },
      signal
    );
  }
  return uploads;
}

/**
 * Match what the engine produced back onto the app's output handles.
 *
 * Node ids are the join key, which holds because the run graph keeps the app's
 * own ids. When a bound output produced nothing (a muted branch, an engine that
 * routed the file through a different node) the remaining assets are assigned
 * to the remaining handles of the same type, in order — better a result on a
 * slightly different handle than a silent empty run.
 */
export function resolveOutputs(
  app: ComfyAppDefinition,
  assets: ComfyOutputAsset[]
): ComfyResolvedOutput[] {
  const resolved: ComfyResolvedOutput[] = [];
  const unclaimed = [...assets];

  for (const output of app.outputs) {
    const index = unclaimed.findIndex((a) => a.nodeId === output.nodeId);
    if (index === -1) continue;
    const [asset] = unclaimed.splice(index, 1);
    if (!asset) continue;
    const value = assetValue(asset);
    if (value !== null) resolved.push({ handleId: output.id, type: output.type, value });
  }

  for (const output of app.outputs) {
    if (resolved.some((r) => r.handleId === output.id)) continue;
    const index = unclaimed.findIndex((a) => a.type === output.type);
    if (index === -1) continue;
    const [asset] = unclaimed.splice(index, 1);
    if (!asset) continue;
    const value = assetValue(asset);
    if (value !== null) resolved.push({ handleId: output.id, type: output.type, value });
  }

  return resolved;
}

/** A data URL for media, or the text itself. */
function assetValue(asset: ComfyOutputAsset): string | null {
  if (asset.type === "text") return asset.text ?? null;
  if (!asset.bytes) return null;
  const base64 = Buffer.from(asset.bytes).toString("base64");
  return `data:${asset.contentType ?? "application/octet-stream"};base64,${base64}`;
}

/**
 * Collect a finished job and map it onto the app's handles.
 *
 * A job that reports success but surfaces nothing is treated as a failure: it
 * almost always means the workflow's bound output was pruned, muted, or never
 * reached, and silently returning an empty node hides that.
 */
export async function collectRun(
  engine: ComfyEngine,
  app: ComfyAppDefinition,
  state: Parameters<ComfyEngine["collect"]>[0],
  signal?: AbortSignal
): Promise<ComfyResolvedOutput[]> {
  const assets = await engine.collect(state, signal);
  const outputs = resolveOutputs(app, assets);
  if (outputs.length === 0) {
    throw new ComfyEngineError(
      `${engine.label} finished the run but produced no output. Check that the workflow's output node is connected and not muted.`
    );
  }
  return outputs;
}
