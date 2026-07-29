/**
 * The engine interface.
 *
 * Node Banana drives ComfyUI over two different wire protocols and hides the
 * difference behind this one interface:
 *
 * - {@link import("./legacyEngine").LegacyComfyEngine} speaks the classic
 *   `/api/prompt` + `/api/history` surface that every ComfyUI has served for
 *   years. It is the only option for a stock local install, and Comfy Cloud
 *   serves it too.
 * - {@link import("./sdkEngine").SdkComfyEngine} speaks the Comfy API v2
 *   (`/api/v2/jobs`) through `@comfyorg/sdk`, which adds content-addressed
 *   asset dedup, idempotent submits and typed errors. Available on Comfy Cloud
 *   and on a self-hosted install fronted by `comfy-api-proxy`.
 *
 * Engines are **stateless**: every method reconstructs what it needs from the
 * connection, so a job submitted by one request can be polled by the next —
 * which is what lets a 15-minute render outlive a single serverless
 * invocation.
 */

import type {
  ComfyConnection,
  ComfyGraph,
  ComfyObjectInfo,
  ComfyOutputType,
} from "../types";

/** Media uploaded to an engine before a run. */
export interface ComfyUploadInput {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

/**
 * What to write into the graph so a node reads the uploaded media.
 *
 * The legacy surface returns the filename the engine stored it under; the v2
 * surface returns a `core/ASSET` reference object. Both are patched into the
 * loader node's widget verbatim.
 */
export type ComfyUploadRef = string | Record<string, unknown>;

/** A job's state at one point in time. */
export interface ComfyJobState {
  /** Engine-reported status string, passed through for display. */
  status: string;
  /** True once the job will not change again. */
  terminal: boolean;
  /** Set when the job ended in anything other than success. */
  error: string | null;
  /** 0–1 when the engine reports progress. */
  progress?: number;
  /** Opaque payload the same engine consumes in {@link ComfyEngine.collect}. */
  raw: unknown;
}

/** One finished output, already downloaded. */
export interface ComfyOutputAsset {
  /** Graph node that produced it. */
  nodeId: string;
  type: ComfyOutputType;
  /** Media payload — absent for text outputs. */
  bytes?: Uint8Array;
  contentType?: string;
  filename?: string;
  /** Text payload — present only for text outputs. */
  text?: string;
}

export interface ComfySubmitOptions {
  /**
   * comfy.org key authenticating partner/API nodes *inside* the graph. Sent as
   * `extra_data.api_key_comfy_org`; without it those nodes fail with "Please
   * login first to use this node" even on an authorized job.
   */
  orgApiKey?: string | null;
  signal?: AbortSignal;
}

export interface ComfyEngine {
  readonly connection: ComfyConnection;
  /** Human-readable name for error messages. */
  readonly label: string;

  /** Reachability + auth probe. Never throws. */
  ping(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }>;

  /** The engine's node catalog — needed to interpret editor-format saves. */
  objectInfo(signal?: AbortSignal): Promise<ComfyObjectInfo>;

  /** Upload one media input, returning the value to patch into the graph. */
  upload(input: ComfyUploadInput, signal?: AbortSignal): Promise<ComfyUploadRef>;

  /** Enqueue a graph. Returns the id used to poll it. */
  submit(graph: ComfyGraph, options?: ComfySubmitOptions): Promise<string>;

  /** Read a job's current state. */
  poll(jobId: string, signal?: AbortSignal): Promise<ComfyJobState>;

  /** Download everything a finished job produced. */
  collect(state: ComfyJobState, signal?: AbortSignal): Promise<ComfyOutputAsset[]>;

  /** Best-effort stop. Must never throw. */
  cancel(jobId: string, signal?: AbortSignal): Promise<void>;
}

/** An engine-reported failure that should be shown to the user verbatim. */
export class ComfyEngineError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "ComfyEngineError";
    this.status = status;
  }
}
