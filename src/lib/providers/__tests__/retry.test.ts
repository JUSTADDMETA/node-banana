import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry, isTransientError, retryDelayMs, retryTransient } from "../retry";

const mockFetch = vi.fn();
const sleep = vi.fn(async () => {});
const answer = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : "{}", { status, headers });

// The suite's setup zeroes the backoff for every other test; these check the real one.
const realDelays = () => { process.env.NODE_BANANA_RETRY_DELAY_MS = "1000"; };
const testDelays = () => { process.env.NODE_BANANA_RETRY_DELAY_MS = "0"; };

describe("fetchWithRetry", () => {
  beforeEach(() => {
    realDelays();
    mockFetch.mockReset();
    sleep.mockClear();
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    testDelays();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks again after a 503 and returns the answer that went through", async () => {
    mockFetch.mockResolvedValueOnce(answer(503)).mockResolvedValueOnce(answer(200));
    const response = await fetchWithRetry("https://api.example.com/run", { method: "POST" }, { sleep });
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000, undefined);
  });

  it("waits the delay a 503 names", async () => {
    mockFetch.mockResolvedValueOnce(answer(503, { "retry-after": "3" })).mockResolvedValueOnce(answer(200));
    await fetchWithRetry("https://api.example.com/run", {}, { sleep });
    expect(sleep).toHaveBeenCalledWith(3000, undefined);
  });

  it("treats a rate limit as the provider's answer, not a passing fault", async () => {
    mockFetch.mockResolvedValueOnce(answer(429));
    expect((await fetchWithRetry("https://api.example.com/run", {}, { sleep })).status).toBe(429);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns the last transient answer once attempts run out, for the caller to report", async () => {
    mockFetch.mockResolvedValue(answer(503));
    const response = await fetchWithRetry("https://api.example.com/run", {}, { sleep, attempts: 3 });
    expect(response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("never repeats a refusal", async () => {
    mockFetch.mockResolvedValueOnce(answer(400));
    const response = await fetchWithRetry("https://api.example.com/run", {}, { sleep });
    expect(response.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("asks again after a dropped connection, and gives up on a refused one", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(answer(200));
    expect((await fetchWithRetry("https://api.example.com/run", {}, { sleep })).status).toBe(200);
    mockFetch.mockReset();
    mockFetch.mockRejectedValueOnce(new Error("Invalid URL"));
    await expect(fetchWithRetry("https://api.example.com/run", {}, { sleep })).rejects.toThrow("Invalid URL");
  });

  it("stops when the caller's signal aborts", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async () => { controller.abort(); return answer(503); });
    const response = await fetchWithRetry("https://api.example.com/run", { signal: controller.signal }, { sleep });
    expect(response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("retryTransient", () => {
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("repeats work that threw an SDK error with a transient status, then returns its value", async () => {
    const work = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Service Unavailable"), { status: 503 })).mockResolvedValueOnce("done");
    expect(await retryTransient(work, { sleep: async () => {} })).toBe("done");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("throws a final error at once", async () => {
    const work = vi.fn().mockRejectedValue(Object.assign(new Error("Bad request"), { status: 400 }));
    await expect(retryTransient(work, { sleep: async () => {} })).rejects.toThrow("Bad request");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("throws the last transient error once attempts run out", async () => {
    const work = vi.fn().mockRejectedValue(new Error("The model is overloaded. Please try again later."));
    await expect(retryTransient(work, { sleep: async () => {}, attempts: 2 })).rejects.toThrow("overloaded");
    expect(work).toHaveBeenCalledTimes(2);
  });
});

describe("what counts as transient", () => {
  beforeEach(realDelays);
  afterEach(testDelays);

  it("reads statuses, Google's wording and dropped connections", () => {
    expect(isTransientError(Object.assign(new Error("x"), { status: 503 }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("x"), { httpStatus: 502 }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("x"), { status: 429 }))).toBe(false);
    expect(isTransientError(Object.assign(new Error("x"), { status: 404 }))).toBe(false);
    expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransientError(new Error("UNAVAILABLE: The model is overloaded"))).toBe(true);
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientError(new Error("Invalid input parameters"))).toBe(false);
    expect(isTransientError(new DOMException("Aborted", "AbortError"))).toBe(false);
  });

  it("backs off 1s, 2s, 4s and caps at 10s", () => {
    expect([0, 1, 2, 5].map((n) => retryDelayMs(n))).toEqual([1000, 2000, 4000, 10_000]);
    expect(retryDelayMs(0, "60")).toBe(10_000);
    expect(retryDelayMs(0, "junk")).toBe(1000);
  });
});
