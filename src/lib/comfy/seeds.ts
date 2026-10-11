import type { ComfyAppParam, ComfySeedMode } from "./types";

/**
 * What a seed the node shows does after each run — ComfyUI's "control after
 * generate". The node always shows the seed its next run uses; the mode says
 * what that becomes once a run has taken it.
 */

/** ComfyUI's own default for a seed widget: a new one after every run. */
export const DEFAULT_SEED_MODE: ComfySeedMode = "random";

/**
 * A fresh seed, inside signed 32 bits: the range the server's own derived
 * seeds use (`hashSeed`), so it survives JSON exactly and every engine
 * accepts it.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function asSeed(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** The value a seed takes once a run has used it. Stepping past either end wraps, as ComfyUI does. */
export function nextSeed(value: number, mode: ComfySeedMode, param: Pick<ComfyAppParam, "minimum" | "maximum">): number {
  const min = param.minimum ?? 0;
  // Graphs declare 0xffffffffffffffff, which a JS number cannot step through.
  const max = Math.min(param.maximum ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  switch (mode) {
    case "fixed":
      return value;
    case "increment":
      return value + 1 > max ? min : value + 1;
    case "decrement":
      return value - 1 < min ? max : value - 1;
    default:
      return randomSeed();
  }
}

/** The seed a node starts from: a fresh one for a random seed, the workflow's own for the rest. */
function startingSeed(param: ComfyAppParam, mode: ComfySeedMode): number {
  return (mode === DEFAULT_SEED_MODE ? null : asSeed(param.default)) ?? randomSeed();
}

/**
 * Values for a node's seeds when a workflow is attached, chosen now so the
 * node shows the seed its first run uses.
 */
export function initialSeedValues(
  params: ReadonlyArray<ComfyAppParam>,
  modes: Readonly<Record<string, ComfySeedMode>> = {}
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const param of params) {
    if (param.isSeed) values[param.id] = startingSeed(param, modes[param.id] ?? DEFAULT_SEED_MODE);
  }
  return values;
}

/**
 * The parameter values a run sends, and the seeds the node shows after it.
 *
 * Every seed the node exposes runs with the value it shows. One with no value
 * yet — a node from before seeds had modes — starts where a new node would.
 */
export function seedsForRun(
  params: ReadonlyArray<ComfyAppParam>,
  values: Readonly<Record<string, unknown>>,
  modes: Readonly<Record<string, ComfySeedMode>> = {}
): { run: Record<string, unknown>; after: Record<string, number> } {
  const run: Record<string, unknown> = { ...values };
  const after: Record<string, number> = {};
  for (const param of params) {
    if (!param.isSeed) continue;
    const mode = modes[param.id] ?? DEFAULT_SEED_MODE;
    const seed = asSeed(values[param.id]) ?? startingSeed(param, mode);
    run[param.id] = seed;
    after[param.id] = nextSeed(seed, mode, param);
  }
  return { run, after };
}
