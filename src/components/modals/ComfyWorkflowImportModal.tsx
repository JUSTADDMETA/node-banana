"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ComfyMark } from "@/components/icons/ComfyMark";
import {
  ComfySettingsTab,
  useComfySettingsDraft,
} from "@/components/settings/ComfySettingsTab";
import { buildComfyApp } from "@/lib/comfy/buildApp";
import { loaderInputType } from "@/lib/comfy/graph";
import { inputFromCandidate, inputFromLoader, paramFromCandidate } from "@/lib/comfy/inspect";
import { withAppLabels } from "@/lib/comfy/reconfigure";
import {
  buildComfyHeaders,
  comfyConfigError,
  getComfySettings,
  saveComfySettings,
} from "@/lib/comfy/settings";
import type {
  ComfyAppDefinition,
  ComfyAppInput,
  ComfyAppOutput,
  ComfyGraph,
  ComfyInputType,
  ComfyNodeCandidate,
  ComfyOutputType,
  ComfyWidgetCandidate,
  ComfyWorkflowInspection,
} from "@/lib/comfy/types";

/** A workflow JSON handed to the dialog rather than picked from disk. */
export interface ComfyUpload {
  workflow: unknown;
  /** The original filename — it seeds the node's default name. */
  filename: string;
}

/** An already-attached workflow whose picks are being revisited. */
export interface ComfyReconfigureTarget {
  app: ComfyAppDefinition;
  /** The candidate list stored at import; re-derived from the graph if absent. */
  inspection?: ComfyWorkflowInspection;
}

interface ComfyWorkflowImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The confirmed contract, plus the candidate list it was chosen from. */
  onAttach: (app: ComfyAppDefinition, inspection: ComfyWorkflowInspection) => void;
  /** Shown as the "replacing" hint when the node already has a workflow. */
  existingName?: string;
  /**
   * Set to skip the file/blueprint step and edit an attached workflow's picks
   * directly. The node's current selection is what gets pre-filled, not the
   * inspection's original suggestion.
   */
  reconfigure?: ComfyReconfigureTarget | null;
  /**
   * A workflow the user already handed over — dropped onto the canvas rather
   * than chosen here. Read as soon as the dialog opens, so it lands on the
   * picks with no second "choose a file" step.
   */
  upload?: ComfyUpload | null;
}

interface BlueprintListItem {
  id: string;
  name: string;
  nodePack: string;
  source: string;
}

type Inspection = ComfyWorkflowInspection & { graph: ComfyGraph };

/** How each detected widget is exposed on the node. */
type WidgetRole = "off" | "setting" | "input";

const INPUT_TYPE_LABEL: Record<ComfyInputType, string> = {
  image: "Image",
  text: "Text",
  audio: "Audio",
  video: "Video",
};

const OUTPUT_TYPE_LABEL: Record<ComfyOutputType, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  text: "Text",
  "3d": "3D",
};

const bindingKey = (nodeId: string, inputKey: string): string => `${nodeId}:${inputKey}`;

/** ComfyUI's own guide to preparing a workflow for this — inputs, outputs, saving. */
const APP_MODE_DOCS = "https://docs.comfy.org/interface/app-mode";

/** The dialog's one committing action, wherever the current step puts it. */
const PRIMARY_BUTTON =
  "px-4 py-2 text-sm rounded-lg bg-neutral-100 text-neutral-900 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,scale] duration-150 active:scale-[0.96] disabled:active:scale-100";

/**
 * Import a ComfyUI workflow and confirm what it exposes.
 *
 * Two ways in: a workflow file the user already has (whatever ComfyUI saved —
 * no special export), or a Blueprint the connected engine already ships. Either
 * way the second step is the same: confirm the inputs, settings and outputs
 * that will become the node's handles.
 */
