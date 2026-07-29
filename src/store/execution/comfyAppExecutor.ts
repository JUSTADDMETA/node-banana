/**
 * Comfy App Executor
 *
 * Runs a ComfyUI workflow bound to a node: gather the connected inputs, submit
 * them to the configured engine, poll until the render finishes, and write the
 * results back onto the node's typed output handles.
 *
 * Submission and polling are separate short-lived requests. A diffusion run
 * regularly takes minutes, and holding one connection open for that long is
 * what makes long generations fail on idle timeouts.
 */

import type { ComfyAppNodeData } from "@/types";
import type { ComfyResolvedOutput } from "@/lib/comfy/types";
import { buildComfyHeaders, comfyConfigError, getComfySettings } from "@/lib/comfy/settings";
import type { NodeExecutionContext } from "./types";

/** Polling cadence — starts responsive, then backs off for long renders. */
const INITIAL_INTERVAL = 1500;
const MAX_INTERVAL = 6000;
const INTERVAL_STEP = 500;
const MAX_CONSECUTIVE_ERRORS = 8;

interface ComfyRunAccepted {
  success: true;
  polling: true;
  jobId: string;
  status: string;
}

interface ComfyPollUpdate {
  success: true;
  polling: boolean;
  status: string;
  progress?: number;
  outputs?: ComfyResolvedOutput[];
}

interface ComfyFailure {
  success: false;
  error: string;
  notConfigured?: boolean;
  missingNodes?: string[];
}

/** Read an error message out of a response, however the route framed it. */
async function readError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as ComfyFailure;
    if (body?.error) return body.error;
  } catch {
    /* fall through */
  }
  return text ? `${fallback}: ${text.slice(0, 200)}` : fallback;
}

