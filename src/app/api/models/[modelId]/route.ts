/**
 * Model Schema API Endpoint
 *
 * Fetches parameter schema for a specific model from its provider.
 * Returns simplified parameter list for UI rendering.
 *
 * GET /api/models/:modelId?provider=replicate|fal
 *
 * Headers:
 *   - X-Replicate-Key: Required for Replicate models
 *   - X-Fal-Key: Optional for fal.ai models
 *
 * Response:
 *   {
 *     success: true,
 *     parameters: ModelParameter[],
 *     cached: boolean
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { ProviderType } from "@/types";
import { ModelParameter, ModelInput } from "@/lib/providers/types";

// Cache for model schemas (10 minute TTL)
const schemaCache = new Map<string, { parameters: ModelParameter[]; inputs: ModelInput[]; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Image input property patterns
const IMAGE_INPUT_PATTERNS = [
  "image_url",
  "image_urls",
  "image",
  "first_frame",
  "last_frame",
  "tail_image_url",
  "start_image",
  "end_image",
  "reference_image",
  "init_image",
  "mask_image",
  "control_image",
];

// Text input properties
const TEXT_INPUT_NAMES = ["prompt", "negative_prompt"];

// Parameters to filter out (internal/system params)
const EXCLUDED_PARAMS = new Set([
  "webhook",
  "webhook_events_filter",
  "sync_mode",
  "disable_safety_checker",
  "go_fast",
  "enable_safety_checker",
  "output_format",
  "output_quality",
  "request_id",
]);

// Parameters we want to surface (user-relevant)
const PRIORITY_PARAMS = new Set([
  "seed",
  "num_inference_steps",
  "inference_steps",
  "steps",
  "guidance_scale",
  "guidance",
  "negative_prompt",
  "width",
  "height",
  "num_outputs",
  "num_images",
  "scheduler",
  "strength",
  "cfg_scale",
  "lora_scale",
]);

interface SchemaSuccessResponse {
  success: true;
  parameters: ModelParameter[];
  inputs: ModelInput[];
  cached: boolean;
}

interface SchemaErrorResponse {
  success: false;
  error: string;
}

type SchemaResponse = SchemaSuccessResponse | SchemaErrorResponse;

/**
 * Convert property name to human-readable label
 */
