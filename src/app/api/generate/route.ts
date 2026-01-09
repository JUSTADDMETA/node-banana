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
  console.log(`[API:${requestId}] Request parameters:`);
  console.log(`[API:${requestId}]   - Model: ${model} -> ${MODEL_MAP[model]}`);
  console.log(`[API:${requestId}]   - Images count: ${images?.length || 0}`);
  console.log(`[API:${requestId}]   - Prompt length: ${prompt?.length || 0} chars`);
  console.log(`[API:${requestId}]   - Aspect Ratio: ${aspectRatio || 'default'}`);
  console.log(`[API:${requestId}]   - Resolution: ${resolution || 'default'}`);
  console.log(`[API:${requestId}]   - Google Search: ${useGoogleSearch || false}`);

  console.log(`[API:${requestId}] Extracting image data...`);
  // Extract base64 data and MIME types from data URLs
  const imageData = (images || []).map((image, idx) => {
    if (image.includes("base64,")) {
      const [header, data] = image.split("base64,");
      // Extract MIME type from header (e.g., "data:image/png;" -> "image/png")
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
      console.log(`[API:${requestId}]   Image ${idx + 1}: ${mimeType}, ${(data.length / 1024).toFixed(2)}KB base64`);
      return { data, mimeType };
    }
    console.log(`[API:${requestId}]   Image ${idx + 1}: No base64 header, assuming PNG, ${(image.length / 1024).toFixed(2)}KB`);
    return { data: image, mimeType: "image/png" };
  });

  // Initialize Gemini client
  console.log(`[API:${requestId}] Initializing Gemini client...`);
  const ai = new GoogleGenAI({ apiKey });

  // Build request parts array with prompt and all images
  console.log(`[API:${requestId}] Building request parts...`);
  const requestParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
    ...imageData.map(({ data, mimeType }) => ({
      inlineData: {
        mimeType,
        data,
      },
    })),
  ];
  console.log(`[API:${requestId}] Request parts count: ${requestParts.length} (1 text + ${imageData.length} images)`);

  // Build config object based on model capabilities
  console.log(`[API:${requestId}] Building generation config...`);
  const config: Record<string, unknown> = {
    responseModalities: ["IMAGE", "TEXT"],
  };

  // Add imageConfig for both models (both support aspect ratio)
  if (aspectRatio) {
    config.imageConfig = {
      aspectRatio,
    };
    console.log(`[API:${requestId}]   Added aspect ratio: ${aspectRatio}`);
  }

  // Add resolution only for Nano Banana Pro
  if (model === "nano-banana-pro" && resolution) {
    if (!config.imageConfig) {
      config.imageConfig = {};
    }
    (config.imageConfig as Record<string, unknown>).imageSize = resolution;
    console.log(`[API:${requestId}]   Added resolution: ${resolution}`);
  }

  // Add tools array for Google Search (only Nano Banana Pro)
  const tools = [];
  if (model === "nano-banana-pro" && useGoogleSearch) {
    tools.push({ googleSearch: {} });
    console.log(`[API:${requestId}]   Added Google Search tool`);
  }

  console.log(`[API:${requestId}] Final config:`, JSON.stringify(config, null, 2));
  if (tools.length > 0) {
    console.log(`[API:${requestId}] Tools:`, JSON.stringify(tools, null, 2));
  }

  // Make request to Gemini
  console.log(`[API:${requestId}] Calling Gemini API...`);
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
  console.log(`[API:${requestId}] Gemini API call completed in ${geminiDuration}ms`);

  // Extract image from response
  console.log(`[API:${requestId}] Processing response...`);
  const candidates = response.candidates;
  console.log(`[API:${requestId}] Candidates count: ${candidates?.length || 0}`);

  if (!candidates || candidates.length === 0) {
    console.error(`[API:${requestId}] No candidates in response`);
    console.error(`[API:${requestId}] Full response:`, JSON.stringify(response, null, 2));
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No response from AI model",
      },
      { status: 500 }
    );
  }

  const parts = candidates[0].content?.parts;
  console.log(`[API:${requestId}] Parts count in first candidate: ${parts?.length || 0}`);

  if (!parts) {
    console.error(`[API:${requestId}] No parts in candidate content`);
    console.error(`[API:${requestId}] Candidate:`, JSON.stringify(candidates[0], null, 2));
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No content in response",
      },
      { status: 500 }
    );
  }

  // Log all parts
  parts.forEach((part, idx) => {
    const partKeys = Object.keys(part);
    console.log(`[API:${requestId}] Part ${idx + 1}: ${partKeys.join(', ')}`);
  });

  // Find image part in response
  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      const imgData = part.inlineData.data;
      const imageSizeKB = (imgData.length / 1024).toFixed(2);
      console.log(`[API:${requestId}] Found image in response: ${mimeType}, ${imageSizeKB}KB base64`);

      const dataUrl = `data:${mimeType};base64,${imgData}`;
      const dataUrlSizeKB = (dataUrl.length / 1024).toFixed(2);
      console.log(`[API:${requestId}] Data URL size: ${dataUrlSizeKB}KB`);

      const responsePayload = { success: true, image: dataUrl };
      const responseSize = JSON.stringify(responsePayload).length;
      const responseSizeMB = (responseSize / (1024 * 1024)).toFixed(2);
      console.log(`[API:${requestId}] Total response payload size: ${responseSizeMB}MB`);

      if (responseSize > 4.5 * 1024 * 1024) {
        console.warn(`[API:${requestId}] Response size (${responseSizeMB}MB) is approaching Next.js 5MB limit!`);
      }

      console.log(`[API:${requestId}] SUCCESS - Returning image`);

      // Create response with explicit headers to handle large payloads
      const resp = NextResponse.json<GenerateResponse>(responsePayload);
      resp.headers.set('Content-Type', 'application/json');
      resp.headers.set('Content-Length', responseSize.toString());

      console.log(`[API:${requestId}] Response headers set, returning...`);
      return resp;
    }
  }

  // If no image found, check for text error
  console.warn(`[API:${requestId}] No image found in parts, checking for text...`);
  for (const part of parts) {
    if (part.text) {
      console.error(`[API:${requestId}] Model returned text instead of image`);
      console.error(`[API:${requestId}] Text preview: "${part.text.substring(0, 200)}"`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: `Model returned text instead of image: ${part.text.substring(0, 200)}`,
        },
        { status: 500 }
      );
    }
  }

  console.error(`[API:${requestId}] No image or text found in response`);
  console.error(`[API:${requestId}] All parts:`, JSON.stringify(parts, null, 2));
  return NextResponse.json<GenerateResponse>(
    {
      success: false,
      error: "No image in response",
    },
    { status: 500 }
  );
}

