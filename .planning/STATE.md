# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-09)

**Core value:** Provider infrastructure that dynamically discovers models from external APIs, enabling users to access hundreds of image/video generation models without hardcoding schemas.
**Current focus:** Testing and modularization (v1.2)

## Current Position

Phase: 19 of 23 (Type Refactoring)
Plan: 2 of 2 in current phase
Status: Phase 19 complete
Last activity: 2026-01-13 - Completed 19-02-PLAN.md

Progress: █████████░ 96%

## Performance Metrics

**Velocity:**
- Total plans completed: 24
- Average duration: 7 min
- Total execution time: 2.9 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Provider Infrastructure | 2/2 | 14 min | 7 min |
| 2. Model Discovery | 3/3 | 14 min | 4.7 min |
| 3. Generate Node Refactor | 3/3 | 13 min | 4.3 min |
| 4. Model Search Dialog | 2/2 | 17 min | 8.5 min |
| 5. Image URL Server | 2/2 | 5 min | 2.5 min |
| 6. Video & Polish | 4/4 | 43 min | 14.3 min |
| 7. Video Connections | 1/1 | 4 min | 4 min |
| 8. Error Display | 1/1 | 14 min | 14 min |
| 9. Video History | 1/1 | 12 min | 12 min |
| 10. Node Autosizing | 1/1 | 2 min | 2 min |
| 11. UI Polish | 1/1 | 8 min | 8 min |
| 12. Model Improvements | 1/1 | - | - |
| 13. Fix Duplicate Generations | 1/1 | 1 min | 1 min |
| 14. Fix Drag-Connect Bugs | 1/1 | 7 min | 7 min |
| 15. Test Infrastructure | 1/1 | 3 min | 3 min |
| 16. Store Modularization | 1/1 | 22 min | 22 min |
| 22. Generate Node Dynamic Input Tests | 1/1 | 20 min | 20 min |

| 19. Type Refactoring | 2/2 | 16 min | 8 min |

**Recent Trend:**
- Last 5 plans: 22 min, 2 min, 20 min, 8 min, 8 min
- Trend: Type refactoring is faster than test phases

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Gemini always enabled via env var (GEMINI_API_KEY), Replicate/fal.ai optional
- API keys stored in localStorage under node-banana-provider-settings key
- Local state in modal to avoid saving on every keystroke
- Provider config pattern: {id, name, enabled, apiKey, apiKeyEnvVar?}
- Provider registry uses self-registration pattern via registerProvider()
- Gemini remains special-cased in /api/generate for now, not yet migrated
- Capability inference from model name/description keywords
- fal.ai API key optional (works without but rate limited)
- fal.ai auth header: "Key {apiKey}" format (not Bearer)
- fal.ai category maps directly to ModelCapability (no inference)
- 1-hour cache TTL for model lists (extended from 10 min)
- Unified API at /api/models with header-based auth
- Provider dropdown shows Gemini always, others only if API key configured
- Aspect ratio/resolution controls shown only for Gemini provider
- Backward compatibility via aliases: NanoBananaNode, saveNanoBananaDefaults
- Server-side provider execution in API route (not client-side)
- Header-based API key passing: X-Replicate-API-Key, X-Fal-API-Key
- fal.ai sync API (fal.run) instead of queue-based async
- Dual migration approach: loadWorkflow migrates + UI effect for runtime
- fal.ai icon always visible in action bar (works without key but rate limited)
- Replicate icon only visible when API key is configured
- Client-side search filtering for Replicate (their search API unreliable)
- Show all capability badges to differentiate similar models
- Extract variant suffix from fal.ai model IDs for display name
- No TTL for image store - explicit cleanup pattern (callers delete after use)
- 256KB threshold for shouldUseImageUrl (Replicate recommendation)
- Gemini excluded from video node (doesn't support video generation)
- Large videos (>20MB) return URL instead of base64 to avoid memory issues
- Fetch schema from provider API at model selection time with 10-min cache
- Filter internal params, prioritize user-relevant ones (seed, steps, guidance)
- Collapsible parameters section to keep node UI compact
- Node autosizing constraints: 200-500px width, 200-600px height, ~100px chrome
- Provider badges prepend node title (left side) with w-4 h-4 icons
- Node titles show only model name (no "Generate Image/Video" prefix)
- BaseNode supports titlePrefix prop for icon prepending
- Header aligned for saved/unsaved states with same icon layout
- isImageInput() uses word-boundary checks (not substring) to avoid matching num_images
- Workflow execution gets fresh node data from store (not stale captured array)
- regenerateNode includes parameters in request body
- MD5 content hashing for generation deduplication (fast, collision resistance not critical)
- Hash prefix in filename for O(1) duplicate lookup
- Normalized handle IDs (image, text, image-0) for connection stability across model changes
- Handle-to-schema mapping built at execution time from inputSchema
- Placeholder handles (dimmed 30%) for input types not used by model, preserving connections
- ReactFlowProvider wrapper for component tests using @xyflow/react hooks
- Zustand store mocking with vi.mock pattern returning mocked functions
- Vitest jsdom environment for React component tests
- Store utilities extracted to src/store/utils/ with re-exports for backward compatibility
- Consolidated defaultNodeDimensions (was duplicated in addNode and createGroup)
- localStorage mocking pattern for testing utility modules
- Type domain files live in src/types/*.ts with re-exports from index.ts
- BaseNodeData in annotation.ts to avoid circular imports (nodes.ts imports annotation.ts)
- 7 type domain files: annotation, nodes, providers, models, workflow, api, quickstart
- index.ts is pure re-export hub with no type definitions

### Deferred Issues

- UAT-001: Resolved - Provider icons now use real Replicate/fal.ai logos
- ISS-001: Resolved - Generate nodes now adapt to model requirements via dynamic parameters

### Blockers/Concerns

- Pre-existing lint configuration issue (ESLint not configured). Not blocking development.

### Roadmap Evolution

- v1.0 Multi-Provider Support shipped: 6 phases (Phase 1-6), 15 plans
- Milestone v1.1 Improvements created: 6 phases (Phase 7-12), improvements and polish
- Phase 13 added: Fix duplicate generations (hashing failure investigation)
- Phase 14 added: Fix drag-connect node creation bugs (consolidated from two phases)
- Milestone v1.2 Improvements created: 6 phases (Phase 15-20), testing and modularization
- Phase 21 added: Fix Gemini Pro image input handling and image deduplication issues
- Phase 22 added: Generate node dynamic input validation and API call tests
- Phase 23 added: Model browser improvements (recently used, icon dropdown, Gemini models in list)

## Session Continuity

Last session: 2026-01-13
Stopped at: Phase 19 complete
Resume file: None
Next action: Plan Phase 20 (run /gsd:plan-phase 20)
