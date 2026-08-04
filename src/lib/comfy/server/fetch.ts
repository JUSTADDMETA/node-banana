/**
 * Resilient HTTP for ComfyUI engines.
 *
 * Two failure modes plague long-running engine calls and neither is handled by
 * a bare `fetch`: a request that hangs forever stalls the whole run, and a
 * momentary blip or 5xx throws away progress. This adds a per-request timeout
 * (combined with the caller's cancellation signal) plus bounded retries.
 *
 * The body is buffered inside the armed timeout window: `fetch` resolves at
 * headers, so a stalled or trickling body would otherwise escape both the
 * timeout and the caller's cancel.
 */

import { engineNeverAnswered, errorCode } from "./engine";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Transient statuses worth retrying (rate limit, gateway, overloaded). */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Statuses whose Response must be constructed with a null body. */
const NO_BODY_STATUS = new Set([204, 205, 304]);

export interface ResilientFetchOptions extends Omit<RequestInit, "signal"> {
  /** Abort after this many ms — bounds headers AND body. */
  timeoutMs?: number;
  /** Extra attempts on transient failures (0 = none). */
  retries?: number;
  /** Base backoff between attempts, in ms (grows exponentially). */
  retryBaseMs?: number;
  /** Caller's cancellation signal. */
  signal?: AbortSignal | undefined;
}

/**
 * `fetch` with a timeout, caller-cancellation, and bounded retries. Resolves
 * with a fully-buffered Response. A timeout surfaces as a plain (retryable)
 * Error — never an `AbortError` — so callers don't mistake it for a user
 * cancellation.
 */
export async function resilientFetch(
  url: string | URL,
  {
    timeoutMs = 30_000,
    retries = 0,
    retryBaseMs = 400,
    signal,
    ...init
  }: ResilientFetchOptions = {}
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await sleep(retryBaseMs * 2 ** attempt);
        continue;
      }
      // Consume the body before the finally disarms the timer — the timeout
      // must bound the whole transfer, and cancel must be able to kill a body
      // read, not just time-to-headers.
      const bytes = await res.arrayBuffer();
      return new Response(NO_BODY_STATUS.has(res.status) ? null : bytes, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch (err) {
      if (signal?.aborted) {
        throw err instanceof Error && err.name === "AbortError"
          ? err
          : new DOMException("Aborted", "AbortError");
      }
      lastErr = controller.signal.aborted
        ? new Error(`Request to ${String(url)} timed out after ${timeoutMs}ms`)
        : err;
      if (attempt < retries) {
        await sleep(retryBaseMs * 2 ** attempt);
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Codes that prove the request never reached the engine.
 *
 * These are raised while opening the socket, so nothing was sent and nothing
 * can have been acted on — which is what makes repeating the request safe even
 * when it is a POST that would otherwise be dangerous to send twice.
 *
 * `ETIMEDOUT` inside an `AggregateError` is the common one in practice: Node
 * tries every address a dual-stack host resolves to, and reports the whole
 * batch failing this way when none of them answers in time.
 */
const CONNECT_FAILURE = /^(ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)$/;

export interface EngineFetchOptions {
  /** Extra attempts after a connection that never opened. */
  retries?: number;
  /** Base backoff between attempts, in ms (grows exponentially). */
  retryBaseMs?: number;
}

/**
 * A `fetch` that survives a connection which never opened.
 *
 * `@comfyorg/sdk` performs its own HTTP and retries nothing below the API layer,
 * so a single failed connect ends an upload, a submit, or a poll — and with it
 * the whole render. It does accept a `fetch` implementation, which is the seam
 * this fills: the SDK keeps its protocol handling and gains the same
 * resilience {@link resilientFetch} already gives the legacy engine.
 *
 * Only connect-phase failures are repeated for a request that changes state.
 * A GET may also be repeated on any unanswered request, because asking twice
 * costs nothing. Anything the engine actually answered is passed straight back:
 * a 4xx or 5xx is the engine talking, and this layer does not second-guess it.
 */
export function createEngineFetch(options: EngineFetchOptions = {}): typeof fetch {
  // Four, not one or two: the failure this exists for was measured at roughly
  // two attempts in five against Comfy Cloud, which still leaves about one run
  // in twenty dying after three tries. Each extra attempt costs a few hundred
  // milliseconds of backoff and only ever happens when no socket opened.
  const { retries = 4, retryBaseMs = 300 } = options;

  return async function engineFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const repeatable = method === "GET" || method === "HEAD";

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetch(input, init);
      } catch (error) {
        const code = errorCode(error);
        const neverConnected = code !== null && CONNECT_FAILURE.test(code);
        const worthRetrying = neverConnected || (repeatable && engineNeverAnswered(error));
        // A caller who cancelled is not waiting for another attempt.
        if (!worthRetrying || attempt >= retries || init?.signal?.aborted) throw error;
        await sleep(retryBaseMs * 2 ** attempt);
      }
    }
  };
}
