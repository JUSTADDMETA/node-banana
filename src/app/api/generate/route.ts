import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { GenerateRequest, GenerateResponse, ModelType, SelectedModel, ProviderType } from "@/types";
import { GenerationInput, GenerationOutput, ProviderModel } from "@/lib/providers/types";
import { uploadImageForUrl, shouldUseImageUrl, deleteImages } from "@/lib/images";

export const maxDuration = 300; // 5 minute timeout for API calls
export const dynamic = 'force-dynamic'; // Ensure this route is always dynamic

// Map model types to Gemini model IDs
const MODEL_MAP: Record<ModelType, string> = {
  "nano-banana": "gemini-2.5-flash-image", // Updated to correct model name
  "nano-banana-pro": "gemini-3-pro-image-preview",
};

/**
 * Extended request format that supports both legacy and multi-provider requests
 */
interface MultiProviderGenerateRequest extends GenerateRequest {
  selectedModel?: SelectedModel;
  parameters?: Record<string, unknown>;
  /** Dynamic inputs from schema-based connections (e.g., image_url, tail_image_url, prompt) */
  dynamicInputs?: Record<string, string>;
}

/**
 * Generate image using Gemini API (legacy/default path)
 */
async function generateWithGemini(
  requestId: string,
  apiKey: string,
  prompt: string,
  images: string[],
  model: ModelType,
  aspectRatio?: string,
  resolution?: string,
  useGoogleSearch?: boolean
): Promise<NextResponse<GenerateResponse>> {
  console.log(`[API:${requestId}] Gemini generation - Model: ${model}, Images: ${images?.length || 0}, Prompt: ${prompt?.length || 0} chars`);

  // Extract base64 data and MIME types from data URLs
  const imageData = (images || []).map((image, idx) => {
    if (image.includes("base64,")) {
      const [header, data] = image.split("base64,");
      // Extract MIME type from header (e.g., "data:image/png;" -> "image/png")
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
      console.log(`[API:${requestId}]   Image ${idx + 1}: ${mimeType}, ${(data.length / 1024).toFixed(1)}KB`);
      return { data, mimeType };
    }
    console.log(`[API:${requestId}]   Image ${idx + 1}: raw, ${(image.length / 1024).toFixed(1)}KB`);
    return { data: image, mimeType: "image/png" };
  });

  // Initialize Gemini client
  const ai = new GoogleGenAI({ apiKey });

  // Build request parts array with prompt and all images
  const requestParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
    ...imageData.map(({ data, mimeType }) => ({
      inlineData: {
        mimeType,
        data,
      },
    })),
  ];

  // Build config object based on model capabilities
  const config: Record<string, unknown> = {
    responseModalities: ["IMAGE", "TEXT"],
  };

  // Add imageConfig for both models (both support aspect ratio)
  if (aspectRatio) {
    config.imageConfig = {
      aspectRatio,
    };
  }

  // Add resolution only for Nano Banana Pro
  if (model === "nano-banana-pro" && resolution) {
    if (!config.imageConfig) {
      config.imageConfig = {};
    }
    (config.imageConfig as Record<string, unknown>).imageSize = resolution;
  }

  // Add tools array for Google Search (only Nano Banana Pro)
  const tools = [];
  if (model === "nano-banana-pro" && useGoogleSearch) {
    tools.push({ googleSearch: {} });
  }

  console.log(`[API:${requestId}] Config: ${JSON.stringify(config)}`);

  // Make request to Gemini
  const geminiStartTime = Date.now();

  const response = await ai.models.generateContent({
    model: MODEL_MAP[model],
    contents: [
      {
        role: "user",
        parts: requestParts,
      },
    ],
    config,
    ...(tools.length > 0 && { tools }),
  });

  const geminiDuration = Date.now() - geminiStartTime;
  console.log(`[API:${requestId}] Gemini API completed in ${geminiDuration}ms`);

  // Extract image from response
  const candidates = response.candidates;

  if (!candidates || candidates.length === 0) {
    console.error(`[API:${requestId}] No candidates in Gemini response`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No response from AI model",
      },
      { status: 500 }
    );
  }

  const parts = candidates[0].content?.parts;
  console.log(`[API:${requestId}] Response parts: ${parts?.length || 0}`);

  if (!parts) {
    console.error(`[API:${requestId}] No parts in Gemini candidate content`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No content in response",
      },
      { status: 500 }
    );
  }

  // Find image part in response
  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      const imgData = part.inlineData.data;
      const imageSizeKB = (imgData.length / 1024).toFixed(1);

      console.log(`[API:${requestId}] Output image: ${mimeType}, ${imageSizeKB}KB`);

      const dataUrl = `data:${mimeType};base64,${imgData}`;

      const responsePayload = { success: true, image: dataUrl };
      const responseSize = JSON.stringify(responsePayload).length;
      const responseSizeMB = (responseSize / (1024 * 1024)).toFixed(2);

      if (responseSize > 4.5 * 1024 * 1024) {
        console.warn(`[API:${requestId}] Response size (${responseSizeMB}MB) approaching Next.js 5MB limit`);
      }

      console.log(`[API:${requestId}] SUCCESS - Returning ${responseSizeMB}MB payload`);

      // Create response with explicit headers to handle large payloads
      const resp = NextResponse.json<GenerateResponse>(responsePayload);
      resp.headers.set('Content-Type', 'application/json');
      resp.headers.set('Content-Length', responseSize.toString());

      return resp;
    }
  }

  // If no image found, check for text error
  for (const part of parts) {
    if (part.text) {
      console.error(`[API:${requestId}] Gemini returned text instead of image: ${part.text.substring(0, 100)}`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: `Model returned text instead of image: ${part.text.substring(0, 200)}`,
        },
        { status: 500 }
      );
    }
  }

  console.error(`[API:${requestId}] No image or text found in Gemini response`);
  return NextResponse.json<GenerateResponse>(
    {
      success: false,
      error: "No image in response",
    },
    { status: 500 }
  );
}