export function ComfyWorkflowImportModal({
  isOpen,
  onClose,
  onAttach,
  existingName,
  reconfigure,
  upload,
}: ComfyWorkflowImportModalProps) {
  const [tab, setTab] = useState<"file" | "blueprints">("file");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [source, setSource] = useState<"upload" | "blueprint">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingNodes, setMissingNodes] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Confirm-step state
  const [name, setName] = useState("");
  const [inputs, setInputs] = useState<ComfyAppInput[]>([]);
  const [outputs, setOutputs] = useState<ComfyAppOutput[]>([]);
  const [roles, setRoles] = useState<Record<string, WidgetRole>>({});

  // Blueprint list state
  const [blueprints, setBlueprints] = useState<BlueprintListItem[] | null>(null);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [blueprintId, setBlueprintId] = useState("");

  // Connection settings, reachable from here: a dialog that reports "no engine
  // configured" and offers no way to configure one is a dead end.
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useComfySettingsDraft(showSettings);
  const [settingsSaved, setSettingsSaved] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const settings = useMemo(
    () => (isOpen ? getComfySettings() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, settingsSaved]
  );
  const configError = settings ? comfyConfigError(settings) : null;

  // Escape belongs to the dialog, not to whatever happens to be focused. Bound
  // on the document because opening the dialog does not move focus into it —
  // a keydown on the page would otherwise never reach the panel.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Focus starts inside, so the first Tab continues through the dialog rather
  // than through the canvas behind it.
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  /** Keep Tab inside the dialog: a modal the keyboard can walk out of is not one. */
  const trapFocus = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  /**
   * Keep the new connection and go back to what the dialog was doing.
   *
   * The Blueprint list is dropped rather than kept: it is the *old* engine's
   * catalog, and the point of coming here was usually that the old one was
   * wrong or unreachable.
   */
  const saveSettings = useCallback(() => {
    saveComfySettings(settingsDraft);
    setSettingsSaved((n) => n + 1);
    setShowSettings(false);
    setBlueprints(null);
    setBlueprintError(null);
  }, [settingsDraft]);

  const reset = useCallback(() => {
    setInspection(null);
    setError(null);
    setMissingNodes([]);
    setName("");
    setInputs([]);
    setOutputs([]);
    setRoles({});
    setBusy(false);
    setDragOver(false);
  }, []);

  useEffect(() => {
    if (!isOpen) setShowSettings(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) reset();
  }, [isOpen, reset]);

  /**
   * Move an inspection into the confirm step.
   *
   * `selection` is the contract whose picks should be pre-filled: the
   * inspection's own suggestion on a fresh import, or the node's existing
   * contract when its picks are being revisited.
   */
  const adopt = useCallback(
    (
      result: Inspection,
      from: "upload" | "blueprint",
      selection?: Pick<ComfyAppDefinition, "name" | "inputs" | "params" | "outputs">
    ) => {
      const picked = selection ?? result.suggested;
      setInspection(result);
      setSource(from);
      setName(picked.name);
      setInputs(picked.inputs);
      setOutputs(picked.outputs);

      const next: Record<string, WidgetRole> = {};
      for (const candidate of result.widgetCandidates) {
        const key = bindingKey(candidate.nodeId, candidate.inputKey);
        if (picked.inputs.some((i) => i.id === key)) next[key] = "input";
        else if (picked.params.some((p) => p.id === key)) next[key] = "setting";
        else next[key] = "off";
      }
      setRoles(next);
    },
    []
  );

  const readError = useCallback(async (response: Response, fallback: string): Promise<string> => {
    try {
      const body = (await response.json()) as { error?: string; missingNodes?: string[] };
      setMissingNodes(body.missingNodes ?? []);
      return body.error ?? fallback;
    } catch {
      return fallback;
    }
  }, []);

  const inspectWorkflow = useCallback(
    async (workflow: unknown, filename: string) => {
      setBusy(true);
      setError(null);
      setMissingNodes([]);
      try {
        const response = await fetch("/api/comfy/inspect", {
          method: "POST",
          headers: buildComfyHeaders(getComfySettings()),
          body: JSON.stringify({ workflow, filename }),
        });
        if (!response.ok) {
          setError(await readError(response, "Could not read that workflow."));
          return;
        }
        adopt((await response.json()) as Inspection, "upload");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that workflow.");
      } finally {
        setBusy(false);
      }
    },
    [adopt, readError]
  );

  const inspectFile = useCallback(
    async (file: File) => {
      let workflow: unknown;
      try {
        workflow = JSON.parse(await file.text());
      } catch {
        setError("That file is not valid JSON.");
        return;
      }
      await inspectWorkflow(workflow, file.name);
    },
    [inspectWorkflow]
  );

  // A workflow dropped onto the canvas: the user has already chosen, so read it
  // rather than showing them a file picker for a file they just gave us. Guarded
  // by identity so a re-render — or a Back out of the picks — does not re-read.
  const readUpload = useRef<ComfyUpload | null>(null);
  useEffect(() => {
    if (!isOpen || !upload || reconfigure) return;
    if (readUpload.current === upload) return;
    readUpload.current = upload;
    void inspectWorkflow(upload.workflow, upload.filename);
  }, [isOpen, upload, reconfigure, inspectWorkflow]);

  // Revisiting an attached workflow: go straight to the picks. The candidate
  // list stored at import is preferred — re-deriving it from the runnable graph
  // works, but App Mode lives in the uploaded file, so the author's curation
  // (which widgets they meant to expose, and their names for them) is lost.
  useEffect(() => {
    if (!isOpen || !reconfigure) return;
    const { app, inspection: stored } = reconfigure;
    const from = app.source === "blueprint" ? "blueprint" : "upload";

    if (stored) {
      adopt(withAppLabels({ ...stored, graph: app.graph }, app), from, app);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch("/api/comfy/inspect", {
          method: "POST",
          headers: buildComfyHeaders(getComfySettings()),
          body: JSON.stringify({ workflow: app.graph, filename: `${app.name}.json` }),
        });
        if (cancelled) return;
        if (!response.ok) {
          setError(await readError(response, "Could not re-read this workflow."));
          return;
        }
        const result = (await response.json()) as Inspection;
        if (!cancelled) adopt(withAppLabels(result, app), from, app);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not re-read this workflow.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, reconfigure, adopt, readError]);

  const loadBlueprints = useCallback(async () => {
    setBlueprintError(null);
    setBlueprints(null);
    try {
      const response = await fetch("/api/comfy/blueprints", {
        headers: buildComfyHeaders(getComfySettings()),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setBlueprintError(body.error ?? "Could not load Blueprints.");
        return;
      }
      const body = (await response.json()) as { blueprints: BlueprintListItem[] };
      setBlueprints(body.blueprints);
    } catch (err) {
      setBlueprintError(err instanceof Error ? err.message : "Could not load Blueprints.");
    }
  }, []);

  useEffect(() => {
    if (isOpen && tab === "blueprints" && blueprints === null && !blueprintError) {
      void loadBlueprints();
    }
  }, [isOpen, tab, blueprints, blueprintError, loadBlueprints]);

  const importBlueprint = useCallback(
    async (blueprintId: string) => {
      setBusy(true);
      setError(null);
      setMissingNodes([]);
      try {
        const response = await fetch("/api/comfy/blueprints", {
          method: "POST",
          headers: buildComfyHeaders(getComfySettings()),
          body: JSON.stringify({ id: blueprintId }),
        });
        if (!response.ok) {
          setError(await readError(response, "Could not load that Blueprint."));
          return;
        }
        adopt((await response.json()) as Inspection, "blueprint");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load that Blueprint.");
      } finally {
        setBusy(false);
      }
    },
    [adopt, readError]
  );

  /** Move a detected widget between "not exposed", "setting" and "input". */
  const setRole = useCallback(
    (candidate: ComfyWidgetCandidate, role: WidgetRole) => {
      const key = bindingKey(candidate.nodeId, candidate.inputKey);
      setRoles((prev) => ({ ...prev, [key]: role }));
      setInputs((prev) => {
        const without = prev.filter((i) => i.id !== key);
        if (role !== "input" || !candidate.connectableAs) return without;
        return [...without, inputFromCandidate(candidate, candidate.connectableAs, new Set())];
      });
    },
    []
  );

  /**
   * Expose or hide a media loader.
   *
   * Re-enabling one restores the requiredness inspection gave it, rather than
   * defaulting: an App Mode input the author marked essential must stay
   * essential, while a loader that was merely detected stays optional so the
   * workflow still runs on the author's own image.
   */
  const toggleMediaInput = useCallback(
    (candidate: ComfyNodeCandidate, type: ComfyInputType) => {
      if (!inspection) return;
      setInputs((prev) => {
        if (prev.some((i) => i.nodeId === candidate.nodeId)) {
          return prev.filter((i) => i.nodeId !== candidate.nodeId);
        }
        const taken = new Set(prev.map((i) => i.name));
        const restored = inputFromLoader(
          candidate,
          type,
          taken,
          inspection.graph[candidate.nodeId]
        );
        const suggested = inspection.suggested.inputs.find(
          (i) => i.nodeId === candidate.nodeId
        );
        return [...prev, { ...restored, required: suggested?.required ?? false }];
      });
    },
    [inspection]
  );

  const renameInput = useCallback((inputId: string, label: string) => {
    setInputs((prev) => prev.map((i) => (i.id === inputId ? { ...i, label } : i)));
  }, []);

  const renameOutput = useCallback((outputId: string, label: string) => {
    setOutputs((prev) => prev.map((o) => (o.id === outputId ? { ...o, label } : o)));
  }, []);

  const toggleOutput = useCallback(
    (candidateNodeId: string, classType: string, label: string, type: ComfyOutputType) => {
      setOutputs((prev) =>
        prev.some((o) => o.nodeId === candidateNodeId)
          ? prev.filter((o) => o.nodeId !== candidateNodeId)
          : [...prev, { id: candidateNodeId, label, type, nodeId: candidateNodeId, classType }]
      );
    },
    []
  );

  const attach = useCallback(() => {
    if (!inspection) return;
    const params = inspection.widgetCandidates
      .filter((c) => roles[bindingKey(c.nodeId, c.inputKey)] === "setting")
      .map(paramFromCandidate);
    // The candidate list travels back to the node so the picks can be revisited.
    // The graph is dropped (the app already carries it), as are the blueprint
    // listing and the import-time warnings — both describe the upload, not the
    // contract, and replaying "could not reach the engine" weeks later misleads.
    const { graph: _graph, ...snapshot } = inspection;
    onAttach(
      buildComfyApp({
        name,
        source: source === "blueprint" ? "blueprint" : "upload",
        graph: inspection.graph,
        inputs,
        params,
        outputs,
      }),
      { ...snapshot, blueprints: [], warnings: [] }
    );
  }, [inspection, roles, name, source, inputs, outputs, onAttach]);

  if (!isOpen) return null;

  const subtitle = showSettings
    ? "Where your workflows run, and what they run as."
    : inspection || reconfigure
      ? "These become the node's handles and settings."
      : existingName
        ? `Replacing "${existingName}".`
        : null;

  const canAttach = Boolean(inspection && name.trim() && outputs.length > 0);
  const blockingReason = !inspection
    ? null
    : !name.trim()
      ? "Give this node a name"
      : outputs.length === 0
        ? "Choose at least one output"
        : null;
  const showBlueprintAdd =
    !reconfigure && tab === "blueprints" && blueprints !== null && blueprints.length > 0;

  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 animate-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="comfy-import-title"
        tabIndex={-1}
        className="bg-neutral-800 rounded-xl w-[600px] border border-neutral-700 shadow-2xl overflow-clip flex flex-col max-h-[82vh] focus:outline-none animate-dialog-panel"
        onKeyDown={trapFocus}
      >
        <div className="px-4 pt-4 pb-0 shrink-0 animate-dialog-section">
          <div className="flex items-center gap-2">
            <ComfyMark className="w-4 h-[19px] text-neutral-300 shrink-0" />
            <h2 id="comfy-import-title" className="text-xl font-medium text-neutral-100 truncate">
              {showSettings
                ? "ComfyUI connection"
                : reconfigure
                  ? "Inputs, settings and outputs"
                  : inspection
                    ? "Confirm inputs and outputs"
                    : "Add a ComfyUI workflow"}
            </h2>
            <div className="ml-auto shrink-0 flex items-center gap-1 -my-1">
              {inspection?.hasAppMode && !showSettings && (
                <span
                  className="mr-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300/90 border border-emerald-500/25"
                  title="This workflow ships an App Mode configuration — its author's inputs, settings and outputs are already selected."
                >
                  App Mode
                </span>
              )}
              <a
                href={APP_MODE_DOCS}
                target="_blank"
                rel="noreferrer noopener"
                title="How to set a workflow up for this — ComfyUI's App Mode guide"
                aria-label="Read the App Mode guide"
                className="w-10 h-10 flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/50 transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </a>
              <button
                type="button"
                onClick={() => setShowSettings((open) => !open)}
                title="ComfyUI connection — engine, API key"
                aria-label="ComfyUI connection settings"
                aria-pressed={showSettings}
                className={`w-10 h-10 flex items-center justify-center rounded-lg transition-[background-color,color,scale] duration-150 active:scale-[0.96] ${
                  showSettings
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/50"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>
          </div>
          {subtitle && <p className="text-xs text-neutral-500 mt-1">{subtitle}</p>}

          {!inspection && !reconfigure && !showSettings && (
            <div className="flex gap-1.5 p-1 mt-4 bg-neutral-900/50 rounded-lg">
              <TabButton active={tab === "file"} onClick={() => setTab("file")}>
                Workflow file
              </TabButton>
              <TabButton active={tab === "blueprints"} onClick={() => setTab("blueprints")}>
                Blueprints
              </TabButton>
            </div>
          )}
        </div>

        {/* The vertical padding lives on the inner wrapper, not here: a sticky
            heading inside a padded scroller stops at the *content* edge, and
            rows then scroll through the padding band above it in full view. */}
        <div
          className="flex-1 min-h-0 overflow-y-auto px-4 animate-dialog-section"
          style={{ animationDelay: "80ms" }}
        >
          <div className="py-4">
          {showSettings && (
            <ComfySettingsTab settings={settingsDraft} onChange={setSettingsDraft} />
          )}

          {!showSettings && configError && !inspection && (
            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <p className="text-xs text-amber-300">{configError}</p>
            </div>
          )}

          {!showSettings && error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-300 whitespace-pre-wrap">{error}</p>
              {missingNodes.length > 0 && (
                <p className="text-[10px] text-red-400/70 mt-2 font-mono break-words">
                  {missingNodes.join(", ")}
                </p>
              )}
            </div>
          )}

          {!showSettings && reconfigure && !inspection && !error && (
            <div className="py-12 flex flex-col items-center gap-2">
              <div className="w-5 h-5 border-2 border-neutral-600 border-t-blue-500 rounded-full animate-spin" />
              <span className="text-xs text-neutral-500">Reading this workflow…</span>
            </div>
          )}

          {!showSettings && !reconfigure && !inspection && tab === "file" && (
            <FileDropZone
              busy={busy}
              dragOver={dragOver}
              onDragOver={setDragOver}
              onPick={() => fileInputRef.current?.click()}
              onFile={inspectFile}
            />
          )}

          {!showSettings && !reconfigure && !inspection && tab === "blueprints" && (
            <BlueprintPicker
              blueprints={blueprints}
              error={blueprintError}
              selected={blueprintId}
              onSelect={setBlueprintId}
              onRetry={loadBlueprints}
              onAdd={() => void importBlueprint(blueprintId)}
              busy={busy}
            />
          )}

          {!showSettings && inspection && (
            <ConfirmStep
              inspection={inspection}
              name={name}
              onName={setName}
              inputs={inputs}
              outputs={outputs}
              roles={roles}
              onRole={setRole}
              onRenameInput={renameInput}
              onRenameOutput={renameOutput}
              onToggleOutput={toggleOutput}
              onToggleMediaInput={toggleMediaInput}
            />
          )}
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-3 p-4 border-t border-neutral-700/60 shrink-0 animate-dialog-section"
          style={{ animationDelay: "160ms" }}
        >
          <button
            type="button"
            // There is nothing behind the picks when they were opened directly,
            // so "Back" would strand the dialog on an empty file step.
            onClick={
              showSettings
                ? () => setShowSettings(false)
                : inspection && !reconfigure
                  ? reset
                  : onClose
            }
            className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-[color,scale] duration-150 active:scale-[0.96]"
          >
            {showSettings || (inspection && !reconfigure) ? "Back" : "Cancel"}
          </button>
          {/* Why the button is dead, said where the button is — otherwise the
              reason is a section away, under two screens of settings. */}
          {!showSettings && inspection && blockingReason && (
            <span className="text-[11px] text-neutral-500 truncate">{blockingReason}</span>
          )}
          {showSettings ? (
            <button type="button" onClick={saveSettings} className={PRIMARY_BUTTON}>
              Save connection
            </button>
          ) : inspection ? (
            <button type="button" onClick={attach} disabled={!canAttach} className={PRIMARY_BUTTON}>
              {reconfigure ? "Save changes" : "Add to node"}
            </button>
          ) : (
            // The Blueprint list confirms from here too, so the dialog has one
            // place where a choice is committed rather than one per step.
            showBlueprintAdd && (
              <button
                type="button"
                onClick={() => void importBlueprint(blueprintId)}
                disabled={!blueprintId || busy}
                className={PRIMARY_BUTTON}
              >
                {busy ? "Reading…" : "Add"}
              </button>
            )
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void inspectFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );

  // Portalled to the body: this dialog is rendered from inside a node, and
  // React Flow's viewport carries a `transform`, which makes it the containing
  // block for `position: fixed` — so without this the dialog is scaled and
  // shifted by the canvas zoom.
  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-[background-color,color,scale] duration-150 active:scale-[0.96] ${
        active
          ? "bg-neutral-700 text-neutral-100 font-medium"
          : "text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/50"
      }`}
    >
      {children}
    </button>
  );
}

