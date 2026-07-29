/**
 * Bridging a Comfy app contract to Node Banana's dynamic-handle machinery.
 *
 * Generation nodes already declare variable handles through `inputSchema`
 * (`ModelInputDef[]`), and `getConnectedInputs` uses that list to map an
 * indexed handle id (`image-0`, `text-1`) onto a named slot in `dynamicInputs`.
 * A Comfy app's inputs are the same idea with a different source, so they reuse
 * the same representation rather than inventing a parallel one.
 */

import type { ModelInputDef } from "@/types/nodes";
import type { ComfyAppDefinition } from "./types";

/**
 * The `inputSchema` a Comfy app node should carry.
 *
 * Order matters: `getConnectedInputs` assigns `image-0`, `image-1`, … by the
 * order of same-typed entries in this list, so it must match the order the node
 * renders its handles in.
 */
export function appToInputSchema(app: ComfyAppDefinition): ModelInputDef[] {
  return app.inputs.map((input) => ({
    name: input.name,
    type: input.type,
    required: input.required,
    label: input.label,
    ...(input.description ? { description: input.description } : {}),
  }));
}