/**
 * Input parameter patterns - maps generic input types to possible schema parameter names
 */
const INPUT_PATTERNS: Record<string, string[]> = {
  // Text/prompt inputs
  prompt: ["prompt", "text", "caption", "input_text", "description", "query"],
  negativePrompt: ["negative_prompt", "negative", "neg_prompt", "negative_text"],

  // Image inputs
  image: ["image_url", "image_urls", "image", "first_frame", "start_image", "init_image",
          "reference_image", "input_image", "source_image", "img", "photo"],

  // Video/media settings
  aspectRatio: ["aspect_ratio", "ratio", "size", "dimensions", "output_size"],
  duration: ["duration", "length", "num_frames", "seconds", "video_length"],
  fps: ["fps", "frame_rate", "framerate", "frames_per_second"],

  // Audio settings
  audio: ["audio_enabled", "with_audio", "enable_audio", "audio", "sound"],

  // Generation settings
  seed: ["seed", "random_seed", "noise_seed"],
  steps: ["steps", "num_steps", "num_inference_steps", "inference_steps"],
  guidance: ["guidance_scale", "guidance", "cfg_scale", "cfg"],

  // Model-specific
  scheduler: ["scheduler", "sampler", "sampler_name"],
  strength: ["strength", "denoise", "denoising_strength"],
};

/**
 * Input mapping result from schema parsing
 */
interface InputMapping {
  // Maps our generic names to model-specific parameter names
  paramMap: Record<string, string>;
  // Track which params expect array types
  arrayParams: Set<string>;
}

/**
 * Extract input parameter mappings from OpenAPI schema
 * Returns a mapping of generic parameter names to model-specific names
 */
function getInputMappingFromSchema(schema: Record<string, unknown> | undefined): InputMapping {
  const paramMap: Record<string, string> = {};
  const arrayParams = new Set<string>();

  if (!schema) return { paramMap, arrayParams };

  try {
    // Navigate to input schema properties
    const components = schema.components as Record<string, unknown> | undefined;
    const schemas = components?.schemas as Record<string, unknown> | undefined;
    const input = schemas?.Input as Record<string, unknown> | undefined;
    const properties = input?.properties as Record<string, unknown> | undefined;

    if (!properties) return { paramMap, arrayParams };

    const propertyNames = Object.keys(properties);

    // For each input type pattern, find the matching schema property
    for (const [genericName, patterns] of Object.entries(INPUT_PATTERNS)) {
      for (const pattern of patterns) {
        let matchedParam: string | null = null;

        // Check for exact match first
        if (properties[pattern]) {
          matchedParam = pattern;
        } else {
          // Check for case-insensitive partial match
          const match = propertyNames.find(name =>
            name.toLowerCase().includes(pattern.toLowerCase()) ||
            pattern.toLowerCase().includes(name.toLowerCase())
          );
          if (match) {
            matchedParam = match;
          }
        }

        if (matchedParam) {
          paramMap[genericName] = matchedParam;
          // Check if this property expects an array type
          const property = properties[matchedParam] as Record<string, unknown>;
          if (property?.type === "array") {
            arrayParams.add(genericName);
          }
          break;
        }
      }
    }
  } catch {
    // Schema parsing failed
  }

  return { paramMap, arrayParams };
}

