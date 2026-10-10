"use client";

import React, { useCallback, useMemo } from "react";
import { Dices, Lock, Minus, Plus, type LucideIcon } from "lucide-react";

import { ComfyCurveEditor } from "./ComfyCurveEditor";
import { DEFAULT_SEED_MODE } from "@/lib/comfy/seeds";
import type { ComfyAppParam, ComfySeedMode } from "@/lib/comfy/types";
import { Dropdown, type DropdownOption } from "./ui/Dropdown";
import { CheckboxField, FieldList, FieldRow, NumberField, SelectField, TextField, TextareaField } from "./ui/Field";

interface ComfyAppParametersProps {
  params: ComfyAppParam[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** What each seed does after a run, by param id; absent is random. */
  seedModes?: Readonly<Record<string, ComfySeedMode>>;
  onSeedModeChange: (paramId: string, mode: ComfySeedMode) => void;
}

/**
 * `Sampler Steps` from `KSampler · sampler_steps`.
 *
 * The node name is noise for an ordinary widget — every setting on a KSampler
 * would repeat it. For a curve it is the opposite: `Red · Curve` and
 * `Green · Curve` are told apart by exactly the part being dropped, so those
 * keep their full label.
 */
function shortLabel(param: ComfyAppParam): string {
  if (param.type === "curve") return param.label;
  const tail = param.label.split("·").pop()?.trim();
  return tail && tail.length > 0 ? tail : param.label;
}

/**
 * Inline controls for a Comfy app's exposed widgets.
 *
 * These come from the workflow itself — App Mode selections when the author
 * curated them, otherwise the widgets the user opted into at import — so the
 * shape is only known at run time. Rendering mirrors {@link ModelParameters}
 * so a Comfy node's settings look like every other generation node's.
 */
function ComfyAppParametersInner({ params, values, onChange, seedModes, onSeedModeChange }: ComfyAppParametersProps) {
  const handleChange = useCallback(
    (id: string, value: unknown) => {
      const next = { ...values };
      if (value === "" || value === undefined || value === null) delete next[id];
      else next[id] = value;
      onChange(next);
    },
    [values, onChange]
  );

  // Dropdowns first, then numbers, strings, and checkboxes last — the same
  // ordering the model parameter panel uses, so the two read alike.
  const sorted = useMemo(() => {
    const weight = (param: ComfyAppParam): number => {
      if (param.enum && param.enum.length > 0) return 0;
      if (param.type === "number" || param.type === "integer") return 1;
      if (param.type === "boolean") return 3;
      return 2;
    };
    return [...params].sort((a, b) => weight(a) - weight(b));
  }, [params]);

  if (params.length === 0) {
    return <span className="text-[9px] text-neutral-500">This workflow exposes no settings</span>;
  }

  return (
    <FieldList className="shrink-0">
      {sorted.map((param) => (
        <ComfyParameterInput
          key={param.id}
          param={param}
          value={values[param.id]}
          onChange={handleChange}
          {...(param.isSeed ? { seedMode: seedModes?.[param.id] ?? DEFAULT_SEED_MODE, onSeedModeChange } : {})}
        />
      ))}
    </FieldList>
  );
}

interface ComfyParameterInputProps {
  param: ComfyAppParam;
  value: unknown;
  onChange: (id: string, value: unknown) => void;
  seedMode?: ComfySeedMode;
  onSeedModeChange?: (paramId: string, mode: ComfySeedMode) => void;
}

/** One widget control, as the field its type calls for. */
function ComfyParameterInputInner({ param, value, onChange, seedMode, onSeedModeChange }: ComfyParameterInputProps) {
  const label = shortLabel(param);
  const description = param.description;

  if (param.type === "curve") {
    return (
      <FieldRow className="h-auto">
        <div className="w-full">
          <ComfyCurveEditor
            label={label}
            value={value ?? param.default}
            onChange={(curve) => onChange(param.id, curve)}
            {...(description ? { description } : {})}
          />
        </div>
      </FieldRow>
    );
  }

  if (param.enum && param.enum.length > 0) {
    return (
      <SelectField
        label={label}
        hint={description}
        value={value === undefined || value === null ? "" : String(value)}
        options={param.enum}
        emptyLabel={param.default !== undefined ? `Default (${String(param.default)})` : "Default"}
        onChange={(val) => onChange(param.id, val || undefined)}
      />
    );
  }

  if (param.type === "boolean") {
    const checked = value !== undefined ? Boolean(value) : Boolean(param.default);
    return <CheckboxField label={label} hint={description} checked={checked} onChange={(next) => onChange(param.id, next)} />;
  }

  if (param.multiline) {
    return (
      <TextareaField
        label={label}
        hint={description}
        value={value === undefined || value === null ? "" : String(value)}
        placeholder={param.default !== undefined ? String(param.default) : undefined}
        onChange={(text) => onChange(param.id, text)}
      />
    );
  }

  const isNumber = param.type === "number" || param.type === "integer";
  const seedControl =
    param.isSeed && seedMode && onSeedModeChange ? (
      <SeedModeMenu mode={seedMode} onChange={(mode) => onSeedModeChange(param.id, mode)} />
    ) : undefined;

  if (isNumber) {
    return (
      <NumberField
        label={label}
        hint={description}
        value={typeof value === "number" ? value : value === undefined || value === null ? undefined : Number(value)}
        min={param.minimum}
        max={param.maximum}
        integer={param.type === "integer"}
        placeholder={param.default !== undefined ? String(param.default) : undefined}
        onChange={(next) => onChange(param.id, next)}
        trailing={seedControl}
      />
    );
  }

  return (
    <TextField
      label={label}
      hint={description}
      value={value === undefined || value === null ? "" : String(value)}
      placeholder={param.default !== undefined ? String(param.default) : undefined}
      onChange={(text) => onChange(param.id, text)}
      trailing={seedControl}
    />
  );
}

const SEED_MODES: Record<ComfySeedMode, { label: string; icon: LucideIcon; meta?: string }> = {
  random: { label: "Random", icon: Dices },
  fixed: { label: "Fixed", icon: Lock },
  increment: { label: "Increment", icon: Plus, meta: "+1" },
  decrement: { label: "Decrement", icon: Minus, meta: "−1" },
};

const SEED_MODE_OPTIONS: DropdownOption[] = (Object.keys(SEED_MODES) as ComfySeedMode[]).map((mode) => {
  const { label, icon: Icon, meta } = SEED_MODES[mode];
  return { value: mode, label, meta, group: "After each run", icon: <Icon size={11} strokeWidth={1.75} /> };
});

/**
 * What a seed does after each run, as ComfyUI's "control after generate":
 * the button beside the seed shows the mode, its menu changes it.
 */
function SeedModeMenu({ mode, onChange }: { mode: ComfySeedMode; onChange: (mode: ComfySeedMode) => void }) {
  const { label, icon: Icon } = SEED_MODES[mode];
  return (
    <Dropdown
      value={mode}
      options={SEED_MODE_OPTIONS}
      onChange={(value) => onChange(value as ComfySeedMode)}
      className="shrink-0"
      triggerClassName="nodrag nopan w-[22px] h-[22px] flex items-center justify-center rounded-well squircle text-neutral-500 hover:text-neutral-200 hover:bg-white/5 transition-colors"
      trigger={<Icon size={12} strokeWidth={2} />}
      align="end"
      aria-label={`After each run: ${label}`}
    />
  );
}

const ComfyParameterInput = React.memo(ComfyParameterInputInner);
export const ComfyAppParameters = React.memo(ComfyAppParametersInner);
