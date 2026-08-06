/**
 * Relay a running job's preview images to the browser.
 *
 * The engine's event stream is not reachable from the page: it needs an
 * `Authorization` header, which `EventSource` cannot send, and the key belongs
 * on this side of the wire anyway. So this route holds the upstream stream open
 * and forwards only the frames the node draws.
 *
 * Newline-delimited JSON rather than SSE, because the client reads it with
 * `fetch` (the only way to send the engine headers) and NDJSON needs no framing
 * beyond `split("\n")`. Nothing here is authoritative: previews are decoration
 * on top of the poll loop, which remains the source of truth for whether a run
 * finished and what it produced.
 */

import { NextRequest, NextResponse } from "next/server";

import { engineFromRequest } from "@/lib/comfy/server";
import { comfyErrorResponse } from "../shared";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface ComfyPreviewRequest {
  jobId: string;
}

/** One frame, as the client receives it. */
export interface ComfyPreviewMessage {
  nodeId: string;
  dataUrl: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ComfyPreviewRequest;
    if (!body?.jobId) {
      return NextResponse.json({ success: false, error: "No job id" }, { status: 400 });
    }

    const { engine } = engineFromRequest(request);
    // A stock ComfyUI has no event stream. Answering "nothing here" is the
    // honest reply, and the caller simply keeps its spinner.
    if (!engine.previews) return new NextResponse(null, { status: 204 });

    const frames = engine.previews(body.jobId, request.signal);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const frame of frames) {
            controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
          }
        } catch {
          // A dropped upstream stream ends this one. It says nothing about the
          // job, which the poll loop is watching regardless, so it is closed
          // quietly rather than raised as a failure the user would have to read.
        } finally {
          controller.close();
        }
      },
      cancel() {
        // The browser navigated away or the run ended; let the generator's
        // `finally` close the upstream connection.
        void frames.return(undefined);
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store, no-transform",
        // Proxies that buffer would defeat the point of streaming at all.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return comfyErrorResponse(error);
  }
}
