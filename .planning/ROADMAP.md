# Roadmap: Node Banana Multi-Provider Support

## Overview

Transform Node Banana from a Gemini-only image generator into a multi-provider platform supporting Replicate and fal.ai. The journey builds provider infrastructure first, then adds dynamic model discovery, refactors the generate node for flexibility, creates a searchable model browser, adds local image serving for URL-based providers, and finishes with video support and polish.

## Domain Expertise

None

## Milestones

- ✅ **v1.0 Multi-Provider Support** - Phases 1-6 (shipped 2026-01-11)
- 🚧 **v1.1 Improvements** - Phases 7-12 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

<details>
<summary>✅ v1.0 Multi-Provider Support (Phases 1-6) - SHIPPED 2026-01-11</summary>

### Phase 1: Provider Infrastructure
**Goal**: Users can configure Replicate and fal.ai API keys in settings, with keys securely stored
**Depends on**: Nothing (first phase)
**Research**: Unlikely (internal UI patterns, Zustand state management)
**Plans**: 2 plans

Plans:
- [x] 01-01: Provider settings UI in ProjectSetupModal
- [x] 01-02: Provider abstraction layer and types

### Phase 2: Model Discovery
**Goal**: App can fetch and cache available models from enabled providers at runtime
**Depends on**: Phase 1
**Research**: Likely (external APIs)
**Research topics**: Replicate model listing API endpoints, fal.ai model discovery endpoints, response schemas and pagination
**Plans**: 3 plans

Plans:
- [x] 02-01: Replicate model fetching API route
- [x] 02-02: fal.ai model fetching API route
- [x] 02-03: Model caching and unified model interface

### Phase 3: Generate Node Refactor
**Goal**: NanoBanana node becomes GenerateImage node supporting any provider's image models
**Depends on**: Phase 2
**Research**: Unlikely (internal refactoring using existing patterns)
**Design decision**: Separate nodes for image vs video generation (GenerateVideo added in Phase 6)
**Plans**: 3 plans

Plans:
- [x] 03-01: Rename NanoBanana to GenerateImage, add model selector (image models only)
- [x] 03-02: Provider-specific execution in generate API route
- [x] 03-03: Backward compatibility for existing workflows

### Phase 4: Model Search Dialog
**Goal**: Users can browse models via floating action bar icons and searchable dialog
**Depends on**: Phase 3
**Research**: Unlikely (internal UI using React patterns)
**Plans**: 2 plans

Plans:
- [x] 04-01: Floating action bar with provider icons
- [x] 04-02: Model search dialog with filtering and selection

### Phase 5: Image URL Server
**Goal**: Local API endpoint serves workflow images as URLs for providers requiring URL inputs
**Depends on**: Phase 3
**Research**: Unlikely (Next.js API routes, existing patterns)
**Plans**: 2 plans

Plans:
- [x] 05-01: Image serving endpoint and URL generation
- [x] 05-02: Integration with generate node for URL-based providers

### Phase 6: Video & Polish
**Goal**: GenerateVideo node for video generation, video playback, custom parameters, edge cases
**Depends on**: Phase 5
**Research**: Likely (video handling)
**Research topics**: HTML5 video element for base64/blob URLs, provider response formats for video content
**Design decision**: GenerateVideo as separate node type (not combined with GenerateImage)
**Plans**: 4 plans

Plans:
- [x] 06-01: GenerateVideo node with video-capable model selector
- [x] 06-02: Video playback in output node
- [x] 06-03: Custom model parameters from provider schemas
- [x] 06-04: Edge case handling and final polish

</details>

### 🚧 v1.1 Improvements (In Progress)

**Milestone Goal:** Fix connection issues, improve error visibility, add video history, auto-size nodes, and polish UI

#### Phase 7: Video Connections ✅

**Goal**: Fix video handle connections to only allow valid targets (generateVideo, output)
**Depends on**: Phase 6
**Research**: Unlikely (internal connection validation patterns)
**Plans**: 1 plan

Plans:
- [x] 07-01: Add video handle type and connection validation

#### Phase 8: Error Display ✅

**Goal**: Better error visibility with overlay display, not hidden by previous output
**Depends on**: Phase 7
**Research**: Unlikely (internal UI patterns)
**Plans**: 1 plan

Plans:
- [x] 08-01: Error notifications with persistent toast and node overlays

#### Phase 9: Video History ✅

**Goal**: Add history carousel for generated videos matching image history pattern
**Depends on**: Phase 8
**Research**: Unlikely (existing image history pattern)
**Plans**: 1 plan

Plans:
- [x] 09-01: Video history types, store support, load API, and carousel UI

#### Phase 10: Node Autosizing

**Goal**: Auto-size nodes to output dimensions and aspect ratio
**Depends on**: Phase 9
**Research**: Unlikely (React Flow node sizing)
**Plans**: TBD

Plans:
- [ ] 10-01: TBD (run /gsd:plan-phase 10 to break down)

#### Phase 11: UI Polish

**Goal**: Flora UI alignment, header UI improvements, project settings, provider logos on nodes
**Depends on**: Phase 10
**Research**: Unlikely (internal UI work)
**Plans**: TBD

Plans:
- [ ] 11-01: TBD (run /gsd:plan-phase 11 to break down)

#### Phase 12: Model Improvements

**Goal**: Verify Replicate image models work, extend model cache TTL
**Depends on**: Phase 11
**Research**: Likely (Replicate API behavior verification)
**Research topics**: Replicate image model endpoints, cache invalidation strategies
**Plans**: TBD

Plans:
- [ ] 12-01: TBD (run /gsd:plan-phase 12 to break down)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Provider Infrastructure | v1.0 | 2/2 | Complete | 2026-01-09 |
| 2. Model Discovery | v1.0 | 3/3 | Complete | 2026-01-09 |
| 3. Generate Node Refactor | v1.0 | 3/3 | Complete | 2026-01-09 |
| 4. Model Search Dialog | v1.0 | 2/2 | Complete | 2026-01-09 |
| 5. Image URL Server | v1.0 | 2/2 | Complete | 2026-01-09 |
| 6. Video & Polish | v1.0 | 4/4 | Complete | 2026-01-11 |
| 7. Video Connections | v1.1 | 1/1 | Complete | 2026-01-12 |
| 8. Error Display | v1.1 | 1/1 | Complete | 2026-01-12 |
| 9. Video History | v1.1 | 1/1 | Complete | 2026-01-12 |
| 10. Node Autosizing | v1.1 | 0/? | Not started | - |
| 11. UI Polish | v1.1 | 0/? | Not started | - |
| 12. Model Improvements | v1.1 | 0/? | Not started | - |
