# Roadmap: Node Banana Multi-Provider Support

## Overview

Transform Node Banana from a Gemini-only image generator into a multi-provider platform supporting Replicate and fal.ai. The journey builds provider infrastructure first, then adds dynamic model discovery, refactors the generate node for flexibility, creates a searchable model browser, adds local image serving for URL-based providers, and finishes with video support and polish.

## Domain Expertise

None

## Milestones

- ✅ **v1.0 Multi-Provider Support** - Phases 1-6 (shipped 2026-01-11)
- ✅ **v1.1 Improvements** - Phases 7-14 (shipped 2026-01-12)
- 🚧 **v1.2 Improvements** - Phases 15-23 (in progress)

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

<details>
<summary>✅ v1.1 Improvements (Phases 7-14) - SHIPPED 2026-01-12</summary>

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

#### Phase 10: Node Autosizing ✅

**Goal**: Auto-size nodes to output dimensions and aspect ratio
**Depends on**: Phase 9
**Research**: Unlikely (React Flow node sizing)
**Plans**: 1 plan

Plans:
- [x] 10-01: Node dimension utility and auto-resize on output

#### Phase 11: UI Polish ✅

**Goal**: Flora UI alignment, header UI improvements, project settings, provider logos on nodes
**Depends on**: Phase 10
**Research**: Unlikely (internal UI work)
**Plans**: 1 plan

Plans:
- [x] 11-01: Provider badges on nodes and header UI streamlining

#### Phase 12: Model Improvements ✅

**Goal**: Verify Replicate image models work, extend model cache TTL
**Depends on**: Phase 11
**Research**: Likely (Replicate API behavior verification)
**Research topics**: Replicate image model endpoints, cache invalidation strategies
**Plans**: 1 plan

Plans:
- [x] 12-01: Extended cache TTL, fixed isImageInput, fixed stale node data in execution

#### Phase 13: Fix Duplicate Generations ✅

**Goal**: Fix image deduplication - generations folder has duplicate images due to hashing failure
**Depends on**: Phase 12
**Research**: Likely (investigate current hashing implementation)
**Research topics**: Current save-generation hashing logic, why duplicates are being created
**Plans**: 1 plan

Plans:
- [x] 13-01: Add MD5 content hashing and deduplication to save-generation API

#### Phase 14: Fix Drag-Connect Node Creation Bugs ✅

**Goal**: Fix bugs with nodes created via drag-connect: (1) connection vanishes after selecting model from browser, (2) defaults to Gemini with missing model selector in header
**Depends on**: Phase 13
**Research**: Unlikely (React Flow connection state, node creation flow)
**Research topics**: Connection state during node creation, model selection callbacks, createDefaultNodeData initialization
**Plans**: 1 plan

Plans:
- [x] 14-01: Normalize dynamic handle IDs and fix connection persistence

</details>

### 🚧 v1.2 Improvements (In Progress)

**Milestone Goal:** Add automated testing across the application and modularize large monolithic files for better maintainability

#### Phase 15: Test Infrastructure

**Goal**: Set up testing framework with Vitest and React Testing Library for Next.js 16
**Depends on**: Phase 14
**Research**: Likely (Vitest + Next.js 16 App Router setup)
**Research topics**: Vitest configuration for Next.js 16, React Testing Library setup, test file organization
**Plans**: TBD

Plans:
- [x] 15-01: React Testing Library setup and configuration

#### Phase 16: Store Modularization ✅

**Goal**: Break up workflowStore.ts into focused modules (execution, nodes, edges, persistence)
**Depends on**: Phase 15
**Research**: Unlikely (internal Zustand patterns)
**Plans**: 1 plan

Plans:
- [x] 16-01: Extract localStorage helpers and node defaults to utility modules

#### Phase 17: Component Tests

**Goal**: Add tests for all 34 React components covering nodes, toolbars, modals, and edges
**Depends on**: Phase 16
**Research**: Unlikely (established React Testing Library patterns)
**Plans**: 11 plans

Plans:
- [x] 17-01: Core Nodes (BaseNode, PromptNode, ImageInputNode)
- [x] 17-02: Display Nodes (OutputNode, SplitGridNode, GroupNode)
- [x] 17-03: Generate Nodes (GenerateImageNode, GenerateVideoNode)
- [x] 17-04: Processing Nodes (LLMGenerateNode, AnnotationNode)
- [x] 17-05: Toolbars (Header, FloatingActionBar, MultiSelectToolbar)
- [x] 17-06: Canvas & Edges (WorkflowCanvas, EditableEdge, ReferenceEdge, EdgeToolbar)
- [x] 17-07: Menus & Notifications (ConnectionDropMenu, Toast, CostIndicator)
- [x] 17-08: Core Modals (ModelSearchDialog, ProjectSetupModal, CostDialog)
- [x] 17-09: Editor Modals (PromptEditorModal, SplitGridSettingsModal, AnnotationModal)
- [x] 17-10: Quickstart (WelcomeModal, QuickstartInitialView, QuickstartTemplatesView, PromptWorkflowView, QuickstartBackButton)
- [x] 17-11: Utilities (GlobalImageHistory, GroupsOverlay, ModelParameters)

