# Roadmap: Node Banana Multi-Provider Support

## Overview

Transform Node Banana from a Gemini-only image generator into a multi-provider platform supporting Replicate and fal.ai. The journey builds provider infrastructure first, then adds dynamic model discovery, refactors the generate node for flexibility, creates a searchable model browser, adds local image serving for URL-based providers, and finishes with video support and polish.

## Domain Expertise

None

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Provider Infrastructure** - API key storage and provider settings UI ✓
- [x] **Phase 2: Model Discovery** - Dynamic model fetching from Replicate/fal.ai APIs ✓
- [ ] **Phase 3: Generate Node Refactor** - Rename NanoBanana to generic Generate with multi-model support
- [ ] **Phase 4: Model Search Dialog** - Floating action bar icons and searchable model browser
- [ ] **Phase 5: Image URL Server** - Local endpoint serving images as URLs for providers
- [ ] **Phase 6: Video & Polish** - Video playback, parameter customization, edge cases

## Phase Details

### Phase 1: Provider Infrastructure
**Goal**: Users can configure Replicate and fal.ai API keys in settings, with keys securely stored
**Depends on**: Nothing (first phase)
**Research**: Unlikely (internal UI patterns, Zustand state management)
**Plans**: TBD

Plans:
- [x] 01-01: Provider settings UI in ProjectSetupModal
- [x] 01-02: Provider abstraction layer and types

### Phase 2: Model Discovery
**Goal**: App can fetch and cache available models from enabled providers at runtime
**Depends on**: Phase 1
**Research**: Likely (external APIs)
**Research topics**: Replicate model listing API endpoints, fal.ai model discovery endpoints, response schemas and pagination
**Plans**: TBD

Plans:
- [x] 02-01: Replicate model fetching API route
- [x] 02-02: fal.ai model fetching API route
- [x] 02-03: Model caching and unified model interface

### Phase 3: Generate Node Refactor
**Goal**: NanoBanana node becomes GenerateImage node supporting any provider's image models
**Depends on**: Phase 2
**Research**: Unlikely (internal refactoring using existing patterns)
**Design decision**: Separate nodes for image vs video generation (GenerateVideo added in Phase 6)

Plans:
- [x] 03-01: Rename NanoBanana to GenerateImage, add model selector (image models only)
- [ ] 03-02: Provider-specific execution in generate API route
- [ ] 03-03: Backward compatibility for existing workflows

### Phase 4: Model Search Dialog
**Goal**: Users can browse models via floating action bar icons and searchable dialog
**Depends on**: Phase 3
**Research**: Unlikely (internal UI using React patterns)
**Plans**: TBD

Plans:
- [ ] 04-01: Floating action bar with provider icons
- [ ] 04-02: Model search dialog with filtering and selection

### Phase 5: Image URL Server
**Goal**: Local API endpoint serves workflow images as URLs for providers requiring URL inputs
**Depends on**: Phase 3
**Research**: Unlikely (Next.js API routes, existing patterns)
**Plans**: TBD

Plans:
- [ ] 05-01: Image serving endpoint and URL generation
- [ ] 05-02: Integration with generate node for URL-based providers

### Phase 6: Video & Polish
**Goal**: GenerateVideo node for video generation, video playback, custom parameters, edge cases
**Depends on**: Phase 5
**Research**: Likely (video handling)
**Research topics**: HTML5 video element for base64/blob URLs, provider response formats for video content
**Design decision**: GenerateVideo as separate node type (not combined with GenerateImage)

Plans:
- [ ] 06-01: GenerateVideo node with video-capable model selector
- [ ] 06-02: Video playback in output node
- [ ] 06-03: Custom model parameters from provider schemas
- [ ] 06-04: Edge case handling and final polish

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Provider Infrastructure | 2/2 | Complete | 2026-01-09 |
| 2. Model Discovery | 3/3 | Complete | 2026-01-09 |
| 3. Generate Node Refactor | 1/3 | In progress | - |
| 4. Model Search Dialog | 0/2 | Not started | - |
| 5. Image URL Server | 0/2 | Not started | - |
| 6. Video & Polish | 0/4 | Not started | - |
