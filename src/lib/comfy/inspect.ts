/**
 * Turning a raw ComfyUI workflow into a node contract.
 *
 * Inspection answers three questions the import dialog puts to the user:
 * which upstream data does this workflow accept (→ typed input handles), which
 * widgets should be adjustable on the node (→ inline parameters), and what does
 * it produce (→ typed output handles).
 *
 * When the workflow carries **App Mode** configuration, the author has already
 * answered all three — that curated set becomes the suggested contract, and the
 * dialog is a confirmation rather than a construction step.
 */

import {
  comboOptions,
  declaredWidgetType,
  graphClassTypes,
  humanizeKey,
  isCurveValue,
  isExposableWidget,
  isPromptWidget,
  isSeedKey,
  leafKey,
  loaderInputType,
  loaderWidgetKey,
  nodeLabel,
  outputTypeFor,
  widgetConstraints,
} from "./graph";
import type { AppModeData } from "./editor";
import type {
  ComfyAppInput,
  ComfyAppOutput,
  ComfyAppParam,
  ComfyBlueprintSummary,
  ComfyGraph,
  ComfyGraphNode,
  ComfyInputType,
  ComfyNodeCandidate,
  ComfyObjectInfo,
  ComfyWidgetCandidate,
  ComfyWorkflowInspection,
} from "./types";

/** Stable id for a widget binding. */
const bindingId = (nodeId: string, inputKey: string): string => `${nodeId}:${inputKey}`;

/**
 * Slugify a label into a `dynamicInputs` key, de-duplicating against names
 * already taken. The key is what `getConnectedInputs` maps a handle to, so it
 * must be unique within one app.
 */
export function uniqueSlug(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "input";
  let name = base;
  let n = 2;
  while (taken.has(name)) {
    name = `${base}_${n}`;
    n += 1;
  }
  taken.add(name);
  return name;
}

/**
 * The value type of a widget: what the engine declares, falling back to what
 * the current value implies when no catalog is available.
 */
function valueTypeOf(
  value: unknown,
  options: string[] | null,
  declared: ComfyWidgetCandidate["valueType"] | null
): ComfyWidgetCandidate["valueType"] {
  // Shape wins over the catalog here: a curve cannot be rendered as anything
  // else, and its value is self-describing even when no engine is reachable.
  if (isCurveValue(value)) return "curve";
  if (options) return "select";
  if (declared && declared !== "select") return declared;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return "text";
}

/** Build the candidate record for one exposable widget. */
function widgetCandidate(
  nodeId: string,
  node: ComfyGraphNode,
  inputKey: string,
  value: ComfyWidgetCandidate["currentValue"],
  objectInfo: ComfyObjectInfo | undefined,
  fromAppMode: boolean
): ComfyWidgetCandidate {
  const options = comboOptions(node, inputKey, objectInfo);
  const constraints = widgetConstraints(objectInfo, node, inputKey);
  const title = node._meta?.title?.trim();
  return {
    nodeId,
    inputKey,
    classType: node.class_type,
    label: title ? `${title} · ${humanizeKey(inputKey)}` : `${node.class_type} · ${humanizeKey(inputKey)}`,
    valueType: valueTypeOf(value, options, declaredWidgetType(objectInfo, node, inputKey)),
    currentValue: value,
    ...(options ? { options } : {}),
    ...constraints,
    isSeed: isSeedKey(inputKey),
    // Only free-form strings make sense as a text connection; a dropdown or a
    // number would have nothing sensible to receive from an upstream node.
    connectableAs: !options && typeof value === "string" && isPromptWidget(node, inputKey) ? "text" : null,
    fromAppMode,
  };
}

