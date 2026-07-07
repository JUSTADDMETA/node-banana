"use client";

/**
 * Catalog of node types available inside the split-grid cell template editor.
 * Handle definitions mirror getNodeHandles() in WorkflowCanvas so template
 * edges instantiate cleanly onto the main canvas.
 */

import type { ReactNode } from "react";
import type { NodeType } from "@/types";
import { ALL_NODE_OPTIONS } from "../ConnectionDropMenu";

export type TemplateHandleKind = "image" | "text";

export interface TemplateHandleDef {
  id: TemplateHandleKind;
  label: string;
}

export interface TemplateCatalogEntry {
  type: NodeType;
  label: string;
  description: string;
  inputs: TemplateHandleDef[];
  outputs: TemplateHandleDef[];
}

const IMAGE_IN: TemplateHandleDef = { id: "image", label: "Image" };
const IMAGE_OUT: TemplateHandleDef = { id: "image", label: "Image" };
const TEXT_IN: TemplateHandleDef = { id: "text", label: "Text" };
const TEXT_OUT: TemplateHandleDef = { id: "text", label: "Text" };

/** The base image node present in every template (not user-addable) */
export const TEMPLATE_BASE_ENTRY: TemplateCatalogEntry = {
  type: "imageInput",
  label: "Cell Image",
  description: "Receives one split image per cell",
  inputs: [],
  outputs: [IMAGE_OUT],
};

/** Node types users can add to a cell template */
export const TEMPLATE_NODE_CATALOG: TemplateCatalogEntry[] = [
  {
    type: "prompt",
    label: "Prompt",
    description: "Text prompt for this cell",
    inputs: [],
    outputs: [TEXT_OUT],
  },
  {
    type: "nanoBanana",
    label: "Generate Image",
    description: "AI image generation",
    inputs: [IMAGE_IN, TEXT_IN],
    outputs: [IMAGE_OUT],
  },
  {
    type: "llmGenerate",
    label: "LLM Generate",
    description: "AI text generation",
    inputs: [TEXT_IN, IMAGE_IN],
    outputs: [TEXT_OUT],
  },
  {
    type: "annotation",
    label: "Annotate",
    description: "Draw on the cell image",
    inputs: [IMAGE_IN],
    outputs: [IMAGE_OUT],
  },
  {
    type: "removeBackground",
    label: "Remove Background",
    description: "Strip the cell image background",
    inputs: [IMAGE_IN],
    outputs: [IMAGE_OUT],
  },
  {
    type: "imageResize",
    label: "Resize Image",
    description: "Resize / re-encode the cell image",
    inputs: [IMAGE_IN],
    outputs: [IMAGE_OUT],
  },
  {
    type: "output",
    label: "Output",
    description: "Display the cell result",
    inputs: [IMAGE_IN],
    outputs: [],
  },
  {
    type: "outputGallery",
    label: "Output Gallery",
    description: "Collect cell results",
    inputs: [IMAGE_IN],
    outputs: [],
  },
];

export function getTemplateEntry(type: NodeType): TemplateCatalogEntry {
  if (type === TEMPLATE_BASE_ENTRY.type) return TEMPLATE_BASE_ENTRY;
  return (
    TEMPLATE_NODE_CATALOG.find((entry) => entry.type === type) ?? {
      type,
      label: type,
      description: "",
      inputs: [],
      outputs: [],
    }
  );
}

/** Reuse the canvas menus' icons so the editor matches the rest of the app */
export function getTemplateNodeIcon(type: NodeType): ReactNode {
  return ALL_NODE_OPTIONS.find((option) => option.type === type)?.icon ?? null;
}
