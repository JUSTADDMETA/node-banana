/**
 * Poll a running Comfy app job, and collect its outputs once it finishes.
 *
 * Short-lived by design: the client calls this repeatedly instead of holding
 * one connection open for the length of a render.
 */

import { NextRequest, NextResponse } from "next/server";

import { engineFromRequest } from "@/lib/comfy/server";
import { collectRun, nameFailedOutput } from "@/lib/comfy/server/run";
import type { ComfyAppDefinition, ComfyResolvedOutput } from "@/lib/comfy/types";
import { comfyErrorResponse } from "../shared";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface ComfyPollRequest {
  jobId: string;
  /** Needed to map produced files back onto the node's output handles. */
  app: ComfyAppDefinition;
  /** Set to stop the job instead of reading it. */
  cancel?: boolean;
}

export interface ComfyPollResponse {
  success: true;
  /** True while the job is still running. */
  polling: boolean;
  status: string;
  progress?: number;
  /** Present once the job succeeded. */
  outputs?: ComfyResolvedOutput[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ComfyPollRequest;
    if (!body?.jobId) {
      return NextResponse.json({ success: false, error: "No job id" }, { status: 400 });
    }

    const { engine } = engineFromRequest(request);

    if (body.cancel) {
      await engine.cancel(body.jobId, request.signal);
      return NextResponse.json<ComfyPollResponse>({
        success: true,
        polling: false,
        status: "cancelled",
      });
    }

    const state = await engine.poll(body.jobId, request.signal);

    if (!state.terminal) {
      return NextResponse.json<ComfyPollResponse>({
        success: true,
        polling: true,
        status: state.status,
        ...(state.progress !== undefined ? { progress: state.progress } : {}),
      });
    }

    if (state.error) {
      return NextResponse.json(
        { success: false, error: nameFailedOutput(state, body.app) },
        { status: 502 }
      );
    }

    const outputs = await collectRun(engine, body.app, state, request.signal);
    return NextResponse.json<ComfyPollResponse>({
      success: true,
      polling: false,
      status: state.status,
      outputs,
    });
  } catch (error) {
    return comfyErrorResponse(error);
  }
}