/** A `ComfyAppParam` built from a candidate. */
export function paramFromCandidate(candidate: ComfyWidgetCandidate): ComfyAppParam {
  const type: ComfyAppParam["type"] =
    candidate.valueType === "select"
      ? "string"
      : candidate.valueType === "boolean"
        ? "boolean"
        : candidate.valueType === "integer"
          ? "integer"
          : candidate.valueType === "number"
            ? "number"
            : candidate.valueType === "curve"
              ? "curve"
              : "string";
  return {
    id: bindingId(candidate.nodeId, candidate.inputKey),
    label: candidate.label,
    nodeId: candidate.nodeId,
    inputKey: candidate.inputKey,
    type,
    ...(candidate.options ? { enum: candidate.options } : {}),
    default: candidate.currentValue,
    ...(candidate.minimum !== undefined ? { minimum: candidate.minimum } : {}),
    ...(candidate.maximum !== undefined ? { maximum: candidate.maximum } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    ...(candidate.isSeed ? { isSeed: true } : {}),
    ...(candidate.multiline ? { multiline: true } : {}),
  };
}

/** A `ComfyAppInput` built from a candidate promoted to a connection. */
export function inputFromCandidate(
  candidate: ComfyWidgetCandidate,
  type: ComfyInputType,
  taken: Set<string>
): ComfyAppInput {
  return {
    id: bindingId(candidate.nodeId, candidate.inputKey),
    name: uniqueSlug(candidate.label, taken),
    label: candidate.label,
    type,
    nodeId: candidate.nodeId,
    inputKey: candidate.inputKey,
    required: false,
    ...(candidate.description ? { description: candidate.description } : {}),
  };
}

/** A `ComfyAppInput` for a media loader node. */
export function inputFromLoader(
  candidate: ComfyNodeCandidate,
  type: ComfyInputType,
  taken: Set<string>,
  node?: ComfyGraphNode
): ComfyAppInput {
  // Resolved once: node packs name the filename widget differently, so it is
  // read off the node itself rather than assumed from the class.
  const inputKey = loaderWidgetKey(candidate.classType, node);
  return {
    id: bindingId(candidate.nodeId, inputKey),
    name: uniqueSlug(candidate.label, taken),
    label: candidate.label,
    type,
    nodeId: candidate.nodeId,
    inputKey,
    required: true,
  };
}

/** A `ComfyAppOutput` for a sink node. */
export function outputFromCandidate(candidate: ComfyNodeCandidate): ComfyAppOutput {
  return {
    id: candidate.nodeId,
    label: candidate.label,
    type: outputTypeFor(candidate.classType) ?? "image",
    nodeId: candidate.nodeId,
    classType: candidate.classType,
  };
}

export interface InspectOptions {
  /** Engine node catalog — enriches combo options, bounds and tooltips. */
  objectInfo?: ComfyObjectInfo;
  /** App Mode configuration read from an editor save, when present. */
  appMode?: AppModeData | null;
  /** Blueprints found alongside the workflow. */
  blueprints?: ComfyBlueprintSummary[];
  /** Fallback name (usually the uploaded filename, minus its extension). */
  defaultName?: string;
  /** Notes gathered earlier in the pipeline (e.g. during conversion). */
  warnings?: string[];
}

/**
 * Inspect an API-format graph and propose a node contract.
 *
 * Without App Mode the proposal is conservative but complete: every media
 * loader becomes an input, every sink becomes an output, prompt-shaped strings
 * become text inputs, and the remaining widgets are offered as parameters but
 * left unselected — the dialog is where the user narrows it down.
 */
export function inspectWorkflow(
  graph: ComfyGraph,
  options: InspectOptions = {}
): ComfyWorkflowInspection {
  const { objectInfo, appMode = null, blueprints = [], defaultName = "" } = options;
  const warnings = [...(options.warnings ?? [])];

  const imageInputCandidates: ComfyNodeCandidate[] = [];
  const mediaInputCandidates: ComfyNodeCandidate[] = [];
  const outputCandidates: ComfyNodeCandidate[] = [];
  const widgetCandidates: ComfyWidgetCandidate[] = [];

  // Author renames, keyed by binding — applied to the candidate list too, so
  // the import dialog shows the same names the node will.
  const appModeLabels = new Map(
    (appMode?.inputs ?? []).map((entry) => [
      bindingId(entry.nodeId, entry.widget),
      entry.label ?? null,
    ])
  );

  for (const [nodeId, node] of Object.entries(graph)) {
    const label = nodeLabel(nodeId, node);
    const loaderType = loaderInputType(node.class_type);
    if (loaderType === "image") {
      imageInputCandidates.push({ nodeId, classType: node.class_type, label });
    } else if (loaderType) {
      mediaInputCandidates.push({ nodeId, classType: node.class_type, label });
    }
    if (outputTypeFor(node.class_type)) {
      outputCandidates.push({ nodeId, classType: node.class_type, label });
    }
    for (const [inputKey, value] of Object.entries(node.inputs)) {
      if (!isExposableWidget(node, inputKey, value)) continue;
      const key = bindingId(nodeId, inputKey);
      const candidate = widgetCandidate(
        nodeId,
        node,
        inputKey,
        value as ComfyWidgetCandidate["currentValue"],
        objectInfo,
        appModeLabels.has(key)
      );
      const authorLabel = appModeLabels.get(key);
      widgetCandidates.push(authorLabel ? { ...candidate, label: authorLabel } : candidate);
    }
  }

  const taken = new Set<string>();
  const inputs: ComfyAppInput[] = [];
  const params: ComfyAppParam[] = [];
  let outputs: ComfyAppOutput[] = [];

  if (appMode) {
    // The author curated this surface — follow it exactly, in their order.
    for (const entry of appMode.inputs) {
      const node = graph[entry.nodeId];
      if (!node) continue;
      const loaderType = loaderInputType(node.class_type);
      // A loader's upload widget declares a media input, not a text param.
      if (loaderType && leafKey(entry.widget) === loaderWidgetKey(node.class_type, node)) {
        inputs.push(
          inputFromLoader(
            { nodeId: entry.nodeId, classType: node.class_type, label: nodeLabel(entry.nodeId, node) },
            loaderType,
            taken,
            node
          )
        );
        continue;
      }
      const found = widgetCandidates.find(
        (c) => c.nodeId === entry.nodeId && c.inputKey === entry.widget
      );
      if (!found) continue;
      const candidate = found;
      // Prompt-shaped strings become connectable handles so they can be driven
      // by a Prompt or LLM node; everything else stays an inline control.
      if (candidate.connectableAs) {
        inputs.push(inputFromCandidate(candidate, candidate.connectableAs, taken));
      } else {
        params.push(paramFromCandidate(candidate));
      }
    }
    // A media loader the curated list does not mention is still a real entry
    // point — App Mode curates *widgets*, and a blueprint's boundary inputs are
    // not widgets at all. Leaving them out would produce a node with no way to
    // feed it an image. They are optional, so an unconnected one just runs with
    // whatever the workflow was saved with.
    const claimed = new Set(inputs.map((i) => i.nodeId));
    for (const candidate of [...imageInputCandidates, ...mediaInputCandidates]) {
      if (claimed.has(candidate.nodeId)) continue;
      const type = loaderInputType(candidate.classType);
      if (!type) continue;
      inputs.push({
        ...inputFromLoader(candidate, type, taken, graph[candidate.nodeId]),
        required: false,
      });
    }

    outputs = appMode.outputNodeIds
      .map((nodeId) => {
        const node = graph[nodeId];
        if (!node) return null;
        return outputFromCandidate({
          nodeId,
          classType: node.class_type,
          label: nodeLabel(nodeId, node),
        });
      })
      .filter((o): o is ComfyAppOutput => o !== null);
  } else {
    for (const candidate of imageInputCandidates) {
      inputs.push(inputFromLoader(candidate, "image", taken, graph[candidate.nodeId]));
    }
    for (const candidate of mediaInputCandidates) {
      const type = loaderInputType(candidate.classType);
      if (type) inputs.push(inputFromLoader(candidate, type, taken, graph[candidate.nodeId]));
    }
    for (const candidate of widgetCandidates) {
      if (candidate.connectableAs) {
        inputs.push(inputFromCandidate(candidate, candidate.connectableAs, taken));
      }
    }
  }

  // Fall back to every sink when the author exposed none — a workflow with no
  // bound output would run and produce nothing the node could show.
  if (outputs.length === 0) {
    const saved = outputCandidates.filter((c) => !c.classType.startsWith("Preview"));
    outputs = (saved.length > 0 ? saved : outputCandidates).map(outputFromCandidate);
  }
  if (outputs.length === 0) {
    warnings.push(
      "This workflow has no Save or Preview node, so it produces nothing Node Banana can display."
    );
  }
  if (inputs.length === 0) {
    warnings.push(
      "No inputs were detected — this app will run with the values baked into the workflow."
    );
  }

  return {
    nodeCount: Object.keys(graph).length,
    classTypes: graphClassTypes(graph),
    imageInputCandidates,
    mediaInputCandidates,
    outputCandidates,
    widgetCandidates,
    hasAppMode: appMode !== null,
    appModeOutputNodeIds: appMode?.outputNodeIds ?? [],
    suggested: {
      name: defaultName || "ComfyUI App",
      inputs,
      params,
      outputs,
    },
    blueprints,
    warnings,
  };
}

/**
 * Re-derive unique `dynamicInputs` names for a user-edited input list.
 *
 * The import dialog lets labels be renamed and inputs be added or removed, so
 * names are recomputed on save rather than trusted from the client.
 */
export function normalizeInputs(inputs: ComfyAppInput[]): ComfyAppInput[] {
  const taken = new Set<string>();
  return inputs.map((input) => ({
    ...input,
    name: uniqueSlug(input.label || input.name, taken),
  }));
}
