/**
 * Retrying a provider request that failed for a passing reason.
 *
 * Providers answer 502, 503 or 504 (an upstream briefly down), 429 (a rate
 * limit), 408 or a dropped connection now and then, and the same request
 * goes through a moment later. A run should not fail on that. The submit
 * of a generation, an LLM call and the like are retried a couple of times
 * with a short backoff (or the delay a Retry-After names), on the caller's
 * abort signal. A refusal (400, 401, 402, 403, 404, 422) is final and is
 * never repeated.
 */

/**
 * Statuses worth another try: the request was not acted on, or not yet. A
 * 429 is not among them: a rate limit is often a quota the provider will
 * not lift in a few seconds, and each provider already words it for the
 * user; the poll loops back off on it themselves.
 */
const TRANSIENT_STATUSES = new Set([408, 425, 500, 502, 503, 504]);
const DEFAULT_ATTEMPTS = 3;
const MAX_DELAY_MS = 10_000;

/** The first wait, doubled per attempt. NODE_BANANA_RETRY_DELAY_MS overrides it; tests set it to 0. */
function baseDelayMs(): number {
  const raw = process.env.NODE_BANANA_RETRY_DELAY_MS;
  const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000;
}

export interface RetryOptions {
  /** Total attempts, the first included (default 3). */
  attempts?: number;
  signal?: AbortSignal;
  /** For the log line. */
  label?: string;
  /** Test hook: the wait between attempts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

/**
 * A thrown error that reads as passing: a dropped or refused connection
 * (fetch's TypeError), a timeout, or an SDK error carrying a transient
 * HTTP status or Google's UNAVAILABLE / overloaded wording.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "TimeoutError";
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown; httpStatus?: unknown; statusCode?: unknown }).status
    ?? (error as { httpStatus?: unknown }).httpStatus
    ?? (error as { statusCode?: unknown }).statusCode;
  if (typeof status === "number") return isTransientStatus(status);
  if (error instanceof TypeError) return /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(error.message) || error.message === "fetch failed";
  return /\b(503|502|504)\b|UNAVAILABLE|overloaded|temporarily unavailable|ECONNRESET|socket hang up/i.test(error.message);
}

export function retryDelayMs(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at) && at > Date.now()) return Math.min(at - Date.now(), MAX_DELAY_MS);
  }
  return Math.min(baseDelayMs() * 2 ** attempt, MAX_DELAY_MS);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `work` again after a transient failure. `work` returns the value, or
 * throws; a thrown error that `isTransientError` accepts is retried while
 * attempts remain, anything else is thrown at once.
 */
export async function retryTransient<T>(work: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await work(attempt);
    } catch (error) {
      if (attempt + 1 >= attempts || options.signal?.aborted || !isTransientError(error)) throw error;
      const delay = retryDelayMs(attempt);
      console.warn(`[retry] ${options.label ?? "request"} failed (${error instanceof Error ? error.message : String(error)}), trying again in ${delay}ms`);
      await sleep(delay, options.signal);
    }
  }
}

/**
 * `fetch` that asks again after a transient answer or a dropped connection.
 * A response with a final status is returned as it is for the caller to read;
 * a transient one is retried while attempts remain, and the last one is
 * returned so the caller's own error reporting still runs.
 */
export async function fetchWithRetry(input: string | URL, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const sleep = options.sleep ?? defaultSleep;
  const signal = options.signal ?? (init.signal ?? undefined);
  const label = options.label ?? `${init.method ?? "GET"} ${String(input).split("?")[0]}`;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      if (attempt + 1 >= attempts || signal?.aborted || !isTransientError(error)) throw error;
      const delay = retryDelayMs(attempt);
      console.warn(`[retry] ${label}: ${error instanceof Error ? error.message : String(error)}, trying again in ${delay}ms`);
      await sleep(delay, signal);
      continue;
    }
    if (!isTransientStatus(response.status) || attempt + 1 >= attempts || signal?.aborted) return response;
    // Defensive reads: a test's stand-in response may carry no headers or body.
    const delay = retryDelayMs(attempt, response.headers?.get?.("retry-after") ?? null);
    console.warn(`[retry] ${label}: HTTP ${response.status}, trying again in ${delay}ms`);
    await response.body?.cancel?.().catch?.(() => undefined);
    await sleep(delay, signal);
  }
}