function toLabel(name: string): string {
  return name
    .replace(/_url$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Check if property is an image input
 */
function isImageInput(name: string): boolean {
  // Check explicit patterns first
  if (IMAGE_INPUT_PATTERNS.includes(name)) {
    return true;
  }

  // Check for "image" as a word boundary:
  // - ends with _image (e.g., start_image, control_image)
  // - starts with image_ (e.g., image_url, image_urls)
  // - contains _image_ (e.g., tail_image_url)
  // But NOT num_images (no underscore before "image")
  return name.endsWith("_image") ||
         name.startsWith("image_") ||
         name.includes("_image_");
}

/**
 * Check if property is a text input
 */
function isTextInput(name: string): boolean {
  return TEXT_INPUT_NAMES.includes(name);
}

/**
 * Resolve a $ref reference in OpenAPI schema
 * E.g., "#/components/schemas/AspectRatio" -> schema object
 */
function resolveRef(
  ref: string,
  schemaComponents: Record<string, unknown>
): Record<string, unknown> | null {
  // Parse reference path like "#/components/schemas/AspectRatio"
  const match = ref.match(/^#\/components\/schemas\/(.+)$/);
  if (!match) return null;

  const schemaName = match[1];
  const resolved = schemaComponents[schemaName] as Record<string, unknown> | undefined;
  return resolved || null;
}

/**
 * Convert OpenAPI schema property to ModelParameter
 */
function convertSchemaProperty(
  name: string,
  prop: Record<string, unknown>,
  required: string[],
  schemaComponents?: Record<string, unknown>
): ModelParameter | null {
  // Skip excluded parameters
  if (EXCLUDED_PARAMS.has(name)) {
    return null;
  }

  // Determine type and extract enum from allOf/$ref if present
  let type: ModelParameter["type"] = "string";
  let enumValues: unknown[] | undefined;
  let resolvedDefault: unknown;
  let resolvedDescription: string | undefined;

  const schemaType = prop.type as string | undefined;
  const allOf = prop.allOf as Array<Record<string, unknown>> | undefined;

  if (schemaType === "integer") {
    type = "integer";
  } else if (schemaType === "number") {
    type = "number";
  } else if (schemaType === "boolean") {
    type = "boolean";
  } else if (schemaType === "array") {
    type = "array";
  } else if (allOf && allOf.length > 0 && schemaComponents) {
    // Handle allOf with $ref - resolve references and extract enum/type
    for (const item of allOf) {
      const itemRef = item.$ref as string | undefined;
      if (itemRef) {
        const resolved = resolveRef(itemRef, schemaComponents);
        if (resolved) {
          // Extract type from resolved schema
          if (resolved.type === "integer") type = "integer";
          else if (resolved.type === "number") type = "number";
          else if (resolved.type === "boolean") type = "boolean";

          // Extract enum from resolved schema
          if (Array.isArray(resolved.enum)) {
            enumValues = resolved.enum;
          }
          // Extract default from resolved schema
          if (resolved.default !== undefined && resolvedDefault === undefined) {
            resolvedDefault = resolved.default;
          }
          // Extract description from resolved schema
          if (resolved.description && !resolvedDescription) {
            resolvedDescription = resolved.description as string;
          }
        }
      } else if (Array.isArray(item.enum)) {
        // Direct enum in allOf item
        enumValues = item.enum;
      }
    }
  }

  const parameter: ModelParameter = {
    name,
    type,
    description: (prop.description as string | undefined) || resolvedDescription,
    default: prop.default !== undefined ? prop.default : resolvedDefault,
    required: required.includes(name),
  };

  // Add constraints
  if (typeof prop.minimum === "number") {
    parameter.minimum = prop.minimum;
  }
  if (typeof prop.maximum === "number") {
    parameter.maximum = prop.maximum;
  }

  // Use enum from property directly, or from resolved $ref
  if (Array.isArray(prop.enum)) {
    parameter.enum = prop.enum;
  } else if (enumValues) {
    parameter.enum = enumValues;
  }

  return parameter;
}

interface ExtractedSchema {
  parameters: ModelParameter[];
  inputs: ModelInput[];
}

/**
 * Fetch and parse schema from Replicate
 */
async function fetchReplicateSchema(
  modelId: string,
  apiKey: string
): Promise<ExtractedSchema> {
  const [owner, name] = modelId.split("/");

  const response = await fetch(
    `https://api.replicate.com/v1/models/${owner}/${name}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Replicate API error: ${response.status}`);
  }

  const data = await response.json();

  // Extract schema from latest_version.openapi_schema
  const openApiSchema = data.latest_version?.openapi_schema;
  if (!openApiSchema) {
    return { parameters: [], inputs: [] };
  }

  // Navigate to Input schema
  const inputSchema = openApiSchema.components?.schemas?.Input;
  if (!inputSchema || typeof inputSchema !== "object") {
    return { parameters: [], inputs: [] };
  }

  // Pass components.schemas for $ref resolution
  const schemaComponents = openApiSchema.components?.schemas as Record<string, unknown> | undefined;
  return extractParametersFromSchema(inputSchema as Record<string, unknown>, schemaComponents);
}

/**
 * Fetch and parse schema from fal.ai using Model Search API
 * Uses: GET https://api.fal.ai/v1/models?endpoint_id={modelId}&expand=openapi-3.0
 */
async function fetchFalSchema(
  modelId: string,
  apiKey: string | null
): Promise<ExtractedSchema> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Key ${apiKey}`;
  }

  // Use fal.ai Model Search API with OpenAPI expansion
  const url = `https://api.fal.ai/v1/models?endpoint_id=${encodeURIComponent(modelId)}&expand=openapi-3.0`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    // Return empty params if API fails so generation still works
    return { parameters: [], inputs: [] };
  }

  const data = await response.json();

  // Response is { models: [{ openapi: {...}, ... }] }
  const modelData = data.models?.[0];
  if (!modelData?.openapi) {
    return { parameters: [], inputs: [] };
  }

  const spec = modelData.openapi;

  // Find POST endpoint with requestBody - paths are keyed by full endpoint path
  let inputSchema: Record<string, unknown> | null = null;

  for (const pathObj of Object.values(spec.paths || {})) {
    const postOp = (pathObj as Record<string, unknown>)?.post as Record<string, unknown> | undefined;
    const reqBody = postOp?.requestBody as Record<string, unknown> | undefined;
    const content = reqBody?.content as Record<string, Record<string, unknown>> | undefined;
    const jsonContent = content?.["application/json"];

    if (jsonContent?.schema) {
      const schema = jsonContent.schema as Record<string, unknown>;

      // Handle $ref - resolve from components.schemas
      if (schema.$ref && typeof schema.$ref === "string") {
        const refPath = schema.$ref.replace("#/components/schemas/", "");
        const resolvedSchema = spec.components?.schemas?.[refPath] as Record<string, unknown> | undefined;
        if (resolvedSchema) {
          inputSchema = resolvedSchema;
          break;
        }
      } else if (schema.properties) {
        inputSchema = schema;
        break;
      }
    }
  }

  if (!inputSchema) {
    return { parameters: [], inputs: [] };
  }

  // Pass components.schemas for $ref resolution
  const schemaComponents = spec.components?.schemas as Record<string, unknown> | undefined;
  return extractParametersFromSchema(inputSchema, schemaComponents);
}