/**
 * Generate image using Replicate API
 */
async function generateWithReplicate(
  requestId: string,
  apiKey: string,
  input: GenerationInput
): Promise<GenerationOutput> {
  console.log(`[API:${requestId}] Replicate generation - Model: ${input.model.id}, Images: ${input.images?.length || 0}, Prompt: ${input.prompt.length} chars`);

  const REPLICATE_API_BASE = "https://api.replicate.com/v1";

  // Get the latest version of the model
  const modelId = input.model.id;
  const [owner, name] = modelId.split("/");

  // First, get the model to find the latest version
  const modelResponse = await fetch(
    `${REPLICATE_API_BASE}/models/${owner}/${name}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!modelResponse.ok) {
    return {
      success: false,
      error: `Failed to get model info: ${modelResponse.status}`,
    };
  }

  const modelData = await modelResponse.json();
  const version = modelData.latest_version?.id;

  if (!version) {
    return {
      success: false,
      error: "Model has no available version",
    };
  }

  const hasDynamicInputs = input.dynamicInputs && Object.keys(input.dynamicInputs).length > 0;
  console.log(`[API:${requestId}] Model version: ${version}, Dynamic inputs: ${hasDynamicInputs ? Object.keys(input.dynamicInputs!).join(", ") : "none"}`);

  // Build input for the prediction
  const predictionInput: Record<string, unknown> = {
    ...input.parameters,
  };

  // Add dynamic inputs if provided (these come from schema-mapped connections)
  if (hasDynamicInputs) {
    Object.assign(predictionInput, input.dynamicInputs);
  } else {
    // Fallback: use schema to map generic input names to model-specific parameter names
    const schema = modelData.latest_version?.openapi_schema as Record<string, unknown> | undefined;
    const { paramMap, arrayParams } = getInputMappingFromSchema(schema);

    // Map prompt input
    if (input.prompt) {
      const promptParam = paramMap.prompt || "prompt";
      predictionInput[promptParam] = input.prompt;
    }

    // Map image input - use array or string format based on schema
    if (input.images && input.images.length > 0) {
      const imageParam = paramMap.image || "image";
      if (arrayParams.has("image")) {
        predictionInput[imageParam] = input.images;
      } else {
        predictionInput[imageParam] = input.images[0];
      }
    }

    // Map any parameters that might need renaming
    if (input.parameters) {
      for (const [key, value] of Object.entries(input.parameters)) {
        const mappedKey = paramMap[key] || key;
        predictionInput[mappedKey] = value;
      }
    }
  }

  // Create a prediction
  const createResponse = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version,
      input: predictionInput,
    }),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    let errorDetail = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      errorDetail = errorJson.detail || errorJson.message || errorJson.error || errorText;
    } catch {
      // Keep original text if not JSON
    }

    // Handle rate limits
    if (createResponse.status === 429) {
      return {
        success: false,
        error: `${input.model.name}: Rate limit exceeded. Try again in a moment.`,
      };
    }

    return {
      success: false,
      error: `${input.model.name}: ${errorDetail}`,
    };
  }

  const prediction = await createResponse.json();
  console.log(`[API:${requestId}] Prediction created: ${prediction.id}`);

  // Poll for completion
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 1000; // 1 second
  const startTime = Date.now();

  let currentPrediction = prediction;
  let lastStatus = "";

  while (
    currentPrediction.status !== "succeeded" &&
    currentPrediction.status !== "failed" &&
    currentPrediction.status !== "canceled"
  ) {
    if (Date.now() - startTime > maxWaitTime) {
      return {
        success: false,
        error: `${input.model.name}: Generation timed out after 5 minutes. Video models may take longer - try again.`,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const pollResponse = await fetch(
      `${REPLICATE_API_BASE}/predictions/${currentPrediction.id}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!pollResponse.ok) {
      return {
        success: false,
        error: `Failed to poll prediction: ${pollResponse.status}`,
      };
    }

    currentPrediction = await pollResponse.json();
    if (currentPrediction.status !== lastStatus) {
      console.log(`[API:${requestId}] Prediction status: ${currentPrediction.status}`);
      lastStatus = currentPrediction.status;
    }
  }

  if (currentPrediction.status === "failed") {
    const failureReason = currentPrediction.error || "Prediction failed";
    return {
      success: false,
      error: `${input.model.name}: ${failureReason}`,
    };
  }

  if (currentPrediction.status === "canceled") {
    return {
      success: false,
      error: "Prediction was canceled",
    };
  }

  // Extract output
  const output = currentPrediction.output;
  if (!output) {
    return {
      success: false,
      error: "No output from prediction",
    };
  }

  // Output can be a single URL string or an array of URLs
  const outputUrls: string[] = Array.isArray(output) ? output : [output];

  if (outputUrls.length === 0) {
    return {
      success: false,
      error: "No output from prediction",
    };
  }

  // Fetch the first output and convert to base64
  const mediaUrl = outputUrls[0];
  console.log(`[API:${requestId}] Fetching output from: ${mediaUrl.substring(0, 80)}...`);
  const mediaResponse = await fetch(mediaUrl);

  if (!mediaResponse.ok) {
    return {
      success: false,
      error: `Failed to fetch output: ${mediaResponse.status}`,
    };
  }

  // Determine MIME type from response
  const contentType = mediaResponse.headers.get("content-type") || "image/png";
  const isVideo = contentType.startsWith("video/");

  const mediaArrayBuffer = await mediaResponse.arrayBuffer();
  const mediaSizeBytes = mediaArrayBuffer.byteLength;
  const mediaSizeMB = mediaSizeBytes / (1024 * 1024);

  console.log(`[API:${requestId}] Output: ${contentType}, ${mediaSizeMB.toFixed(2)}MB`);

  // For very large videos (>20MB), return URL directly instead of base64
  if (isVideo && mediaSizeMB > 20) {
    console.log(`[API:${requestId}] SUCCESS - Returning URL for large video`);
    return {
      success: true,
      outputs: [
        {
          type: "video",
          data: mediaUrl, // Return URL directly for very large videos
          url: mediaUrl,
        },
      ],
    };
  }

  const mediaBase64 = Buffer.from(mediaArrayBuffer).toString("base64");
  console.log(`[API:${requestId}] SUCCESS - Returning ${isVideo ? "video" : "image"}`);

  return {
    success: true,
    outputs: [
      {
        type: isVideo ? "video" : "image",
        data: `data:${contentType};base64,${mediaBase64}`,
        url: mediaUrl,
      },
    ],
  };
}