function FileDropZone({
  busy,
  dragOver,
  onDragOver,
  onPick,
  onFile,
}: {
  busy: boolean;
  dragOver: boolean;
  onDragOver: (over: boolean) => void;
  onPick: () => void;
  onFile: (file: File) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(true);
      }}
      onDragLeave={() => onDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      onClick={onPick}
      className={`flex flex-col items-center justify-center gap-3 py-12 rounded-xl border border-dashed cursor-pointer transition-colors ${
        dragOver
          ? "border-blue-500 bg-blue-500/5"
          : "border-neutral-600 hover:border-neutral-500 bg-neutral-900/40"
      }`}
    >
      {busy ? (
        <>
          <div className="w-5 h-5 border-2 border-neutral-600 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-xs text-neutral-400">Reading workflow…</span>
        </>
      ) : (
        <>
          <svg
            className="w-8 h-8 text-neutral-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5-5 5 5" />
            <path d="M12 5v12" />
          </svg>
          <div className="text-center">
            <p className="text-sm text-neutral-300">Drop a workflow JSON here</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Saved or API-format exports both work
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Pick one Blueprint out of the engine's catalog.
 *
 * A catalog is long — Comfy Cloud ships around ninety — and every entry is the
 * same kind of thing, so they share one list rather than each getting a card
 * and a button of its own. Picking only highlights a row; nothing is fetched
 * until Add (or a double-click) confirms it.
 */
function BlueprintPicker({
  blueprints,
  error,
  selected,
  onSelect,
  onRetry,
  onAdd,
  busy,
}: {
  blueprints: BlueprintListItem[] | null;
  error: string | null;
  selected: string;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onAdd: () => void;
  busy: boolean;
}) {
  const [filter, setFilter] = useState("");

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-neutral-400 mb-3">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-2 text-xs rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-100 transition-[background-color,scale] duration-150 active:scale-[0.96]"
        >
          Try again
        </button>
      </div>
    );
  }

  if (blueprints === null) {
    return (
      <div className="py-12 flex flex-col items-center gap-2">
        <div className="w-5 h-5 border-2 border-neutral-600 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-xs text-neutral-500">Loading Blueprints…</span>
      </div>
    );
  }

  if (blueprints.length === 0) {
    return (
      <p className="text-xs text-neutral-500 py-8 text-center">
        This ComfyUI has no Blueprints installed.
      </p>
    );
  }

  const term = filter.trim().toLowerCase();
  const visible = term
    ? blueprints.filter((b) => b.name.toLowerCase().includes(term))
    : blueprints;

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 overflow-hidden">
      {/* Header row: the list is long enough that scanning it is the slow way
          to a known name. */}
      <div className="flex items-center gap-2 px-3 border-b border-neutral-800">
        <svg
          className="w-3.5 h-3.5 shrink-0 text-neutral-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search Blueprints…"
          aria-label="Search Blueprints"
          className="w-full bg-transparent py-2.5 text-sm text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
        />
      </div>
      <div
        role="listbox"
        aria-label="Blueprints"
        className="divide-y divide-neutral-800/80 max-h-[280px] overflow-y-auto"
      >
        {visible.map((blueprint) => {
          const isSelected = blueprint.id === selected;
          return (
            <button
              key={blueprint.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={busy}
              onClick={() => onSelect(blueprint.id)}
              onDoubleClick={onAdd}
              className={`w-full text-left px-3 py-3 text-sm truncate transition-[background-color,color,scale] duration-150 active:scale-[0.99] disabled:cursor-not-allowed ${
                isSelected
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
              }`}
            >
              {blueprint.name}
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="px-3 py-6 text-xs text-neutral-600 text-center">
            No Blueprints match that search.
          </p>
        )}
      </div>
    </div>
  );
}

function ConfirmStep({
  inspection,
  name,
  onName,
  inputs,
  outputs,
  roles,
  onRole,
  onRenameInput,
  onRenameOutput,
  onToggleOutput,
  onToggleMediaInput,
}: {
  inspection: Inspection;
  name: string;
  onName: (value: string) => void;
  inputs: ComfyAppInput[];
  outputs: ComfyAppOutput[];
  roles: Record<string, WidgetRole>;
  onRole: (candidate: ComfyWidgetCandidate, role: WidgetRole) => void;
  onRenameInput: (id: string, label: string) => void;
  onRenameOutput: (id: string, label: string) => void;
  onToggleOutput: (
    nodeId: string,
    classType: string,
    label: string,
    type: ComfyOutputType
  ) => void;
  onToggleMediaInput: (candidate: ComfyNodeCandidate, type: ComfyInputType) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [widgetFilter, setWidgetFilter] = useState("");

  /**
   * The widgets worth showing without being asked for.
   *
   * A workflow of any size offers dozens — a Cloud Blueprint typically ~30,
   * mostly loader plumbing (which checkpoint, which dtype, which device) that
   * no node should expose. The ones its author curated, plus whatever is
   * already exposed, are the short list; the rest waits behind a disclosure.
   */
  const [featured, rest] = useMemo(() => {
    const isFeatured = (c: ComfyWidgetCandidate) =>
      c.fromAppMode || (roles[bindingKey(c.nodeId, c.inputKey)] ?? "off") !== "off";
    return [
      inspection.widgetCandidates.filter(isFeatured),
      inspection.widgetCandidates.filter((c) => !isFeatured(c)),
    ];
    // Deliberately not reacting to `roles`: a widget must not leap between
    // lists as it is ticked, which would move the row out from under the
    // pointer mid-click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection.widgetCandidates]);

  /** The hidden remainder, grouped by the node it belongs to. */
  const groups = useMemo(() => {
    const term = widgetFilter.trim().toLowerCase();
    const matching = term
      ? rest.filter((c) => c.label.toLowerCase().includes(term))
      : rest;
    const byNode = new Map<string, { classType: string; items: ComfyWidgetCandidate[] }>();
    for (const candidate of matching) {
      const group = byNode.get(candidate.nodeId) ?? { classType: candidate.classType, items: [] };
      group.items.push(candidate);
      byNode.set(candidate.nodeId, group);
    }
    return [...byNode.entries()];
  }, [rest, widgetFilter]);

  const exposedCount = inspection.widgetCandidates.filter(
    (c) => (roles[bindingKey(c.nodeId, c.inputKey)] ?? "off") !== "off"
  ).length;

  // Every loader in the graph, selected or not — a workflow can carry several
  // and only some are meant to be wired from the canvas.
  const mediaCandidates = useMemo(
    () =>
      [...inspection.imageInputCandidates, ...inspection.mediaInputCandidates].map(
        (candidate) => ({
          candidate,
          type: loaderInputType(candidate.classType) ?? ("image" as ComfyInputType),
        })
      ),
    [inspection.imageInputCandidates, inspection.mediaInputCandidates]
  );

  // Text inputs are promoted widgets, so the Settings list below owns their
  // on/off state; here they only get renamed.
  const textInputs = inputs.filter((i) => i.type === "text");

  return (
    <div className="space-y-5">
      {inspection.warnings.map((warning) => (
        <div key={warning} className="p-3 rounded-lg bg-neutral-900 border border-neutral-700">
          <p className="text-xs text-neutral-400">{warning}</p>
        </div>
      ))}

      <div>
        <label className="block text-sm text-neutral-400 mb-1">Node name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => onName(e.target.value)}
          className="w-full px-3 py-2 bg-neutral-900 border border-neutral-600 rounded-lg text-neutral-100 text-sm focus:outline-none focus:border-neutral-500"
        />
        <p className="text-[10px] text-neutral-600 mt-1">
          {inspection.nodeCount} nodes · {inspection.classTypes.length} node types
        </p>
      </div>

      <Section
        title="Inputs"
        hint="Connected from other nodes."
        count={`${inputs.length} of ${mediaCandidates.length + textInputs.length} exposed`}
        empty="Nothing in this workflow accepts an incoming connection."
        isEmpty={mediaCandidates.length === 0 && textInputs.length === 0}
      >
        <ListBox>
          {mediaCandidates.map(({ candidate, type }) => {
            const bound = inputs.find((i) => i.nodeId === candidate.nodeId);
            return (
              <BindingRow
                key={candidate.nodeId}
                type={type}
                typeLabel={INPUT_TYPE_LABEL[type]}
                nodeId={candidate.nodeId}
                name={bound?.label ?? candidate.label}
                bound={Boolean(bound)}
                onRename={(value) => bound && onRenameInput(bound.id, value)}
                onToggle={() => onToggleMediaInput(candidate, type)}
                onLabel="Input"
                onTitle="A handle other nodes connect to"
                offTitle="Hidden — the workflow keeps its own file"
              />
            );
          })}
          {textInputs.map((input) => (
            <BindingRow
              key={input.id}
              type={input.type}
              typeLabel={INPUT_TYPE_LABEL[input.type]}
              nodeId={input.nodeId}
              name={input.label}
              bound
              onRename={(value) => onRenameInput(input.id, value)}
              onLabel="Input"
              onTitle="A handle other nodes connect to"
              offTitle=""
            />
          ))}
        </ListBox>
      </Section>

      <Section
        title="Settings"
        hint="Adjustable on the node itself."
        count={`${exposedCount} of ${inspection.widgetCandidates.length} exposed`}
        empty="This workflow has no adjustable widgets."
        isEmpty={inspection.widgetCandidates.length === 0}
      >
        {featured.length > 0 ? (
          <ListBox>
            {featured.map((candidate) => (
              <SettingRow
                key={bindingKey(candidate.nodeId, candidate.inputKey)}
                candidate={candidate}
                label={candidate.label}
                role={roles[bindingKey(candidate.nodeId, candidate.inputKey)] ?? "off"}
                onRole={onRole}
              />
            ))}
          </ListBox>
        ) : (
          !showAll && (
            <p className="text-xs text-neutral-600">
              This workflow&apos;s author exposed none of its widgets.
            </p>
          )
        )}

        {rest.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowAll((open) => !open)}
              aria-expanded={showAll}
              className="flex items-center gap-1.5 min-h-10 text-xs text-neutral-400 hover:text-neutral-200 transition-[color,scale] duration-150 active:scale-[0.96]"
            >
              <svg
                className={`w-3 h-3 transition-transform duration-150 ${showAll ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
              {showAll ? "Hide" : `Show ${rest.length} more`} widget{rest.length === 1 ? "" : "s"}
            </button>

            {showAll && (
              <div className="mt-1 rounded-lg border border-neutral-700/60 bg-neutral-900 overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 border-b border-neutral-800">
                  <svg
                    className="w-3.5 h-3.5 shrink-0 text-neutral-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="text"
                    value={widgetFilter}
                    onChange={(e) => setWidgetFilter(e.target.value)}
                    placeholder="Search widgets…"
                    aria-label="Search widgets"
                    className="w-full bg-transparent py-2.5 text-xs text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
                  />
                </div>
                {/* Bounded: thirty rows would push the Outputs section — and the
                    reason Save is disabled — back off the bottom of the dialog. */}
                <div className="max-h-[300px] overflow-y-auto">
                  {groups.length === 0 ? (
                    <p className="px-2.5 py-4 text-xs text-neutral-600">
                      No widgets match that search.
                    </p>
                  ) : (
                    // Grouped by node: the class name is the same on every row of a
                    // group, so saying it once leaves the widget's own name to read.
                    groups.map(([nodeId, group]) => (
                      <div key={nodeId}>
                        {/* A band, not a row: the node a widget belongs to is a
                            heading over the list, and at row weight the two
                            were being read as the same kind of thing. */}
                        <div className="flex items-baseline gap-2 px-2.5 py-1 bg-neutral-950/80 border-y border-neutral-800">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            {group.classType}
                          </span>
                          <span className="text-[10px] text-neutral-700 font-mono">#{nodeId}</span>
                        </div>
                        {group.items.map((candidate) => (
                          <SettingRow
                            key={bindingKey(candidate.nodeId, candidate.inputKey)}
                            candidate={candidate}
                            label={widgetName(candidate)}
                            role={roles[bindingKey(candidate.nodeId, candidate.inputKey)] ?? "off"}
                            onRole={onRole}
                            indented
                          />
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Outputs"
        hint="Produced results, connected onward."
        count={`${outputs.length} of ${inspection.outputCandidates.length} exposed`}
        empty="This workflow has no Save or Preview node."
        isEmpty={inspection.outputCandidates.length === 0}
      >
        <ListBox>
          {inspection.outputCandidates.map((candidate) => {
            const bound = outputs.find((o) => o.nodeId === candidate.nodeId);
            const type = outputTypeOf(inspection, candidate.nodeId);
            return (
              <BindingRow
                key={candidate.nodeId}
                type={type}
                typeLabel={OUTPUT_TYPE_LABEL[type]}
                nodeId={candidate.nodeId}
                name={bound?.label ?? candidate.label}
                bound={Boolean(bound)}
                onRename={(value) => onRenameOutput(candidate.nodeId, value)}
                onToggle={() =>
                  onToggleOutput(candidate.nodeId, candidate.classType, candidate.label, type)
                }
                onLabel="Output"
                onTitle="A handle downstream nodes read from"
                offTitle="Hidden — this result is discarded"
              />
            );
          })}
        </ListBox>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  count,
  empty,
  isEmpty,
  children,
}: {
  title: string;
  hint: string;
  /** State of the section, readable without scrolling it. */
  count?: string;
  empty: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* Sticky, and bled to the dialog's edges so rows pass behind it rather
          than beside it — three sections deep, the heading is the only thing
          saying which list you are in. */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-neutral-800 flex items-baseline gap-2">
        <h3 className="text-sm text-neutral-200 font-medium shrink-0">{title}</h3>
        <span className="text-[10px] text-neutral-600 truncate">{hint}</span>
        {count && !isEmpty && (
          <span className="ml-auto shrink-0 text-[10px] text-neutral-500 tabular-nums">{count}</span>
        )}
      </div>
      {isEmpty ? (
        <p className="text-xs text-neutral-600 py-2">{empty}</p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  );
}

/** `KSampler · Seed` → `Seed`, for rows already sitting under their node. */
function widgetName(candidate: ComfyWidgetCandidate): string {
  const tail = candidate.label.split("·").pop()?.trim();
  return tail && tail.length > 0 ? tail : candidate.label;
}

/** The recessed surface a list of rows sits on. */
function ListBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-700/60 bg-neutral-900 overflow-hidden divide-y divide-neutral-800/60">
      {children}
    </div>
  );
}

/**
 * What a row becomes, chosen from named states rather than ticked.
 *
 * Each option says what the row *is* when it wins — Setting, Input, Output —
 * so the row's state is legible without cross-referencing a checkbox against
 * the section it sits in.
 */
function ChoiceToggle({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; title: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-0.5 p-0.5 bg-neutral-950/60 rounded-md shrink-0">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-2.5 py-1.5 text-[10px] font-medium rounded transition-[background-color,color,scale] duration-150 active:scale-[0.96] ${
            value === option.value
              ? "bg-neutral-700 text-neutral-100"
              : "text-neutral-500 hover:text-neutral-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A loader or a sink: a handle on the node, or left to the workflow's own file.
 *
 * The name is editable in place, but only once the row is on — a field that
 * renames something the node will not have is a place to waste a keystroke.
 */
function BindingRow({
  type,
  typeLabel,
  nodeId,
  name,
  bound,
  onRename,
  onToggle,
  onLabel,
  onTitle,
  offTitle,
}: {
  type: string;
  typeLabel: string;
  nodeId: string;
  name: string;
  bound: boolean;
  onRename: (value: string) => void;
  /** Absent for rows that cannot be turned off, such as a promoted widget. */
  onToggle?: () => void;
  onLabel: string;
  onTitle: string;
  offTitle: string;
}) {
  return (
    <div className="flex items-center gap-2 min-h-11 px-2.5 hover:bg-neutral-800/40 transition-colors">
      <TypePill color={handleColor(type)}>{typeLabel}</TypePill>
      <input
        type="text"
        value={name}
        disabled={!bound}
        onChange={(e) => onRename(e.target.value)}
        className="flex-1 min-w-0 px-2 py-1.5 bg-transparent border border-transparent rounded-md text-neutral-100 text-xs hover:border-neutral-700 focus:border-neutral-600 focus:bg-neutral-950/40 focus:outline-none disabled:text-neutral-500 disabled:hover:border-transparent"
      />
      <span className="text-[10px] text-neutral-600 shrink-0 font-mono">#{nodeId}</span>
      {onToggle && (
        <ChoiceToggle
          value={bound ? "on" : "off"}
          onChange={(next) => {
            if ((next === "on") !== bound) onToggle();
          }}
          options={[
            { value: "off", label: "Hide", title: offTitle },
            { value: "on", label: onLabel, title: onTitle },
          ]}
        />
      )}
    </div>
  );
}

/**
 * One widget, exposed or not.
 *
 * The whole row is the target: a checkbox alone is 14px of hittable area in a
 * list dozens long. Connectable widgets get a second choice — inline setting or
 * a handle — but only once exposed, and only where it is possible at all, which
 * in a typical workflow is one row in thirty.
 */
function SettingRow({
  candidate,
  label,
  role,
  onRole,
  indented = false,
}: {
  candidate: ComfyWidgetCandidate;
  label: string;
  role: WidgetRole;
  onRole: (candidate: ComfyWidgetCandidate, role: WidgetRole) => void;
  /** Set under a node heading, so the rows read as that node's. */
  indented?: boolean;
}) {
  const exposed = role !== "off";
  return (
    <div
      className={`flex items-center gap-2 min-h-11 pr-2.5 hover:bg-neutral-800/40 transition-colors ${
        indented ? "pl-5 border-b border-neutral-800/50 last:border-b-0" : "pl-2.5"
      }`}
    >
      <span
        className={`flex-1 min-w-0 text-xs truncate ${exposed ? "text-neutral-100" : "text-neutral-400"}`}
        title={`${candidate.label} — currently ${describeValue(candidate.currentValue)}`}
      >
        {label}
      </span>
      {candidate.fromAppMode && (
        <span
          className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400/70"
          title="Chosen by this workflow's author"
        />
      )}
      <ChoiceToggle
        value={role}
        onChange={(next) => onRole(candidate, next as WidgetRole)}
        options={[
          { value: "off", label: "Hide", title: "Keep the workflow's saved value" },
          { value: "setting", label: "Setting", title: "Adjustable on the node itself" },
          // Only some widgets can be driven by a wire — a model filename cannot.
          ...(candidate.connectableAs
            ? [
                {
                  value: "input",
                  label: "Input",
                  title: "A handle other nodes connect to",
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

function TypePill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide"
      style={{ color, backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)` }}
    >
      {children}
    </span>
  );
}

/** A widget's current value, short enough for a tooltip. */
function describeValue(value: ComfyWidgetCandidate["currentValue"]): string {
  // A curve is a nest of coordinates; its point count is the useful summary.
  if (value && typeof value === "object") {
    return "points" in value ? `a curve of ${value.points.length} points` : "a structured value";
  }
  return String(value);
}

function handleColor(type: string): string {
  if (type === "text") return "var(--handle-color-text)";
  if (type === "audio") return "var(--handle-color-audio)";
  if (type === "video") return "var(--handle-color-video)";
  if (type === "3d") return "var(--handle-color-3d)";
  return "var(--handle-color-image)";
}

/** The handle type inspection assigned to a sink node. */
function outputTypeOf(inspection: Inspection, nodeId: string): ComfyOutputType {
  const suggested = inspection.suggested.outputs.find((o) => o.nodeId === nodeId);
  return suggested?.type ?? "image";
}

