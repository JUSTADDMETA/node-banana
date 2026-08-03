import { describe, it, expect } from "vitest";

import { ComfyEngineError, isNetworkFailure } from "../server/engine";
import { SdkComfyEngine } from "../server/sdkEngine";
import type { ComfyConnection } from "../types";

/** What Node's fetch throws when the request never reaches the host. */
const fetchFailed = (code?: string) => {
  const error = new TypeError("fetch failed");
  if (code) (error as { cause?: unknown }).cause = { code };
  return error;
};

const connection: ComfyConnection = {
  mode: "cloud",
  baseUrl: "https://cloud.comfy.org",
  apiKey: "comfyui-test",
  useSdk: true,
  jobTimeoutMs: 900_000,
};

/** Stand in for the SDK client, which the engine creates lazily. */
function engineWith(jobsGet: () => unknown): SdkComfyEngine {
  const engine = new SdkComfyEngine(connection);
  (engine as unknown as { client: unknown }).client = { jobs: { get: jobsGet } };
  return engine;
}

describe("isNetworkFailure", () => {
  it("recognises a request that never arrived", () => {
    expect(isNetworkFailure(fetchFailed())).toBe(true);
    expect(isNetworkFailure(fetchFailed("ECONNRESET"))).toBe(true);
    expect(isNetworkFailure(fetchFailed("EAI_AGAIN"))).toBe(true);
    expect(isNetworkFailure(fetchFailed("UND_ERR_SOCKET"))).toBe(true);
  });

  it("does not claim an answer the engine actually gave", () => {
    // A rejected key, a failed node, an out-of-credit account: all verdicts.
    expect(isNetworkFailure(new Error("Comfy Cloud rejected the API key"))).toBe(false);
    expect(isNetworkFailure(new Error("KSampler: CUDA out of memory"))).toBe(false);
    expect(isNetworkFailure("not an error")).toBe(false);
  });
});

describe("SdkComfyEngine.poll", () => {
  it("marks an unreachable engine transient, not a verdict", async () => {
    // The failure this fixes: one dropped socket during a long render used to
    // read as "the job failed", ending a render that was still going.
    const engine = engineWith(() => {
      throw fetchFailed("ECONNRESET");
    });
    const error = await engine.poll("job-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ComfyEngineError);
    expect((error as ComfyEngineError).transient).toBe(true);
    expect((error as ComfyEngineError).status).toBe(503);
    expect((error as ComfyEngineError).message).toContain("Could not reach Comfy Cloud");
  });

  it("keeps an engine verdict terminal", async () => {
    const engine = engineWith(() => {
      throw new Error("job 1 does not exist");
    });
    const error = (await engine.poll("job-1").catch((e: unknown) => e)) as ComfyEngineError;
    expect(error.transient).toBe(false);
    expect(error.status).toBe(502);
    expect(error.message).toContain("Could not read the job from Comfy Cloud");
  });

  it("reports a failed job as a state, not an exception", async () => {
    const engine = engineWith(() => ({
      status: "failed",
      error: { message: "out of memory", node_id: "31" },
    }));
    const state = await engine.poll("job-1");
    expect(state.terminal).toBe(true);
    expect(state.error).toContain("out of memory");
  });
});