/**
 * Generate image using Replicate API
 */
async function generateWithReplicate(
  requestId: string,
  apiKey: string,
  input: GenerationInput
): Promise<GenerationOutput> {
  console.log(`[API:${requestId}] Generating with Replicate...`);
  console.log(`[API:${requestId}]   - Model: ${input.model.id}`);
  console.log(`[API:${requestId}]   - Prompt length: ${input.prompt.length} chars`);
  console.log(`[API:${requestId}]   - Images count: ${input.images?.length || 0}`);

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

  // Build input for the prediction
  const predictionInput: Record<string, unknown> = {
    prompt: input.prompt,
    ...input.parameters,
  };

  // Add image input if provided (for img2img workflows)
  // Note: Different Replicate models use different parameter names
  // Using 'image' as it's most common for img2img models
  if (input.images && input.images.length > 0) {
    predictionInput.image = input.images[0];
    console.log(`[API:${requestId}] Added image input to prediction (${input.images[0].substring(0, 50)}...)`);
  }

  // Create a prediction
  console.log(`[API:${requestId}] Creating Replicate prediction...`);
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
    return {
      success: false,
      error: `Failed to create prediction: ${createResponse.status} - ${errorText}`,
    };
  }

  const prediction = await createResponse.json();

  // Poll for completion
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 1000; // 1 second
  const startTime = Date.now();

  let currentPrediction = prediction;

  while (
    currentPrediction.status !== "succeeded" &&
    currentPrediction.status !== "failed" &&
    currentPrediction.status !== "canceled"
  ) {
    if (Date.now() - startTime > maxWaitTime) {
      return {
        success: false,
        error: "Prediction timed out after 5 minutes",
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
    console.log(`[API:${requestId}] Prediction status: ${currentPrediction.status}`);
  }

  if (currentPrediction.status === "failed") {
    return {
      success: false,
      error: currentPrediction.error || "Prediction failed",
    };
  }

  if (currentPrediction.status === "canceled") {
    return {
      success: false,
      error: "Prediction was canceled",
    };
  }

  // Extract output image(s)
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
      error: "No output images from prediction",
    };
  }

  // Fetch the first output image and convert to base64
  const imageUrl = outputUrls[0];
  console.log(`[API:${requestId}] Fetching output image from: ${imageUrl}`);
  const imageResponse = await fetch(imageUrl);

  if (!imageResponse.ok) {
    return {
      success: false,
      error: `Failed to fetch output image: ${imageResponse.status}`,
    };
  }

  const imageArrayBuffer = await imageResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imageArrayBuffer).toString("base64");

  // Determine MIME type from response
  const contentType = imageResponse.headers.get("content-type") || "image/png";

  console.log(`[API:${requestId}] Replicate generation successful`);
  return {
    success: true,
    outputs: [
      {
        type: "image",
        data: `data:${contentType};base64,${imageBase64}`,
        url: imageUrl,
      },
    ],
  };
}

