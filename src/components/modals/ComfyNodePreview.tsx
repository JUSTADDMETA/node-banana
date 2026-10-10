"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { RefreshCw, Settings, type LucideIcon } from "lucide-react";
import React, { useId, useMemo, useState } from "react";

import { ComfyWordmark } from "@/components/icons/ComfyWordmark";
import { ComfyAppParameters } from "@/components/nodes/ComfyAppParameters";
import { FloatingNodeHeader } from "@/components/nodes/FloatingNodeHeader";
import {
  CARD_PAD,
  CONTROLS_GAP,
  ControlsCard,
  HeightGrip,
  SocketMark,
  SummaryValues,
  socketMinHeight,
  type SocketSpec,
} from "@/components/nodes/ui";
import { initialSeedValues } from "@/lib/comfy/seeds";
import type { ComfyAppInput, ComfyAppOutput, ComfyAppParam, ComfySeedMode } from "@/lib/comfy/types";

/**
 * The node this dialog is about to build, drawn as the canvas draws it.
 *
 * The picks on the left are a list of bindings; what the user is actually
 * deciding is the shape of a node — how many handles it carries, what they are
 * called, which knobs sit under it. This says that in the only language that
 * answers it, and updates as they choose.
 *
 * Assembled from the node's own parts rather than mounted as the node: the
 * real one is a React Flow node wired to the workflow store, and its shell
 * writes to that store on hover. So the header, the controls card, the
 * settings and the sockets' glyph are the canvas's own components; the media
 * card is the shell's markup on the same tokens, with nothing to run.
 */

/** ComfyAppNode's `minWidth`: the preview is a measurement, not an impression. */
const NODE_WIDTH = 260;
/** ComfyAppNode's `TEXTUAL_HEIGHT`: the slot a node with no output yet shows. */
const MEDIA_HEIGHT = 120;
/** Never a node on the canvas, so nothing there reacts to this one. */
const PREVIEW_NODE_ID = "comfy-node-preview";

interface ComfyNodePreviewProps {
  name: string;
  source: "blueprint" | "upload";
  nodeCount: number;
  inputs: ComfyAppInput[];
  params: ComfyAppParam[];
  outputs: ComfyAppOutput[];
}

export function ComfyNodePreview({
  name,
  source,
  nodeCount,
  inputs,
  params,
  outputs,
}: ComfyNodePreviewProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(true);
  const [mediaHeight, setMediaHeight] = useState(MEDIA_HEIGHT);

  // Seeded the way the node seeds itself on attach: defaults, and a seed
  // chosen for each exposed seed. Edits are kept but not saved: nothing typed
  // in a preview is, and a control that cannot be moved reads as a broken one.
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [seedModes, setSeedModes] = useState<Record<string, ComfySeedMode>>({});
  // Chosen once per seed, not on every pick, or each change on the left
  // would reroll the seeds on the right.
  const [seeds, setSeeds] = useState<Record<string, number>>({});
  const missingSeeds = params.filter((param) => param.isSeed && !(param.id in seeds));
  if (missingSeeds.length > 0) setSeeds({ ...seeds, ...initialSeedValues(missingSeeds) });
  const values = useMemo(() => {
    const seeded: Record<string, unknown> = { ...seeds };
    for (const param of params) {
      if (param.default !== undefined && !param.isSeed) seeded[param.id] = param.default;
    }
    return { ...seeded, ...edits };
  }, [params, seeds, edits]);

  const inputSockets = useMemo<SocketSpec[]>(
    () =>
      inputs.map((input) => ({
        id: input.id,
        type: input.type,
        label: input.label,
        title: input.description || input.label,
      })),
    [inputs]
  );
  const outputSockets = useMemo<SocketSpec[]>(
    () => outputs.map((output) => ({ id: output.id, type: output.type, label: output.label, title: output.label })),
    [outputs]
  );
  const rows = Math.max(inputSockets.length, outputSockets.length);
  const hasParams = params.length > 0;

  return (
    <div className="h-full rounded-well bg-well ring-1 ring-inset ring-black/40 overflow-y-auto overflow-x-hidden flex justify-center p-6">
      {/* Centred with `my-auto` rather than `items-center`: a centred flex
          child in a scroll container has its overflowing top cut off and
          unreachable, and a node with every widget exposed overflows easily.
          The top padding is the room the floating header takes. */}
      <div className="relative isolate shrink-0 my-auto pt-[26px]" style={{ width: NODE_WIDTH }} data-comfy-node-preview>
        <ReactFlowProvider>
          <div className="relative flex flex-col items-center w-full">
            {/* The canvas's own header, at rest. Run and the kebab stay
                invisible but keep their width, which is what cuts a long name
                short on the canvas; inert, so none of it can be reached. */}
            <div inert>
              <FloatingNodeHeader
                id={PREVIEW_NODE_ID}
                type="comfyApp"
                position={{ x: 0, y: 0 }}
                width={NODE_WIDTH}
                selected={false}
                title={name}
                titleLogo={<ComfyWordmark className="h-3 w-auto shrink-0" />}
                onRunNode={noop}
              />
            </div>

            <div
              data-media-card
              className="relative w-full shrink-0 rounded-card squircle bg-card border border-card-border overflow-visible"
              style={{ padding: CARD_PAD, minHeight: socketMinHeight(rows) }}
            >
              <div
                data-media-clip
                className="relative w-full rounded-media squircle overflow-hidden bg-neutral-900/60"
                style={{ contain: "layout style", height: mediaHeight }}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] text-neutral-600">No output yet</span>
                  <HeightGrip height={mediaHeight} onChange={setMediaHeight} />
                </div>
              </div>
              {/* Labelled at all times: here the names are what is being decided. */}
              {inputSockets.map((spec, row) => (
                <SocketMark key={spec.id} side="left" row={row} spec={spec} showLabel />
              ))}
              {outputSockets.map((spec, row) => (
                <SocketMark key={spec.id} side="right" row={row} spec={spec} showLabel />
              ))}
            </div>

            {/* A new node has no runs to page through, so no history row. */}
            <div data-gap-row className="w-full shrink-0" style={{ height: CONTROLS_GAP }} />

            <ControlsCard
              id={panelId}
              sizing={null}
              summary={{
                icon: <ComfyWordmark className="h-3 w-auto" />,
                title: <span title={name}>{source === "blueprint" ? "Blueprint" : "App workflow"}</span>,
                values: (
                  <span className="flex items-center gap-1.5">
                    <SummaryValues items={[`${nodeCount} node${nodeCount === 1 ? "" : "s"}`]} />
                    <HeaderGlyph icon={Settings} />
                    <HeaderGlyph icon={RefreshCw} />
                  </span>
                ),
              }}
              // Open from the start: collapsed, the one thing this view
              // exists to show would be a chevron.
              expanded={expanded}
              onToggle={hasParams ? () => setExpanded((open) => !open) : undefined}
            >
              {hasParams ? (
                <ComfyAppParameters
                  params={params}
                  values={values}
                  onChange={setEdits}
                  seedModes={seedModes}
                  onSeedModeChange={(paramId, mode) => setSeedModes((modes) => ({ ...modes, [paramId]: mode }))}
                />
              ) : undefined}
            </ControlsCard>
          </div>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

function noop() {}

/** The node's Settings and Replace buttons, drawn but not wired: here they would only reopen this dialog. */
function HeaderGlyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden className="shrink-0 text-neutral-500">
      <Icon size={14} strokeWidth={2} />
    </span>
  );
}
