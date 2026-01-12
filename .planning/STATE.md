# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-09)

**Core value:** Provider infrastructure that dynamically discovers models from external APIs, enabling users to access hundreds of image/video generation models without hardcoding schemas.
**Current focus:** Phase 13 - Fix Duplicate Generations

## Current Position

Phase: 12 of 14 (Model Improvements)
Plan: 1 of 1 complete
Status: Phase complete
Last activity: 2026-01-12 - Completed Phase 12 fixes

Progress: ██████░░░░ 50%

## Performance Metrics

**Velocity:**
- Total plans completed: 20
- Average duration: 7.0 min
- Total execution time: 2.4 hours

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

**Recent Trend:**
- Last 5 plans: 4 min, 14 min, 12 min, 2 min, 8 min
- Trend: Fast execution with established patterns

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

## Session Continuity

Last session: 2026-01-12
Stopped at: Phase 12 Model Improvements completed
Resume file: None
Next action: Plan Phase 13 (Fix Duplicate Generations)