#### Phase 18: API Route Tests

**Goal**: Add tests for generate, llm, models, and workflow API routes
**Depends on**: Phase 17
**Research**: Unlikely (Next.js API route testing patterns)
**Plans**: 5 plans

Plans:
- [x] 18-01: File I/O routes (workflow, save-generation)
- [x] 18-02: LLM route (Google, OpenAI providers)
- [x] 18-03: Generate route (Gemini provider)
- [x] 18-04: Generate route (Replicate, fal.ai providers)
- [x] 18-05: Models route (caching, aggregation)

#### Phase 19: Type Refactoring

**Goal**: Split types/index.ts into domain-specific type files (nodes, providers, workflow)
**Depends on**: Phase 18
**Research**: Unlikely (internal refactoring)
**Plans**: 2 plans

Plans:
- [x] 19-01: Extract node and annotation types
- [x] 19-02: Extract provider, workflow, API, and model types

#### Phase 20: Integration Tests

**Goal**: End-to-end workflow execution tests covering node connections and data flow
**Depends on**: Phase 19
**Research**: Unlikely (internal testing patterns)
**Plans**: TBD

Plans:
- [ ] 20-01: TBD (run /gsd:plan-phase 20 to break down)

#### Phase 21: Fix Image Input & Deduplication Issues

**Goal**: Fix Gemini nano-banana-pro model ignoring image inputs and resolve duplicate image saving across input/generated images
**Depends on**: Phase 20
**Research**: Likely (Gemini API image input handling, current hashing implementation)
**Research topics**: Gemini 3 Pro image generation API requirements, why image inputs are ignored, current save logic for inputs vs generations
**Plans**: 1 plan

**Issues:**
1. ~~nano-banana-pro model generates without considering image inputs~~ - RESOLVED (no longer an issue)
2. Input and generated images have duplicate files despite different hashes - need consistent hashing approach matching video saving
3. Generated images should be prepended with prompt details like generated videos

Plans:
- [x] 21-01: Unify MD5 hashing for image deduplication

#### Phase 22: Generate Node Dynamic Input Tests

**Goal**: Test that generate nodes properly validate and render dynamic inputs from provider schemas, and that all inputs/parameters are correctly included in API calls
**Depends on**: Phase 21
**Research**: Unlikely (existing test patterns from Phase 17)
**Plans**: 1 plan

**Test coverage:**
1. Dynamic inputs from provider schemas render correctly as parameters and input handles on node creation
2. Validation of dynamic inputs (required fields, type checking, constraints)
3. Standard inputs (image, text) validate properly
4. On submission, all parameters and inputs are included in API call payload correctly (covered by Phase 18)
5. Coverage across all providers (Gemini, Replicate, fal.ai)

Plans:
- [x] 22-01: ModelParameters tests, GenerateImageNode/GenerateVideoNode dynamic handle tests

#### Phase 23: Model Browser Improvements

**Goal**: Improve model browser UX with recently used models section, icon-based provider dropdown with Gemini, and include Gemini models in browse list
**Depends on**: Phase 22
**Research**: Unlikely (existing UI patterns)
**Plans**: TBD

**Features:**
1. Recently used models section at top of browse dialog showing last 4 models used
2. Provider dropdown uses icons instead of text, add Gemini to the provider list
3. Include Gemini models (nano-banana, nano-banana-pro) in the browsable model list alongside Replicate/fal.ai models

Plans:
- [ ] 23-01: TBD (run /gsd:plan-phase 23 to break down)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → ... → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 23

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
| 10. Node Autosizing | v1.1 | 1/1 | Complete | 2026-01-12 |
| 11. UI Polish | v1.1 | 1/1 | Complete | 2026-01-12 |
| 12. Model Improvements | v1.1 | 1/1 | Complete | 2026-01-12 |
| 13. Fix Duplicate Generations | v1.1 | 1/1 | Complete | 2026-01-12 |
| 14. Fix Drag-Connect Node Creation Bugs | v1.1 | 1/1 | Complete | 2026-01-12 |
| 15. Test Infrastructure | v1.2 | 1/1 | Complete | 2026-01-12 |
| 16. Store Modularization | v1.2 | 1/1 | Complete | 2026-01-12 |
| 17. Component Tests | v1.2 | 11/11 | Complete | 2026-01-13 |
| 18. API Route Tests | v1.2 | 5/5 | Complete | 2026-01-13 |
| 19. Type Refactoring | v1.2 | 2/2 | Complete | 2026-01-13 |
| 20. Integration Tests | v1.2 | 0/? | Not started | - |
| 21. Fix Image Input & Deduplication | v1.2 | 1/1 | Complete | 2026-01-13 |
| 22. Generate Node Dynamic Input Tests | v1.2 | 1/1 | Complete | 2026-01-13 |
| 23. Model Browser Improvements | v1.2 | 0/? | Not started | - |
