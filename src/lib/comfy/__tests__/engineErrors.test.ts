import { describe, it, expect, vi, afterEach } from "vitest";

import { ComfyEngineError, engineNeverAnswered, errorCode } from "../server/engine";
import { createEngineFetch } from "../server/fetch";
import { SdkComfyEngine } from "../server/sdkEngine";
import type { ComfyConnection } from "../types";

/** What Node's fetch throws when the request never reaches the host. */
const fetchFailed = (code?: string) => {
  const error = new TypeError("fetch failed");
  if (code) (error as { cause?: unknown }).cause = { code };
  return error;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

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

/** What a dual-stack host that answered on no address looks like. */
const noAddressAnswered = () => {
  const inner = new Error("connect ETIMEDOUT");
  (inner as { code?: string }).code = "ETIMEDOUT";
  const aggregate = new AggregateError([inner], "");
  (aggregate as { code?: string }).code = "ETIMEDOUT";
  const outer = new TypeError("fetch failed");
  (outer as { cause?: unknown }).cause = aggregate;
  return outer;
};

/** What `AbortSignal.timeout()` throws — the Comfy SDK arms one per request. */
const timedOut = () => {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
};

describe("engineNeverAnswered", () => {
  it("recognises a request that never arrived", () => {
    expect(engineNeverAnswered(fetchFailed())).toBe(true);
    expect(engineNeverAnswered(fetchFailed("ECONNRESET"))).toBe(true);
    expect(engineNeverAnswered(fetchFailed("EAI_AGAIN"))).toBe(true);
    expect(engineNeverAnswered(fetchFailed("UND_ERR_SOCKET"))).toBe(true);
    expect(engineNeverAnswered(noAddressAnswered())).toBe(true);
  });

  it("recognises a request we stopped waiting for", () => {
    // Both timeout shapes: the SDK's AbortSignal.timeout, and resilientFetch's.
    expect(engineNeverAnswered(timedOut())).toBe(true);
    expect(
      engineNeverAnswered(new Error("Request to https://cloud.comfy.org timed out after 30000ms"))
    ).toBe(true);
  });

  it("does not claim an answer the engine actually gave", () => {
    // A rejected key, a failed node, an out-of-credit account: all verdicts.
    expect(engineNeverAnswered(new Error("Comfy Cloud rejected the API key"))).toBe(false);
    expect(engineNeverAnswered(new Error("KSampler: CUDA out of memory"))).toBe(false);
    expect(engineNeverAnswered("not an error")).toBe(false);
  });
});

describe("errorCode", () => {
  it("digs the code out of an AggregateError over every address tried", () => {
    expect(errorCode(noAddressAnswered())).toBe("ETIMEDOUT");
  });

  it("reads the ordinary single-cause shape too", () => {
    expect(errorCode(fetchFailed("ECONNRESET"))).toBe("ECONNRESET");
    expect(errorCode(new Error("plain"))).toBe(null);
  });
});

describe("createEngineFetch", () => {
  const okResponse = () => new Response("{}", { status: 200 });

  it("repeats a POST whose connection never opened", async () => {
    // The observed failure: uploading an input to Comfy Cloud failed on roughly
    // half of attempts with this exact shape, and nothing retried it.
    let calls = 0;
    const inner = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw noAddressAnswered();
      return okResponse();
    });
    vi.stubGlobal("fetch", inner);

    const engineFetch = createEngineFetch({ retryBaseMs: 0 });
    const res = await engineFetch("https://cloud.comfy.org/api/v2/jobs", { method: "POST" });

    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("does not repeat a POST the engine may already have acted on", async () => {
    // A socket that opened and then broke could have delivered the request, so
    // sending it again risks a second job on the user's bill.
    const inner = vi.fn(async () => {
      throw fetchFailed("ECONNRESET");
    });
    vi.stubGlobal("fetch", inner);

    const engineFetch = createEngineFetch({ retryBaseMs: 0 });
    await expect(
      engineFetch("https://cloud.comfy.org/api/v2/jobs", { method: "POST" })
    ).rejects.toThrow("fetch failed");
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("repeats a GET on any unanswered request, since asking twice costs nothing", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls < 2) throw fetchFailed("ECONNRESET");
      return okResponse();
    });

    const engineFetch = createEngineFetch({ retryBaseMs: 0 });
    expect((await engineFetch("https://cloud.comfy.org/api/queue")).status).toBe(200);
    expect(calls).toBe(2);
  });

  it("hands back an answer the engine gave, however bad", async () => {
    // A 500 is the engine talking. Retrying it here would hide it and bill twice.
    const inner = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", inner);

    const engineFetch = createEngineFetch({ retryBaseMs: 0 });
    expect((await engineFetch("https://cloud.comfy.org/api/v2/jobs", { method: "POST" })).status).toBe(500);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  /** A fetch that never answers, so only the armed timeout ends it. */
  const stubStalledFetch = (starts: number[]) =>
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      starts.push(Date.now());
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });

  it("does not let one stalled request outlast the caller's whole budget", async () => {
    // The failure this prevents: a poll inherited the timeout meant for
    // downloading a finished video, and was then retried four times. One
    // request could occupy 25 minutes, so an 8-second video reported "timed out
    // after 15 min" having been asked about exactly once.
    const starts: number[] = [];
    stubStalledFetch(starts);

    const engineFetch = createEngineFetch({ retryBaseMs: 0, requestTimeoutMs: 40 });
    const began = Date.now();
    await expect(engineFetch("https://cloud.comfy.org/api/v2/jobs/job-1")).rejects.toThrow();

    // Bounded by elapsed time, not by the retry count: four retries of one
    // timeout would be five times the wait, and the caller checks its own
    // deadline only between requests.
    expect(Date.now() - began).toBeLessThan(40 * 4);
    expect(starts.length).toBeGreaterThanOrEqual(1);
  });

  it("gives an asset transfer longer than a poll", async () => {
    // Same client and same code path — only the URL differs. A poll is a few
    // hundred bytes; collecting a finished job can be a whole video.
    const starts: number[] = [];
    stubStalledFetch(starts);
    const engineFetch = createEngineFetch({
      retryBaseMs: 0,
      requestTimeoutMs: 30,
      downloadTimeoutMs: 400,
    });

    const pollBegan = Date.now();
    await expect(engineFetch("https://cloud.comfy.org/api/v2/jobs/job-1")).rejects.toThrow();
    const pollTook = Date.now() - pollBegan;

    const assetBegan = Date.now();
    await expect(
      engineFetch("https://cloud.comfy.org/api/v2/assets/abc/content")
    ).rejects.toThrow();
    const assetTook = Date.now() - assetBegan;

    expect(assetTook).toBeGreaterThan(pollTook * 2);
  }, 20_000);

  it("stops when the caller cancels", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", async () => {
      controller.abort();
      throw noAddressAnswered();
    });

    const engineFetch = createEngineFetch({ retryBaseMs: 0 });
    await expect(
      engineFetch("https://cloud.comfy.org/api/v2/jobs", {
        method: "POST",
        signal: controller.signal,
      })
    ).rejects.toThrow();
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