/**
 * Generate image using fal.ai API
 */
async function generateWithFal(
  requestId: string,
  apiKey: string | null,
  input: GenerationInput
): Promise<GenerationOutput> {
  console.log(`[API:${requestId}] Generating with fal.ai...`);
  console.log(`[API:${requestId}]   - Model: ${input.model.id}`);
  console.log(`[API:${requestId}]   - Prompt length: ${input.prompt.length} chars`);
  console.log(`[API:${requestId}]   - Images count: ${input.images?.length || 0}`);
  console.log(`[API:${requestId}]   - API key: ${apiKey ? "provided" : "not provided (using rate-limited access)"}`);

  const modelId = input.model.id;

  // Build request body
  const requestBody: Record<string, unknown> = {
    prompt: input.prompt,
    ...input.parameters,
  };

  // Add image_url if provided (for img2img workflows)
  // fal.ai accepts both URLs and data URIs in this field
  if (input.images && input.images.length > 0) {
    requestBody.image_url = input.images[0];
    console.log(`[API:${requestId}] Added image_url to request (${input.images[0].substring(0, 50)}...)`);
  }

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Key ${apiKey}`;
  }

  // POST to fal.run/{modelId}
  console.log(`[API:${requestId}] Calling fal.ai API...`);
  const response = await fetch(`https://fal.run/${modelId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      success: false,
      error: `fal.ai API error: ${response.status} - ${errorText}`,
    };
  }

  const result = await response.json();

  // fal.ai response typically has "images" array with url field
  // or "image" object with url field depending on the model
  let imageUrl: string | null = null;

  if (result.images && Array.isArray(result.images) && result.images.length > 0) {
    imageUrl = result.images[0].url;
  } else if (result.image && result.image.url) {
    imageUrl = result.image.url;
  } else if (result.output && typeof result.output === "string") {
    // Some models return URL directly in output
    imageUrl = result.output;
  }

  if (!imageUrl) {
    return {
      success: false,
      error: "No image URL in response",
    };
  }

  // Fetch the image and convert to base64
  console.log(`[API:${requestId}] Fetching output image from: ${imageUrl}`);
  const imageResponse = await fetch(imageUrl);

  if (!imageResponse.ok) {
    return {
      success: false,
      error: `Failed to fetch output image: ${imageResponse.status}`,
    };
  }

  const imageArrayBuffer = await imageResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imageArrayBuffer).toString("base64");

  // Determine MIME type from response
  const contentType = imageResponse.headers.get("content-type") || "image/png";

  console.log(`[API:${requestId}] fal.ai generation successful`);
  return {
    success: true,
    outputs: [
      {
        type: "image",
        data: `data:${contentType};base64,${imageBase64}`,
        url: imageUrl,
      },
    ],
  };
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`\n[API:${requestId}] ========== NEW GENERATE REQUEST ==========`);
  console.log(`[API:${requestId}] Timestamp: ${new Date().toISOString()}`);

  try {
    console.log(`[API:${requestId}] Parsing request body...`);
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
    } = body;

    if (!prompt) {
      console.error(`[API:${requestId}] Validation failed: missing prompt`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Prompt is required",
        },
        { status: 400 }
      );
    }

    // Determine which provider to use
    const provider: ProviderType = selectedModel?.provider || "gemini";
    console.log(`[API:${requestId}] Provider: ${provider}`);

    // Route to appropriate provider
    if (provider === "replicate") {
      // Get Replicate API key from request headers
      const replicateApiKey = request.headers.get("X-Replicate-API-Key");
      if (!replicateApiKey) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: "Replicate API key not provided. Include X-Replicate-API-Key header.",
          },
          { status: 401 }
        );
      }

      // Process images: convert large images to URLs for provider to fetch
      const baseUrl = new URL(request.url).origin;
      const uploadedImageIds: string[] = [];
      const processedImages: string[] = [];

      if (images && images.length > 0) {
        for (const image of images) {
          if (shouldUseImageUrl(image)) {
            const { url, id } = uploadImageForUrl(image, baseUrl);
            uploadedImageIds.push(id);
            processedImages.push(url);
            console.log(`[API:${requestId}] Converted large image to URL: ${url}`);
          } else {
            processedImages.push(image);
            console.log(`[API:${requestId}] Using base64 directly (small image)`);
          }
        }
      }

      try {
        // Build generation input
        const genInput: GenerationInput = {
          model: {
            id: selectedModel!.modelId,
            name: selectedModel!.displayName,
            provider: "replicate",
            capabilities: ["text-to-image"],
            description: null,
          },
          prompt,
          images: processedImages,
          parameters,
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

        // Return first output image
        const outputImage = result.outputs?.[0]?.data;
        if (!outputImage) {
          return NextResponse.json<GenerateResponse>(
            {
              success: false,
              error: "No image in generation output",
            },
            { status: 500 }
          );
        }

        return NextResponse.json<GenerateResponse>({
          success: true,
          image: outputImage,
        });
      } finally {
        // Clean up uploaded images
        if (uploadedImageIds.length > 0) {
          deleteImages(uploadedImageIds);
          console.log(`[API:${requestId}] Cleaned up ${uploadedImageIds.length} uploaded images`);
        }
      }
    }

    if (provider === "fal") {
      // Get fal.ai API key from request headers (optional - fal.ai works without key but rate limited)
      const falApiKey = request.headers.get("X-Fal-API-Key");

      // Process images: convert large images to URLs for provider to fetch
      const baseUrl = new URL(request.url).origin;
      const uploadedImageIds: string[] = [];
      const processedImages: string[] = [];

      if (images && images.length > 0) {
        for (const image of images) {
          if (shouldUseImageUrl(image)) {
            const { url, id } = uploadImageForUrl(image, baseUrl);
            uploadedImageIds.push(id);
            processedImages.push(url);
            console.log(`[API:${requestId}] Converted large image to URL: ${url}`);
          } else {
            processedImages.push(image);
            console.log(`[API:${requestId}] Using base64 directly (small image)`);
          }
        }
      }

      try {
        // Build generation input
        const genInput: GenerationInput = {
          model: {
            id: selectedModel!.modelId,
            name: selectedModel!.displayName,
            provider: "fal",
            capabilities: ["text-to-image"],
            description: null,
          },
          prompt,
          images: processedImages,
          parameters,
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

        // Return first output image
        const outputImage = result.outputs?.[0]?.data;
        if (!outputImage) {
          return NextResponse.json<GenerateResponse>(
            {
              success: false,
              error: "No image in generation output",
            },
            { status: 500 }
          );
        }

        return NextResponse.json<GenerateResponse>({
          success: true,
          image: outputImage,
        });
      } finally {
        // Clean up uploaded images
        if (uploadedImageIds.length > 0) {
          deleteImages(uploadedImageIds);
          console.log(`[API:${requestId}] Cleaned up ${uploadedImageIds.length} uploaded images`);
        }
      }
    }

    // Default: Use Gemini
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      console.error(`[API:${requestId}] No Gemini API key configured`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "API key not configured. Add GEMINI_API_KEY to .env.local",
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
    console.error(`[API:${requestId}] EXCEPTION CAUGHT IN API ROUTE`);
    console.error(`[API:${requestId}] Error type:`, error?.constructor?.name);
    console.error(`[API:${requestId}] Error toString:`, String(error));

    // Extract detailed error information
    let errorMessage = "Generation failed";
    let errorDetails = "";

    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || "";
      console.error(`[API:${requestId}] Error message:`, errorMessage);
      console.error(`[API:${requestId}] Error stack:`, error.stack);

      // Check for specific error types
      if ("cause" in error && error.cause) {
        console.error(`[API:${requestId}] Error cause:`, error.cause);
        errorDetails += `\nCause: ${JSON.stringify(error.cause)}`;
      }
    }

    // Try to extract more details from API errors
    if (error && typeof error === "object") {
      const apiError = error as Record<string, unknown>;
      console.error(`[API:${requestId}] Error object keys:`, Object.keys(apiError));

      if (apiError.status) {
        console.error(`[API:${requestId}] Error status:`, apiError.status);
        errorDetails += `\nStatus: ${apiError.status}`;
      }
      if (apiError.statusText) {
        console.error(`[API:${requestId}] Error statusText:`, apiError.statusText);
        errorDetails += `\nStatusText: ${apiError.statusText}`;
      }
      if (apiError.errorDetails) {
        console.error(`[API:${requestId}] Error errorDetails:`, apiError.errorDetails);
        errorDetails += `\nDetails: ${JSON.stringify(apiError.errorDetails)}`;
      }
      if (apiError.response) {
        try {
          console.error(`[API:${requestId}] Error response:`, apiError.response);
          errorDetails += `\nResponse: ${JSON.stringify(apiError.response)}`;
        } catch {
          errorDetails += `\nResponse: [unable to stringify]`;
        }
      }

      // Log entire error object for debugging
      try {
        console.error(`[API:${requestId}] Full error object:`, JSON.stringify(apiError, null, 2));
      } catch {
        console.error(`[API:${requestId}] Could not stringify full error object`);
      }
    }

    console.error(`[API:${requestId}] Compiled error details:`, errorDetails);

    // Handle rate limiting
    if (errorMessage.includes("429")) {
      console.error(`[API:${requestId}] Rate limit error detected`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Rate limit reached. Please wait and try again.",
        },
        { status: 429 }
      );
    }

    console.error(`[API:${requestId}] Returning 500 error response`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: `${errorMessage}${errorDetails ? ` | Details: ${errorDetails.substring(0, 500)}` : ""}`,
      },
      { status: 500 }
    );
  }
}
