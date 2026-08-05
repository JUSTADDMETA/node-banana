/**
 * The Blueprint library.
 *
 * ComfyUI serves its saved subgraphs — Blueprints — from `/api/global_subgraphs`,
 * both on Comfy Cloud and on a local install. Each one is a ready-made pipeline
 * with declared inputs and outputs, so listing them gives Node Banana a catalog
 * of ComfyUI apps the user can drop straight onto the canvas.
 *
 * `GET`  → the catalog (id, name, node pack).
 * `POST` → fetch one blueprint's workflow and inspect it into a node contract.
 */

import { NextRequest, NextResponse } from "next/server";

import { engineFromRequest } from "@/lib/comfy/server";
import { engineAuthHeaders } from "@/lib/comfy/server/connection";
import { resilientFetch } from "@/lib/comfy/server/fetch";
import { inspectUpload } from "@/lib/comfy/server/import";
import { ComfyImportError } from "@/lib/comfy/server/import";
import type { ComfyConnection } from "@/lib/comfy/types";
import { comfyErrorResponse } from "../shared";
import type { ComfyInspectResponse } from "../inspect/route";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** One entry of the engine's `/api/global_subgraphs` map. */
interface GlobalSubgraphEntry {
  name?: string;
  source?: string;
  info?: { node_pack?: string };
  /** Only present on the single-blueprint endpoint — a JSON *string*. */
  data?: string;
}

export interface ComfyBlueprintListItem {
  id: string;
  name: string;
  /** Which pack shipped it — `comfyui`/`default` for the built-ins. */
  nodePack: string;
  /** `templates` for built-ins, `custom_node` for pack-provided ones. */
  source: string;
}

export interface ComfyBlueprintListResponse {
  success: true;
  blueprints: ComfyBlueprintListItem[];
  /** Where they came from, for the empty state. */
  engine: string;
}

/**
 * Read the blueprint catalog.
 *
 * This endpoint is public even on Comfy Cloud, but the key is still sent —
 * a self-hosted install behind a reverse proxy may well require it.
 */
async function fetchCatalog(
  connection: ComfyConnection,
  signal?: AbortSignal
): Promise<Record<string, GlobalSubgraphEntry>> {
  const res = await resilientFetch(`${connection.baseUrl}/api/global_subgraphs`, {
    headers: engineAuthHeaders(connection),
    timeoutMs: 20_000,
    retries: 4,
    ...(signal ? { signal } : {}),
  });
  if (res.status === 404) {
    throw new ComfyImportError(
      "This ComfyUI is too old to serve Blueprints. Update it, or import a workflow file instead.",
      404
    );
  }
  if (!res.ok) {
    throw new ComfyImportError(`Could not list Blueprints (${res.status})`, 502);
  }
  return (await res.json()) as Record<string, GlobalSubgraphEntry>;
}

export async function GET(request: NextRequest) {
  try {
    const { engine, connection } = engineFromRequest(request);
    const catalog = await fetchCatalog(connection, request.signal);

    const blueprints: ComfyBlueprintListItem[] = Object.entries(catalog)
      .map(([id, entry]) => ({
        id,
        name: entry.name?.trim() || id,
        nodePack: entry.info?.node_pack ?? "comfyui",
        source: entry.source ?? "templates",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json<ComfyBlueprintListResponse>({
      success: true,
      blueprints,
      engine: engine.label,
    });
  } catch (error) {
    return comfyErrorResponse(error);
  }
}

interface BlueprintImportRequest {
  /** Catalog id from `GET`. */
  id: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BlueprintImportRequest;
    if (!body?.id) {
      return NextResponse.json({ success: false, error: "No blueprint id" }, { status: 400 });
    }

    const { engine, connection } = engineFromRequest(request);
    const res = await resilientFetch(
      `${connection.baseUrl}/api/global_subgraphs/${encodeURIComponent(body.id)}`,
      {
        headers: engineAuthHeaders(connection),
        timeoutMs: 30_000,
        retries: 4,
        signal: request.signal,
      }
    );
    if (!res.ok) {
      throw new ComfyImportError(`Could not load that Blueprint (${res.status})`, 502);
    }

    const entry = (await res.json()) as GlobalSubgraphEntry;
    if (!entry.data) {
      throw new ComfyImportError("That Blueprint has no workflow attached.", 422);
    }

    // `data` is the workflow JSON carried as an escaped *string*, not a nested
    // object — the engine serialises it that way.
    let workflow: unknown;
    try {
      workflow = JSON.parse(entry.data);
    } catch {
      throw new ComfyImportError("That Blueprint's workflow could not be read.", 422);
    }

    // The file wraps a single subgraph definition; inspect that definition
    // rather than the one-node wrapper graph around it.
    const definitions = (workflow as { definitions?: { subgraphs?: Array<{ id: string }> } })
      .definitions?.subgraphs;
    const blueprintId = definitions?.[0]?.id;

    const inspection = await inspectUpload(workflow, engine, {
      ...(blueprintId ? { blueprintId: String(blueprintId) } : {}),
      defaultName: entry.name?.trim() || body.id,
      signal: request.signal,
    });

    return NextResponse.json<ComfyInspectResponse>({ success: true, ...inspection });
  } catch (error) {
    return comfyErrorResponse(error);
  }
}
