/**
 * The Comfy API v2 surface, driven by `@comfyorg/sdk`.
 *
 * This is the path Comfy Cloud is designed around, and it buys real things the
 * legacy surface cannot offer: uploads are content-addressed and deduplicated
 * (re-running with the same image uploads nothing), submits carry an
 * idempotency key so a retried request cannot double-charge, and failures
 * arrive as typed errors rather than strings.
 *
 * A stock local ComfyUI has no `/api/v2/*` routes — it needs the
 * `comfy-api-proxy` sidecar — which is why {@link ComfyConnection.useSdk}
 * gates this engine and the legacy one remains the default for local mode.
 */

import {
  Comfy,
  ComfyError,
  InsufficientCredits,
  JobFailed,
  Unauthorized,
  WorkflowFormatUi,
} from "@comfyorg/sdk";

import { mediaTypeForFilename, mimeForFilename } from "../graph";
import type { ComfyConnection, ComfyGraph, ComfyObjectInfo, ComfyOutputType } from "../types";
import { engineAuthHeaders } from "./connection";
import {
  ComfyEngineError,
  engineNeverAnswered,
  type ComfyEngine,
  type ComfyJobState,
  type ComfyOutputAsset,
  type ComfySubmitOptions,
  type ComfyUploadInput,
  type ComfyUploadRef,
} from "./engine";
import { createEngineFetch, resilientFetch } from "./fetch";

/**
 * How long one SDK request may take.
 *
 * The SDK's own default is 30 s, which is generous for a poll and far too short
 * for the request that matters most: collecting a finished job downloads every
 * output it produced, and a minute of video is tens of megabytes.
 */
const SDK_TIMEOUT_MS = 300_000;

/**
 * Terminal states. `canceling` is deliberately excluded — cancellation takes
 * effect at node boundaries and can take seconds, during which the job is
 * still running.
 */
const TERMINAL = new Set(["succeeded", "canceled", "failed", "expired"]);
const SUCCESS = "succeeded";

/**
 * Map the v2 output type onto a Node Banana handle type.
 *
 * The content type is advisory: Comfy Cloud returns it empty for outputs a
 * workflow saved itself, so the filename is the fallback signal — without it a
 * `.glb` or `.mp4` would be classified as an image.
 */
function handleTypeFor(type: string, contentType: string, filename: string): ComfyOutputType {
  if (type === "video" || contentType.startsWith("video/")) return "video";
  if (type === "audio" || contentType.startsWith("audio/")) return "audio";
  if (type === "text") return "text";
  if (contentType.startsWith("model/")) return "3d";
  if (type === "image" || contentType.startsWith("image/")) return "image";
  return mediaTypeForFilename(filename);
}

export class SdkComfyEngine implements ComfyEngine {
  readonly label: string;
  private client: Comfy | null = null;

  constructor(readonly connection: ComfyConnection) {
    this.label = connection.mode === "cloud" ? "Comfy Cloud" : "ComfyUI (API v2)";
  }

  private get sdk(): Comfy {
    if (!this.client) {
      this.client = new Comfy(this.connection.baseUrl, {
        ...(this.connection.apiKey ? { apiKey: this.connection.apiKey } : {}),
        clientInfo: "node-banana",
        timeoutMs: SDK_TIMEOUT_MS,
        // The SDK retries nothing below its API layer, so one connection that
        // never opened would end an upload, a submit or a poll — and with it a
        // render that was fine.
        fetch: createEngineFetch(),
      });
    }
    return this.client;
  }

  async ping(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }> {
    // There is no dedicated health endpoint on v2, and listing jobs needs a
    // valid key — which is exactly what this probe is meant to establish. The
    // legacy `/api/queue` is served by the same host and answers both
    // questions at once, so use it.
    try {
      const res = await resilientFetch(`${this.connection.baseUrl}/api/queue`, {
        headers: engineAuthHeaders(this.connection),
        timeoutMs: 8_000,
        signal,
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `${this.label} rejected the API key` };
      }
      if (res.status === 429) return { ok: false, detail: "Comfy Cloud subscription is inactive" };
      if (!res.ok && res.status !== 404) {
        return { ok: false, detail: `${this.label} responded ${res.status}` };
      }
      return { ok: true, detail: this.connection.baseUrl };
    } catch {
      return { ok: false, detail: `Could not reach ${this.connection.baseUrl}` };
    }
  }