/** Sleep that rejects promptly when the run is cancelled. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function executeComfyApp(ctx: NodeExecutionContext): Promise<void> {
  const {
    node,
    getConnectedInputs,
    updateNodeData,
    getFreshNode,
    signal,
    addToGlobalHistory,
    generationsPath,
    trackSaveGeneration,
  } = ctx;

  const freshNode = getFreshNode(node.id);
  const nodeData = (freshNode?.data ?? node.data) as ComfyAppNodeData;
  const app = nodeData.app;

  if (!app) {
    const message = "No ComfyUI workflow attached to this node";
    updateNodeData(node.id, { status: "error", error: message });
    throw new Error(message);
  }

  const settings = getComfySettings();
  const configError = comfyConfigError(settings);
  if (configError) {
    updateNodeData(node.id, { status: "error", error: configError });
    throw new Error(configError);
  }

  // `dynamicInputs` is keyed by the schema names derived from `app.inputs`, so
  // it maps a connected handle straight onto the graph binding it feeds. The
  // typed arrays are the fallback for edges made before the schema existed.
  const connected = getConnectedInputs(node.id);
  const inputs: Record<string, string> = {};
  for (const input of app.inputs) {
    const dynamic = connected.dynamicInputs[input.name];
    const value = Array.isArray(dynamic) ? dynamic[0] : dynamic;
    if (typeof value === "string" && value !== "") {
      inputs[input.name] = value;
      continue;
    }
    // Fall back to the first unclaimed value of the right type.
    if (input.type === "text" && connected.text) inputs[input.name] = connected.text;
    else if (input.type === "image" && connected.images[0]) inputs[input.name] = connected.images[0];
    else if (input.type === "video" && connected.videos[0]) inputs[input.name] = connected.videos[0];
    else if (input.type === "audio" && connected.audio[0]) inputs[input.name] = connected.audio[0];
  }

  const missing = app.inputs
    .filter((input) => input.required && !inputs[input.name])
    .map((input) => input.label);
  if (missing.length > 0) {
    const message = `Missing required input: ${missing.join(", ")}`;
    updateNodeData(node.id, { status: "error", error: message });
    throw new Error(message);
  }

  updateNodeData(node.id, {
    status: "loading",
    error: null,
    runStatus: "queued",
    jobId: null,
  });

  const headers = buildComfyHeaders(settings);
  let jobId: string | null = null;

  try {
    const submitRes = await fetch("/api/comfy/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        app,
        inputs,
        params: nodeData.paramValues ?? {},
        randomizeSeeds: settings.randomizeSeeds,
        seedKey: `${node.id}-${Date.now()}`,
      }),
      ...(signal ? { signal } : {}),
    });

    if (!submitRes.ok) {
      throw new Error(await readError(submitRes, "ComfyUI rejected the workflow"));
    }
    const accepted = (await submitRes.json()) as ComfyRunAccepted;
    jobId = accepted.jobId;
    updateNodeData(node.id, { jobId, runStatus: accepted.status });

    let interval = INITIAL_INTERVAL;
    let consecutiveErrors = 0;
    const deadline = Date.now() + settings.jobTimeoutMs;

    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${Math.round(settings.jobTimeoutMs / 60_000)} min waiting for ComfyUI. Raise the job timeout in Settings → ComfyUI for long renders.`
        );
      }
      await delay(interval, signal);
      interval = Math.min(MAX_INTERVAL, interval + INTERVAL_STEP);

      let update: ComfyPollUpdate;
      try {
        const pollRes = await fetch("/api/comfy/poll", {
          method: "POST",
          headers,
          body: JSON.stringify({ jobId, app }),
          ...(signal ? { signal } : {}),
        });
        if (!pollRes.ok) {
          // A 5xx from the engine is terminal; a transient network hiccup is
          // not. Anything the route framed as an error is terminal.
          throw new Error(await readError(pollRes, "ComfyUI run failed"));
        }
        update = (await pollRes.json()) as ComfyPollUpdate;
        consecutiveErrors = 0;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        // The route already turned engine failures into non-OK responses with
        // a message, so reaching here means the *request* failed — retry a few
        // times before giving up on an otherwise healthy render.
        if (error instanceof TypeError && (consecutiveErrors += 1) < MAX_CONSECUTIVE_ERRORS) {
          continue;
        }
        throw error;
      }

      if (update.polling) {
        updateNodeData(node.id, { runStatus: update.status });
        continue;
      }

      const outputs = update.outputs ?? [];
      const resolved = outputsToNodeData(app.outputs, outputs);
      updateNodeData(node.id, {
        ...resolved,
        status: "complete",
        error: null,
        runStatus: null,
        jobId: null,
      });

      // A Comfy app's image is a generation like any other: it belongs in the
      // global history and in the project's generations folder, so it can be
      // browsed and reloaded alongside everything else.
      if (resolved.outputImage) {
        const timestamp = Date.now();
        const imageId = `${timestamp}`;
        addToGlobalHistory({
          image: resolved.outputImage,
          timestamp,
          prompt: describeRun(app.name, inputs, nodeData.paramValues ?? {}),
          aspectRatio: "1:1",
          model: app.name,
        });
        if (generationsPath) {
          trackSaveGeneration(
            imageId,
            fetch("/api/save-generation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                directoryPath: generationsPath,
                image: resolved.outputImage,
                prompt: describeRun(app.name, inputs, nodeData.paramValues ?? {}),
                imageId,
              }),
            })
              .then(() => undefined)
              .catch((err) => {
                console.error("Failed to save ComfyUI generation:", err);
              })
          );
        }
      }
      return;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      // Stop the engine too — an abandoned job keeps a GPU (and, on Cloud, a
      // bill) running.
      if (jobId) {
        void fetch("/api/comfy/poll", {
          method: "POST",
          headers,
          body: JSON.stringify({ jobId, app, cancel: true }),
        }).catch(() => null);
      }
      updateNodeData(node.id, { status: "idle", runStatus: null, jobId: null });
      throw error;
    }
    const message = error instanceof Error ? error.message : "ComfyUI run failed";
    updateNodeData(node.id, {
      status: "error",
      error: message,
      runStatus: null,
      jobId: null,
    });
    throw new Error(message);
  }
}

/**
 * A one-line description of what produced an image, for the history entry.
 *
 * A Comfy app has no single "prompt" — it may have several text inputs, or
 * none at all — so the app name plus whatever text went in is the closest
 * honest summary.
 */
function describeRun(
  appName: string,
  inputs: Record<string, string>,
  params: Record<string, unknown>
): string {
  const text = Object.values(inputs)
    .filter((value) => !value.startsWith("data:"))
    .join(" · ")
    .slice(0, 400);
  if (text) return `${appName}: ${text}`;
  const settings = Object.entries(params)
    .map(([key, value]) => `${key.split(":").pop()}=${String(value)}`)
    .join(", ")
    .slice(0, 200);
  return settings ? `${appName} (${settings})` : appName;
}

/**
 * Spread resolved outputs across the node's data.
 *
 * `outputs` is the authoritative handle-keyed map; the typed mirrors
 * (`outputImage`, `outputText`, …) exist so the rest of the app — auto-save,
 * the gallery, cost tracking — can find a Comfy app's result without knowing
 * its handle layout.
 */
export function outputsToNodeData(
  declared: Array<{ id: string; type: string }>,
  resolved: ComfyResolvedOutput[]
): Partial<ComfyAppNodeData> {
  const outputs: Record<string, string> = {};
  for (const output of resolved) outputs[output.handleId] = output.value;

  const firstOfType = (type: string): string | null => {
    for (const declaration of declared) {
      if (declaration.type !== type) continue;
      const value = outputs[declaration.id];
      if (value) return value;
    }
    return null;
  };

  return {
    outputs,
    outputImage: firstOfType("image"),
    outputVideo: firstOfType("video"),
    outputAudio: firstOfType("audio"),
    outputText: firstOfType("text"),
    output3dUrl: firstOfType("3d"),
  };
}
