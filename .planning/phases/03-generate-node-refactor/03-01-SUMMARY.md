---
phase: 03-generate-node-refactor
plan: 01
subsystem: ui
tags: [react, generate-image, provider-selector, multi-provider]

# Dependency graph
requires:
  - phase: 02-model-discovery
    provides: /api/models endpoint, ProviderModel interface
provides:
  - GenerateImageNode component with multi-provider UI
  - SelectedModel type for tracking provider/model selection
  - Provider dropdown with enabled provider detection
  - Model dropdown filtered to image capabilities
affects: [03-02, 03-03, 04-model-search-dialog]

# Tech tracking
tech-stack:
  added: []
  patterns: [provider-selector-ui, model-filtering-by-capability]

key-files:
  created:
    - src/components/nodes/GenerateImageNode.tsx
  modified:
    - src/types/index.ts
    - src/components/nodes/index.ts
    - src/store/workflowStore.ts
    - src/components/WorkflowCanvas.tsx

key-decisions:
  - "Provider dropdown shows Gemini always, others only if API key configured"
  - "Aspect ratio/resolution controls shown only for Gemini provider"
  - "Backward compatibility via aliases: NanoBananaNode, saveNanoBananaDefaults"

patterns-established:
  - "Provider-aware UI: detect enabled providers via provider registry"
  - "Model filtering: query /api/models with capabilities parameter"

issues-created: []

# Metrics
duration: 5 min
completed: 2026-01-09
---

# Phase 03 Plan 01: Rename NanoBanana to GenerateImage Summary

**GenerateImageNode component with provider dropdown and model selector filtering to image-capable models only**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-09T06:45:47Z
- **Completed:** 2026-01-09T06:50:50Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Created GenerateImageNode component with provider/model selection UI
- Added SelectedModel type for tracking selected provider and model
- Provider dropdown shows Gemini (always) plus Replicate/fal.ai (if configured)
- Model dropdown fetches from /api/models and filters to image capabilities
- Aspect ratio/resolution controls conditionally shown for Gemini only

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SelectedModel type and update NanoBananaNodeData** - `d3bc29c` (feat)
2. **Task 2: Create GenerateImageNode with provider/model selector** - `977b5f5` (feat)
3. **Task 3: Update store and canvas references** - `cec11f2` (feat)

**Plan metadata:** `4cc69a7` (docs: complete plan)

## Files Created/Modified
- `src/components/nodes/GenerateImageNode.tsx` - New component with provider/model selector
- `src/types/index.ts` - Added SelectedModel interface, updated NanoBananaNodeData
- `src/components/nodes/index.ts` - Export GenerateImageNode with NanoBananaNode alias
- `src/store/workflowStore.ts` - Renamed helper functions with aliases, updated defaults
- `src/components/WorkflowCanvas.tsx` - Updated nodeTypes to use GenerateImageNode

## Decisions Made
- Provider dropdown shows Gemini always (env-based), others only if API key configured in localStorage
- Aspect ratio and resolution controls only shown for Gemini provider (other providers handle this differently)
- Backward compatibility maintained: NanoBananaNode alias, saveNanoBananaDefaults alias

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## Next Phase Readiness
- GenerateImageNode UI complete, ready for execution logic
- Next plan 03-02 will add provider-specific execution in /api/generate route

---
*Phase: 03-generate-node-refactor*
*Completed: 2026-01-09*