/**
 * Fetch fal.ai model schema and extract input parameter mappings
 * Uses the Model Search API with OpenAPI expansion (same as /api/models/[modelId])
 */
async function getFalInputMapping(modelId: string, apiKey: string | null): Promise<InputMapping> {
  const paramMap: Record<string, string> = {};
  const arrayParams = new Set<string>();

  try {
    // Use fal.ai Model Search API with OpenAPI expansion
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Key ${apiKey}`;
    }

    const url = `https://api.fal.ai/v1/models?endpoint_id=${encodeURIComponent(modelId)}&expand=openapi-3.0`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      return { paramMap, arrayParams };
    }

    const data = await response.json();
    const modelData = data.models?.[0];
    if (!modelData?.openapi) {
      return { paramMap, arrayParams };
    }

    // Extract input schema from OpenAPI spec (same logic as /api/models/[modelId])
    const spec = modelData.openapi;
    let inputSchema: Record<string, unknown> | null = null;

    for (const pathObj of Object.values(spec.paths || {})) {
      const postOp = (pathObj as Record<string, unknown>)?.post as Record<string, unknown> | undefined;
      const reqBody = postOp?.requestBody as Record<string, unknown> | undefined;
      const content = reqBody?.content as Record<string, Record<string, unknown>> | undefined;
      const jsonContent = content?.["application/json"];

      if (jsonContent?.schema) {
        const schema = jsonContent.schema as Record<string, unknown>;
        if (schema.$ref && typeof schema.$ref === "string") {
          const refPath = schema.$ref.replace("#/components/schemas/", "");
          inputSchema = spec.components?.schemas?.[refPath] as Record<string, unknown>;
          break;
        } else if (schema.properties) {
          inputSchema = schema;
          break;
        }
      }
    }

    if (!inputSchema) {
      return { paramMap, arrayParams };
    }

    const properties = inputSchema.properties as Record<string, unknown> | undefined;
    if (!properties) return { paramMap, arrayParams };

    // Match properties to INPUT_PATTERNS and detect array types
    const propertyNames = Object.keys(properties);
    for (const [genericName, patterns] of Object.entries(INPUT_PATTERNS)) {
      for (const pattern of patterns) {
        let matchedParam: string | null = null;

        // Check for exact match first
        if (properties[pattern]) {
          matchedParam = pattern;
        } else {
          // Check for case-insensitive partial match
          const match = propertyNames.find(name =>
            name.toLowerCase().includes(pattern.toLowerCase()) ||
            pattern.toLowerCase().includes(name.toLowerCase())
          );
          if (match) {
            matchedParam = match;
          }
        }

        if (matchedParam) {
          paramMap[genericName] = matchedParam;
          // Check if this property expects an array type
          const property = properties[matchedParam] as Record<string, unknown>;
          if (property?.type === "array") {
            arrayParams.add(genericName);
          }
          break;
        }
      }
    }
  } catch {
    // Schema parsing failed - continue with empty mapping
  }

  return { paramMap, arrayParams };
}