  /**
   * The node catalog is not part of the v2 contract, so this reads the legacy
   * `/api/object_info` the same host serves. Comfy Cloud requires auth here
   * even though the v2 routes use a different header, so both are sent.
   */
  async objectInfo(signal?: AbortSignal): Promise<ComfyObjectInfo> {
    const headers: Record<string, string> = this.connection.apiKey
      ? {
          Authorization: `Bearer ${this.connection.apiKey}`,
          "X-API-Key": this.connection.apiKey,
        }
      : {};
    const res = await resilientFetch(`${this.connection.baseUrl}/api/object_info`, {
      headers,
      timeoutMs: 30_000,
      retries: 4,
      signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new ComfyEngineError(`${this.label} rejected the API key`, 401);
    }
    if (!res.ok) {
      throw new ComfyEngineError(`Could not read the node catalog from ${this.label}`);
    }
    return (await res.json()) as ComfyObjectInfo;
  }

  /**
   * Hash, dedup-probe and (only if the server lacks the bytes) upload, then
   * return the `core/ASSET` reference to patch into the graph.
   */
  async upload(input: ComfyUploadInput, signal?: AbortSignal): Promise<ComfyUploadRef> {
    try {
      const asset = this.sdk.assets.fromBytes(input.bytes, {
        filename: input.filename,
        contentType: input.contentType,
      });
      return (await asset.asReference(signal)) as unknown as Record<string, unknown>;
    } catch (error) {
      throw toEngineError(error, `${this.label} rejected the upload of ${input.filename}`, this.label);
    }
  }

  async submit(graph: ComfyGraph, options: ComfySubmitOptions = {}): Promise<string> {
    try {
      const workflow = this.sdk.workflows.fromJson(graph as Record<string, unknown>);
      const job = await this.sdk.submit(workflow, {
        ...(options.orgApiKey ? { apiKey: options.orgApiKey } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      return job.id;
    } catch (error) {
      throw toEngineError(error, `${this.label} rejected the workflow`, this.label);
    }
  }

  async poll(jobId: string): Promise<ComfyJobState> {
    try {
      const job = await this.sdk.jobs.get(jobId);
      const terminal = TERMINAL.has(job.status);
      if (!terminal) return { status: job.status, terminal: false, error: null, raw: null };
      if (job.status !== SUCCESS) {
        const detail = job.error?.message ?? null;
        const node = job.error?.node_id ? ` (node ${job.error.node_id})` : "";
        return {
          status: job.status,
          terminal: true,
          error: `${this.label} job ${job.status}${detail ? `: ${detail}${node}` : ""}`,
          raw: null,
        };
      }
      return { status: job.status, terminal: true, error: null, raw: { jobId } };
    } catch (error) {
      throw toEngineError(error, `Could not read the job from ${this.label}`, this.label);
    }
  }

  async collect(state: ComfyJobState): Promise<ComfyOutputAsset[]> {
    try {
      return await this.download(state);
    } catch (error) {
      // Downloading is where the biggest payloads move, so it is the likeliest
      // place to be cut off. Left unmapped it surfaced as a bare 500, which the
      // client reads as a verdict and stops polling for — losing a render that
      // had already finished and been paid for.
      throw toEngineError(error, `Could not download the results from ${this.label}`, this.label);
    }
  }

  /**
   * The download itself. Split out so {@link collect} is nothing but the error
   * mapping, and so the SDK's lack of a cancellation hook here — neither
   * `jobs.get` nor `toBytes` accepts a signal — is stated in one place rather
   * than implied by a missing argument.
   */
  private async download(state: ComfyJobState): Promise<ComfyOutputAsset[]> {
    const jobId = (state.raw as { jobId?: string } | null)?.jobId;
    if (!jobId) return [];
    const job = await this.sdk.jobs.get(jobId);
    const assets: ComfyOutputAsset[] = [];
    for (const output of job.outputs) {
      const bytes = await output.toBytes();
      const type = handleTypeFor(output.type, output.contentType, output.name);
      if (type === "text") {
        assets.push({ nodeId: output.nodeId, type, text: new TextDecoder().decode(bytes) });
        continue;
      }
      assets.push({
        nodeId: output.nodeId,
        type,
        bytes,
        // An empty content type would become `data:;base64,…`, which is a
        // *text* data URL — it fails to render, and re-uploading it into
        // another Comfy node would send an extensionless file the engine
        // refuses to load.
        contentType: output.contentType || mimeForFilename(output.name),
        filename: output.name,
      });
    }
    return assets;
  }

  async cancel(jobId: string): Promise<void> {
    try {
      const job = await this.sdk.jobs.get(jobId);
      await job.cancel();
    } catch {
      // A cancel must never fail the cancel.
    }
  }
}

/** Turn an SDK exception into a message worth showing the user. */
function toEngineError(error: unknown, fallback: string, label = "the engine"): ComfyEngineError {
  if (error instanceof InsufficientCredits) {
    return new ComfyEngineError("Comfy Cloud: insufficient credits", 402);
  }
  if (error instanceof Unauthorized) {
    return new ComfyEngineError("Comfy Cloud rejected the API key", 401);
  }
  if (error instanceof WorkflowFormatUi) {
    return new ComfyEngineError(
      "This workflow is still in editor format — it must be converted before it can run.",
      422
    );
  }
  if (error instanceof JobFailed) {
    const detail = error.error?.message ?? error.message;
    const node = error.error?.node_id ? ` (node ${error.error.node_id})` : "";
    return new ComfyEngineError(`${detail}${node}`, 502);
  }
  if (error instanceof ComfyError) {
    return new ComfyEngineError(`${fallback}: ${error.message}`, error.httpStatus || 502);
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    // Propagate cancellation untouched — the caller distinguishes it.
    throw error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  // Nothing came back, so the engine has not rejected anything and the job it
  // was asked about is very likely still running. Said as a verdict, one dropped
  // socket or one slow reply ends a render that was fine.
  if (engineNeverAnswered(error)) {
    return new ComfyEngineError(`Could not reach ${label}: ${detail}`, 503, { transient: true });
  }
  return new ComfyEngineError(`${fallback}: ${detail}`);
}
