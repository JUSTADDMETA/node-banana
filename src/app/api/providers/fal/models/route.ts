import { NextRequest, NextResponse } from "next/server";
import { ProviderModel, ModelCapability } from "@/lib/providers";

const FAL_API_BASE = "https://api.fal.ai/v1";

/**
 * Categories we care about for image/video generation
 */
const RELEVANT_CATEGORIES = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
];

/**
 * Response schema from fal.ai models endpoint
 */
interface FalModelsResponse {
  models: FalModel[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Model schema from fal.ai API
 */
interface FalModel {
  endpoint_id: string;
  metadata: {
    display_name: string;
    category: string;
    description: string;
    status: "active" | "deprecated";
    tags: string[];
    updated_at: string;
    is_favorited: boolean | null;
    thumbnail_url: string;
    model_url: string;
    date: string;
    highlighted: boolean;
    pinned: boolean;
    thumbnail_animated_url?: string;
    github_url?: string;
    license_type?: "commercial" | "research" | "private";
  };
  openapi?: Record<string, unknown>;
}

/**
 * Map fal.ai category to ModelCapability
 */
function mapCategoryToCapability(category: string): ModelCapability | null {
  if (RELEVANT_CATEGORIES.includes(category)) {
    return category as ModelCapability;
  }
  return null;
}

/**
 * Check if a model has a relevant category
 */
function isRelevantModel(model: FalModel): boolean {
  return RELEVANT_CATEGORIES.includes(model.metadata.category);
}

/**
 * Map fal.ai model to our normalized ProviderModel format
 */
function mapToProviderModel(model: FalModel): ProviderModel {
  const capability = mapCategoryToCapability(model.metadata.category);

  return {
    id: model.endpoint_id,
    name: model.metadata.display_name,
    description: model.metadata.description,
    provider: "fal",
    capabilities: capability ? [capability] : [],
    coverImage: model.metadata.thumbnail_url,
  };
}

/**
 * Build category filter query string for relevant categories
 */
function buildCategoryFilter(): string {
  return RELEVANT_CATEGORIES.map((cat) => `category=${encodeURIComponent(cat)}`).join("&");
}

interface ModelsSuccessResponse {
  success: true;
  models: ProviderModel[];
}

interface ModelsErrorResponse {
  success: false;
  error: string;
}

type ModelsResponse = ModelsSuccessResponse | ModelsErrorResponse;

/**
 * GET /api/providers/fal/models
 *
 * Fetches available models from fal.ai API.
 * API key is optional - fal.ai works without but with rate limits.
 *
 * Query params:
 *   - search: Optional search query to filter models
 *   - api_key: Alternative to X-API-Key header
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<ModelsResponse>> {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[fal.ai:${requestId}] Models request started`);

  // Get optional API key from header or query param
  const apiKey =
    request.headers.get("X-API-Key") ||
    request.nextUrl.searchParams.get("api_key");

  const searchQuery = request.nextUrl.searchParams.get("search");
  console.log(
    `[fal.ai:${requestId}] ${searchQuery ? `Searching: "${searchQuery}"` : "Listing all models"}${apiKey ? " (with API key)" : " (no API key)"}`
  );

  try {
    // Build URL with category filter and optional search
    let url = `${FAL_API_BASE}/models?${buildCategoryFilter()}&status=active`;

    if (searchQuery) {
      url += `&q=${encodeURIComponent(searchQuery)}`;
    }

    // Build headers with optional auth
    const headers: HeadersInit = {};
    if (apiKey) {
      headers["Authorization"] = `Key ${apiKey}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[fal.ai:${requestId}] API error ${response.status}: ${errorText}`
      );

      if (response.status === 401) {
        return NextResponse.json<ModelsErrorResponse>(
          {
            success: false,
            error: "Invalid API key",
          },
          { status: 401 }
        );
      }

      return NextResponse.json<ModelsErrorResponse>(
        {
          success: false,
          error: `fal.ai API error: ${response.status}`,
        },
        { status: response.status }
      );
    }

    const data: FalModelsResponse = await response.json();

    // Filter to relevant categories and map to ProviderModel
    const models = data.models.filter(isRelevantModel).map(mapToProviderModel);

    console.log(`[fal.ai:${requestId}] Returning ${models.length} models`);

    return NextResponse.json<ModelsSuccessResponse>({
      success: true,
      models,
    });
  } catch (error) {
    console.error(`[fal.ai:${requestId}] Fetch error:`, error);
    return NextResponse.json<ModelsErrorResponse>(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch models from fal.ai",
      },
      { status: 500 }
    );
  }
}