/**
 * Extract ModelParameters and ModelInputs from an OpenAPI schema object
 */
function extractParametersFromSchema(
  schema: Record<string, unknown>,
  schemaComponents?: Record<string, unknown>
): ExtractedSchema {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[]) || [];

  if (!properties) {
    return { parameters: [], inputs: [] };
  }

  const parameters: ModelParameter[] = [];
  const inputs: ModelInput[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    // Check if this is a connectable input (image or text)
    if (isImageInput(name)) {
      inputs.push({
        name,
        type: "image",
        required: required.includes(name),
        label: toLabel(name),
        description: prop.description as string | undefined,
      });
      continue;
    }

    if (isTextInput(name)) {
      inputs.push({
        name,
        type: "text",
        required: required.includes(name),
        label: toLabel(name),
        description: prop.description as string | undefined,
      });
      continue;
    }

    // Otherwise it's a parameter
    const param = convertSchemaProperty(name, prop, required, schemaComponents);
    if (param) {
      parameters.push(param);
    }
  }

  // Sort parameters: priority params first, then alphabetically
  parameters.sort((a, b) => {
    const aIsPriority = PRIORITY_PARAMS.has(a.name);
    const bIsPriority = PRIORITY_PARAMS.has(b.name);
    if (aIsPriority && !bIsPriority) return -1;
    if (!aIsPriority && bIsPriority) return 1;
    return a.name.localeCompare(b.name);
  });

  // Sort inputs: required first, then by type (image before text), then alphabetically
  inputs.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.type !== b.type) return a.type === "image" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { parameters, inputs };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
): Promise<NextResponse<SchemaResponse>> {
  // Await params before accessing properties
  const { modelId } = await params;
  const decodedModelId = decodeURIComponent(modelId);
  const provider = request.nextUrl.searchParams.get("provider") as ProviderType | null;

  if (!provider || (provider !== "replicate" && provider !== "fal")) {
    return NextResponse.json<SchemaErrorResponse>(
      {
        success: false,
        error: "Invalid or missing provider. Use ?provider=replicate or ?provider=fal",
      },
      { status: 400 }
    );
  }

  // Check cache
  const cacheKey = `${provider}:${decodedModelId}`;
  const cached = schemaCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json<SchemaSuccessResponse>({
      success: true,
      parameters: cached.parameters,
      inputs: cached.inputs,
      cached: true,
    });
  }

  try {
    let result: ExtractedSchema;

    if (provider === "replicate") {
      // User-provided key takes precedence over env variable
      const apiKey = request.headers.get("X-Replicate-Key") || process.env.REPLICATE_API_KEY;
      if (!apiKey) {
        return NextResponse.json<SchemaErrorResponse>(
          {
            success: false,
            error: "Replicate API key required. Add REPLICATE_API_KEY to .env.local or configure in Settings.",
          },
          { status: 401 }
        );
      }
      result = await fetchReplicateSchema(decodedModelId, apiKey);
    } else {
      // User-provided key takes precedence over env variable
      const apiKey = request.headers.get("X-Fal-Key") || process.env.FAL_API_KEY || null;
      result = await fetchFalSchema(decodedModelId, apiKey);
    }

    // Cache the result
    schemaCache.set(cacheKey, { ...result, timestamp: Date.now() });

    return NextResponse.json<SchemaSuccessResponse>({
      success: true,
      parameters: result.parameters,
      inputs: result.inputs,
      cached: false,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ModelSchema] Error fetching ${decodedModelId}: ${errorMessage}`);
    return NextResponse.json<SchemaErrorResponse>(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
