"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useWorkflowStore } from "@/store/workflowStore";
import { useReactFlow } from "@xyflow/react";
import { ProviderType } from "@/types";
import { ProviderModel, ModelCapability } from "@/lib/providers/types";

// Get the center of the React Flow pane in screen coordinates
function getPaneCenter() {
  const pane = document.querySelector(".react-flow");
  if (pane) {
    const rect = pane.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

// Capability filter options
type CapabilityFilter = "all" | "image" | "video";

// API response type
interface ModelsResponse {
  success: boolean;
  models?: ProviderModel[];
  error?: string;
}

interface ModelSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialProvider?: ProviderType | null;
}

export function ModelSearchDialog({
  isOpen,
  onClose,
  initialProvider,
}: ModelSearchDialogProps) {
  const {
    providerSettings,
    addNode,
    incrementModalCount,
    decrementModalCount,
  } = useWorkflowStore();
  const { screenToFlowPosition } = useReactFlow();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderType | "all">(
    initialProvider || "all"
  );
  const [capabilityFilter, setCapabilityFilter] =
    useState<CapabilityFilter>("all");
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Register modal with store
  useEffect(() => {
    if (isOpen) {
      incrementModalCount();
      return () => decrementModalCount();
    }
  }, [isOpen, incrementModalCount, decrementModalCount]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Update provider filter when initialProvider changes
  useEffect(() => {
    if (initialProvider) {
      setProviderFilter(initialProvider);
    }
  }, [initialProvider]);

  // Fetch models
  const fetchModels = useCallback(async () => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      // Build query params
      const params = new URLSearchParams();
      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }
      if (providerFilter !== "all") {
        params.set("provider", providerFilter);
      }
      if (capabilityFilter !== "all") {
        const capabilities =
          capabilityFilter === "image"
            ? "text-to-image,image-to-image"
            : "text-to-video,image-to-video";
        params.set("capabilities", capabilities);
      }

      // Build headers with API keys
      const headers: Record<string, string> = {};
      const replicateKey = providerSettings.providers.replicate?.apiKey;
      const falKey = providerSettings.providers.fal?.apiKey;

      if (replicateKey) {
        headers["X-Replicate-Key"] = replicateKey;
      }
      if (falKey) {
        headers["X-Fal-Key"] = falKey;
      }

      const response = await fetch(`/api/models?${params.toString()}`, {
        headers,
        signal: abortControllerRef.current.signal,
      });

      const data: ModelsResponse = await response.json();

      if (data.success && data.models) {
        setModels(data.models);
      } else {
        setError(data.error || "Failed to fetch models");
        setModels([]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // Ignore aborted requests
      }
      setError(err instanceof Error ? err.message : "Failed to fetch models");
      setModels([]);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, providerFilter, capabilityFilter, providerSettings]);

  // Fetch models when filters change
  useEffect(() => {
    if (isOpen) {
      fetchModels();
    }
  }, [isOpen, fetchModels]);

  // Focus search input when dialog opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Handle model selection
  const handleSelectModel = useCallback(
    (model: ProviderModel) => {
      const center = getPaneCenter();
      const position = screenToFlowPosition({
        x: center.x + Math.random() * 100 - 50,
        y: center.y + Math.random() * 100 - 50,
      });

      addNode("nanoBanana", position, {
        selectedModel: {
          provider: model.provider,
          modelId: model.id,
          displayName: model.name,
        },
      });

      onClose();
    },
    [screenToFlowPosition, addNode, onClose]
  );

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Get provider badge color
  const getProviderBadgeColor = (provider: ProviderType) => {
    switch (provider) {
      case "replicate":
        return "bg-blue-500/20 text-blue-300";
      case "fal":
        return "bg-yellow-500/20 text-yellow-300";
      default:
        return "bg-neutral-500/20 text-neutral-300";
    }
  };

  // Get capability badges - show all capabilities to differentiate similar models
  const getCapabilityBadges = (capabilities: ModelCapability[]) => {
    const badges: React.ReactNode[] = [];

    capabilities.forEach((cap) => {
      let color = "";
      let label = "";

      switch (cap) {
        case "text-to-image":
          color = "bg-green-500/20 text-green-300";
          label = "txt→img";
          break;
        case "image-to-image":
          color = "bg-cyan-500/20 text-cyan-300";
          label = "img→img";
          break;
        case "text-to-video":
          color = "bg-purple-500/20 text-purple-300";
          label = "txt→vid";
          break;
        case "image-to-video":
          color = "bg-pink-500/20 text-pink-300";
          label = "img→vid";
          break;
      }

      if (label) {
        badges.push(
          <span
            key={cap}
            className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}
          >
            {label}
          </span>
        );
      }
    });

    return badges;
  };

  if (!isOpen) return null;

  const dialogContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div className="relative bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-700">
          <h2 className="text-lg font-semibold text-neutral-100">
            Browse Models
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 rounded transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="px-6 py-4 border-b border-neutral-700">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search Input */}
            <div className="flex-1 relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-10 pr-4 py-2 text-sm bg-neutral-700 border border-neutral-600 rounded text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-500"
              />
            </div>

            {/* Provider Filter */}
            <select
              value={providerFilter}
              onChange={(e) =>
                setProviderFilter(e.target.value as ProviderType | "all")
              }
              className="px-3 py-2 text-sm bg-neutral-700 border border-neutral-600 rounded text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            >
              <option value="all">All Providers</option>
              <option value="replicate">Replicate</option>
              <option value="fal">fal.ai</option>
            </select>

            {/* Capability Filter */}
            <select
              value={capabilityFilter}
              onChange={(e) =>
                setCapabilityFilter(e.target.value as CapabilityFilter)
              }
              className="px-3 py-2 text-sm bg-neutral-700 border border-neutral-600 rounded text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            >
              <option value="all">All Types</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="flex flex-col items-center gap-3">
                <svg
                  className="w-8 h-8 animate-spin text-neutral-400"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span className="text-sm text-neutral-400">
                  Loading models...
                </span>
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <svg
                className="w-10 h-10 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <p className="text-sm text-neutral-400 text-center max-w-xs">
                {error}
              </p>
              <button
                onClick={fetchModels}
                className="px-3 py-1.5 text-sm bg-neutral-700 hover:bg-neutral-600 text-neutral-200 rounded transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : models.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <svg
                className="w-10 h-10 text-neutral-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-neutral-400">No models found</p>
              <p className="text-xs text-neutral-500">
                Try adjusting your search or filters
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {models.map((model) => (
                <button
                  key={`${model.provider}-${model.id}`}
                  onClick={() => handleSelectModel(model)}
                  className="flex items-start gap-3 p-4 bg-neutral-700/50 hover:bg-neutral-700 border border-neutral-600/50 hover:border-neutral-500 rounded-lg transition-colors text-left cursor-pointer group"
                >
                  {/* Cover Image - larger */}
                  <div className="w-20 h-20 rounded bg-neutral-600 overflow-hidden flex-shrink-0">
                    {model.coverImage ? (
                      <img
                        src={model.coverImage}
                        alt={model.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Hide broken images
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg
                          className="w-8 h-8 text-neutral-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Model Info */}
                  <div className="flex-1 min-w-0">
                    {/* Model name */}
                    <div className="font-medium text-neutral-100 text-sm truncate">
                      {model.name}
                    </div>

                    {/* Model ID - helps differentiate similar models */}
                    <div className="text-[10px] text-neutral-500 truncate mt-0.5 font-mono">
                      {model.id}
                    </div>

                    {/* Badges row */}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${getProviderBadgeColor(model.provider)}`}
                      >
                        {model.provider === "fal" ? "fal.ai" : "Replicate"}
                      </span>
                      {getCapabilityBadges(model.capabilities)}
                    </div>

                    {/* Description - more lines */}
                    {model.description && (
                      <p className="mt-1.5 text-xs text-neutral-400 line-clamp-3">
                        {model.description}
                      </p>
                    )}
                  </div>

                  {/* Hover indicator */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 self-center">
                    <svg
                      className="w-5 h-5 text-neutral-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer with model count */}
        {!isLoading && !error && models.length > 0 && (
          <div className="px-6 py-3 border-t border-neutral-700 text-xs text-neutral-400">
            {models.length} model{models.length !== 1 ? "s" : ""} found
          </div>
        )}
      </div>
    </div>
  );

  // Use portal to render outside React Flow stacking context
  return createPortal(dialogContent, document.body);
}
