/**
 * Shared helpers for the `/api/comfy/*` routes.
 *
 * A NON-route module (no HTTP handler exports) so the handlers and their tests
 * can share logic without Next.js treating the extra exports as routes.
 */

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { ComfyConfigError } from "@/lib/comfy/server";
import { ComfyEngineError } from "@/lib/comfy/server/engine";
import { ComfyImportError } from "@/lib/comfy/server/import";
import { ComfyConversionError } from "@/lib/comfy/editor";

export interface ComfyErrorResponse {
  success: false;
  error: string;
  /** Node types the engine is missing, when that is why the import failed. */
  missingNodes?: string[];
  /** True when the user simply has not connected an engine yet. */
  notConfigured?: boolean;
}

/**
 * Turn any failure into the response shape the client understands.
 *
 * Every message here is shown verbatim in the UI, so they name the thing to do
 * next rather than the layer that failed.
 */
export function comfyErrorResponse(error: unknown): NextResponse<ComfyErrorResponse> {
  if (error instanceof ComfyConfigError) {
    return NextResponse.json<ComfyErrorResponse>(
      { success: false, error: error.message, notConfigured: true },
      { status: error.status }
    );
  }
  if (error instanceof ComfyImportError) {
    return NextResponse.json<ComfyErrorResponse>(
      {
        success: false,
        error: error.message,
        ...(error.missingNodes.length > 0 ? { missingNodes: error.missingNodes } : {}),
      },
      { status: error.status }
    );
  }
  if (error instanceof ComfyEngineError) {
    return NextResponse.json<ComfyErrorResponse>(
      { success: false, error: error.message },
      { status: error.status }
    );
  }
  if (error instanceof ComfyConversionError) {
    return NextResponse.json<ComfyErrorResponse>(
      { success: false, error: error.message },
      { status: 422 }
    );
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return NextResponse.json<ComfyErrorResponse>(
      { success: false, error: "Cancelled" },
      { status: 499 }
    );
  }
  return NextResponse.json<ComfyErrorResponse>(
    { success: false, error: error instanceof Error ? error.message : "ComfyUI request failed" },
    { status: 500 }
  );
}

const DATA_URL = /^data:([^;,]+)?(;base64)?,/;

/** Decoded media from a `data:` URL. */
export interface DecodedMedia {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Decode a `data:` URL into bytes.
 *
 * Node Banana passes media between nodes as data URLs, so this is how a
 * connected image reaches the engine. Returns null for anything else (a remote
 * URL, a blob: URL that never survived serialization) so the caller can report
 * which input could not be read.
 */
export function decodeDataUrl(value: string): DecodedMedia | null {
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const contentType = match[1] || "application/octet-stream";
  const payload = value.slice(match[0].length);
  try {
    const bytes = match[2]
      ? new Uint8Array(Buffer.from(payload, "base64"))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return bytes.length > 0 ? { bytes, contentType } : null;
  } catch {
    return null;
  }
}

/**
 * A content-addressed filename for an uploaded input.
 *
 * The legacy upload uses `overwrite: true`, so two runs sharing a filename
 * clobber each other on the engine — two Comfy nodes running concurrently with
 * the same input name would render each other's image. Hashing the bytes makes
 * the name unique per image *and* keeps re-running with an unchanged input
 * from re-uploading it.
 */
export function uploadFilename(name: string, contentType: string, bytes: Uint8Array): string {
  const ext = contentType.split("/")[1]?.split("+")[0] ?? "bin";
  const slug = name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 24) || "input";
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `node-banana-${slug}-${hash}.${ext}`;
}