/**
 * Generate image using fal.ai API
 */
async function generateWithFal(
  requestId: string,
  apiKey: string | null,
  input: GenerationInput
): Promise<GenerationOutput> {
  console.log(`[API:${requestId}] fal.ai generation - Model: ${input.model.id}, Images: ${input.images?.length || 0}, Prompt: ${input.prompt.length} chars`);

  const modelId = input.model.id;
  const hasDynamicInputs = input.dynamicInputs && Object.keys(input.dynamicInputs).length > 0;
  console.log(`[API:${requestId}] Dynamic inputs: ${hasDynamicInputs ? Object.keys(input.dynamicInputs!).join(", ") : "none"}, API key: ${apiKey ? "yes" : "no"}`);


  // Build request body
  // If we have dynamic inputs, they take precedence (they already contain prompt, image_url, etc.)
  const requestBody: Record<string, unknown> = {
    ...input.parameters,
  };

  // Add dynamic inputs if provided (these come from schema-mapped connections)
  // Filter out empty/null/undefined values to avoid sending invalid inputs to fal.ai
  if (hasDynamicInputs) {
    const filteredInputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.dynamicInputs!)) {
      if (value !== null && value !== undefined && value !== '') {
        filteredInputs[key] = value;
      }
    }
    Object.assign(requestBody, filteredInputs);
  } else {
    // Fallback: use schema to map generic input names to model-specific parameter names
    const { paramMap, arrayParams } = await getFalInputMapping(modelId, apiKey);

    // Map prompt input
    if (input.prompt) {
      const promptParam = paramMap.prompt || "prompt";
      requestBody[promptParam] = input.prompt;
    }

    // Map image input - use array or string format based on schema
    if (input.images && input.images.length > 0) {
      const imageParam = paramMap.image || "image_url";
      if (arrayParams.has("image")) {
        requestBody[imageParam] = input.images;
      } else {
        requestBody[imageParam] = input.images[0];
      }
    }

    // Map any parameters that might need renaming
    if (input.parameters) {
      for (const [key, value] of Object.entries(input.parameters)) {
        const mappedKey = paramMap[key] || key;
        requestBody[mappedKey] = value;
      }
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Key ${apiKey}`;
  }

  // POST to fal.run/{modelId}
  console.log(`[API:${requestId}] Calling fal.ai API with inputs: ${Object.keys(requestBody).join(", ")}`);
  const response = await fetch(`https://fal.run/${modelId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();

    let errorDetail = errorText || `HTTP ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      // Handle various fal.ai error formats
      if (typeof errorJson.error === 'object' && errorJson.error?.message) {
        errorDetail = errorJson.error.message;
      } else if (errorJson.detail) {
        // Handle array of validation errors
        if (Array.isArray(errorJson.detail)) {
          errorDetail = errorJson.detail.map((d: { msg?: string; loc?: string[] }) =>
            d.msg || JSON.stringify(d)
          ).join('; ');
        } else {
          errorDetail = errorJson.detail;
        }
      } else if (errorJson.message) {
        errorDetail = errorJson.message;
      } else if (typeof errorJson.error === 'string') {
        errorDetail = errorJson.error;
      }
    } catch {
      // Keep original text if not JSON
    }

    // Handle rate limits
    if (response.status === 429) {
      return {
        success: false,
        error: `${input.model.name}: Rate limit exceeded. ${apiKey ? "Try again in a moment." : "Add an API key in settings for higher limits."}`,
      };
    }

    return {
      success: false,
      error: `${input.model.name}: ${errorDetail}`,
    };
  }

  const result = await response.json();

  // fal.ai response can have different structures:
  // - images: array with url field (image models)
  // - image: object with url field (image models)
  // - video: object with url field (video models)
  // - output: string URL (some models)
  let mediaUrl: string | null = null;
  let isVideoModel = false;

  // Check for video output first (video models)
  if (result.video && result.video.url) {
    mediaUrl = result.video.url;
    isVideoModel = true;
  } else if (result.images && Array.isArray(result.images) && result.images.length > 0) {
    mediaUrl = result.images[0].url;
  } else if (result.image && result.image.url) {
    mediaUrl = result.image.url;
  } else if (result.output && typeof result.output === "string") {
    // Some models return URL directly in output
    mediaUrl = result.output;
  }

  if (!mediaUrl) {
    console.error(`[API:${requestId}] No media URL found in fal.ai response`);
    return {
      success: false,
      error: "No media URL in response",
    };
  }

  // Fetch the media and convert to base64
  console.log(`[API:${requestId}] Fetching output from: ${mediaUrl.substring(0, 80)}...`);
  const mediaResponse = await fetch(mediaUrl);

  if (!mediaResponse.ok) {
    return {
      success: false,
      error: `Failed to fetch output: ${mediaResponse.status}`,
    };
  }

  // Determine MIME type from response
  const contentType = mediaResponse.headers.get("content-type") || (isVideoModel ? "video/mp4" : "image/png");
  const isVideo = contentType.startsWith("video/") || isVideoModel;

  const mediaArrayBuffer = await mediaResponse.arrayBuffer();
  const mediaSizeBytes = mediaArrayBuffer.byteLength;
  const mediaSizeMB = mediaSizeBytes / (1024 * 1024);

  console.log(`[API:${requestId}] Output: ${contentType}, ${mediaSizeMB.toFixed(2)}MB`);

  // For very large videos (>20MB), return URL directly instead of base64
  if (isVideo && mediaSizeMB > 20) {
    console.log(`[API:${requestId}] SUCCESS - Returning URL for large video`);
    return {
      success: true,
      outputs: [
        {
          type: "video",
          data: mediaUrl, // Return URL directly for very large videos
          url: mediaUrl,
        },
      ],
    };
  }

  const mediaBase64 = Buffer.from(mediaArrayBuffer).toString("base64");
  console.log(`[API:${requestId}] SUCCESS - Returning ${isVideo ? "video" : "image"}`);

  return {
    success: true,
    outputs: [
      {
        type: isVideo ? "video" : "image",
        data: `data:${contentType};base64,${mediaBase64}`,
        url: mediaUrl,
      },
    ],
  };
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`\n[API:${requestId}] ========== NEW GENERATE REQUEST ==========`);

  try {
    const body: MultiProviderGenerateRequest = await request.json();
    const {
      images,
      prompt,
      model = "nano-banana-pro",
      aspectRatio,
      resolution,
      useGoogleSearch,
      selectedModel,
      parameters,
      dynamicInputs,
    } = body;

    // Prompt is required unless:
    // - Provided via dynamicInputs
    // - Images are provided (image-to-video/image-to-image models)
    // - Dynamic inputs contain image frames (first_frame, last_frame, etc.)
    const hasPrompt = prompt || (dynamicInputs && dynamicInputs.prompt);
    const hasImages = (images && images.length > 0);
    const hasImageInputs = dynamicInputs && Object.keys(dynamicInputs).some(key =>
      key.includes('frame') || key.includes('image')
    );

    if (!hasPrompt && !hasImages && !hasImageInputs) {
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Prompt or image input is required",
        },
        { status: 400 }
      );
    }

    // Determine which provider to use
    const provider: ProviderType = selectedModel?.provider || "gemini";
    console.log(`[API:${requestId}] Provider: ${provider}, Model: ${selectedModel?.modelId || model}`);

    // Route to appropriate provider
    if (provider === "replicate") {
      // User-provided key takes precedence over env variable
      const replicateApiKey = request.headers.get("X-Replicate-API-Key") || process.env.REPLICATE_API_KEY;
      if (!replicateApiKey) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: "Replicate API key not configured. Add REPLICATE_API_KEY to .env.local or configure in Settings.",
          },
          { status: 401 }
        );
      }

      // Keep Data URIs as-is since localhost URLs won't work (provider can't reach them)
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values, keep Data URIs
      let processedDynamicInputs: Record<string, string> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values
          if (value === null || value === undefined || value === '') {
            continue;
          }

          // Keep the value as-is (Data URIs work with Replicate)
          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel!.modelId,
          name: selectedModel!.displayName,
          provider: "replicate",
          capabilities: ["text-to-image"],
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithReplicate(requestId, replicateApiKey, genInput);

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
          },
          { status: 500 }
        );
      }

      // Return first output (image or video)
      const output = result.outputs?.[0];
      if (!output?.data) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: "No output in generation result",
          },
          { status: 500 }
        );
      }

      // Return appropriate fields based on output type
      if (output.type === "video") {
        // Check if data is a URL (for large videos) or base64
        const isUrl = output.data.startsWith("http");
        return NextResponse.json<GenerateResponse>({
          success: true,
          video: isUrl ? undefined : output.data,
          videoUrl: isUrl ? output.data : undefined,
          contentType: "video",
        });
      }

      return NextResponse.json<GenerateResponse>({
        success: true,
        image: output.data,
        contentType: "image",
      });
    }

    if (provider === "fal") {
      // User-provided key takes precedence over env variable
      const falApiKey = request.headers.get("X-Fal-API-Key") || process.env.FAL_API_KEY || null;

      // For fal.ai, keep Data URIs as-is since localhost URLs won't work
      // fal.ai accepts Data URIs directly
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values
      let processedDynamicInputs: Record<string, string> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values
          if (value === null || value === undefined || value === '') {
            continue;
          }

          // Keep the value as-is (Data URIs work with fal.ai)
          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel!.modelId,
          name: selectedModel!.displayName,
          provider: "fal",
          capabilities: ["text-to-image"],
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithFal(requestId, falApiKey, genInput);

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
          },
          { status: 500 }
        );
      }

      // Return first output (image or video)
      const output = result.outputs?.[0];
      if (!output?.data) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: "No output in generation result",
          },
          { status: 500 }
        );
      }

      // Return appropriate fields based on output type
      if (output.type === "video") {
        // Check if data is a URL (for large videos) or base64
        const isUrl = output.data.startsWith("http");
        return NextResponse.json<GenerateResponse>({
          success: true,
          video: isUrl ? undefined : output.data,
          videoUrl: isUrl ? output.data : undefined,
          contentType: "video",
        });
      }

      return NextResponse.json<GenerateResponse>({
        success: true,
        image: output.data,
        contentType: "image",
      });
    }

    // Default: Use Gemini
    // User-provided key (from settings) takes precedence over env variable
    const geminiApiKey = request.headers.get("X-Gemini-API-Key") || process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "API key not configured. Add GEMINI_API_KEY to .env.local or configure in Settings.",
        },
        { status: 500 }
      );
    }

    return await generateWithGemini(
      requestId,
      geminiApiKey,
      prompt,
      images || [],
      model,
      aspectRatio,
      resolution,
      useGoogleSearch
    );
  } catch (error) {
    // Extract error information
    let errorMessage = "Generation failed";
    let errorDetails = "";

    if (error instanceof Error) {
      errorMessage = error.message;
      if ("cause" in error && error.cause) {
        errorDetails = JSON.stringify(error.cause);
      }
    }

    // Try to extract more details from API errors
    if (error && typeof error === "object") {
      const apiError = error as Record<string, unknown>;
      if (apiError.status) {
        errorDetails += ` Status: ${apiError.status}`;
      }
      if (apiError.statusText) {
        errorDetails += ` ${apiError.statusText}`;
      }
    }

    // Handle rate limiting
    if (errorMessage.includes("429")) {
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Rate limit reached. Please wait and try again.",
        },
        { status: 429 }
      );
    }

    console.error(`[API:${requestId}] Generation error: ${errorMessage}${errorDetails ? ` (${errorDetails.substring(0, 200)})` : ""}`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
