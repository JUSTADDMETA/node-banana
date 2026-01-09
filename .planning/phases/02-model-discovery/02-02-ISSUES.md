# UAT Issues: Phase 02 Plan 02

**Tested:** 2026-01-09
**Source:** .planning/phases/02-model-discovery/02-02-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

[None]

## Resolved Issues

### UAT-001: fal.ai API route returns 400 error due to multiple category parameters

**Discovered:** 2026-01-09
**Phase/Plan:** 02-02
**Severity:** Major
**Resolved:** 2026-01-09 - Fixed in 02-02-FIX.md
**Commit:** 2fe312d

**Description:** The fal.ai models API route constructs a URL with multiple `category=` parameters (text-to-image, image-to-image, text-to-video, image-to-video), but fal.ai's API only accepts a single category parameter. This causes a 400 validation error.

**Fix:** Removed `buildCategoryFilter()` function. Now fetches all active models without category filter and relies on existing `isRelevantModel()` function to filter results client-side.

---

*Phase: 02-model-discovery*
*Plan: 02*
*Tested: 2026-01-09*
