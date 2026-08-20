# Handover — 2026-08-16 — Preview data and asset parity

## Branch and revision

- Branch: repository has no established committed baseline; all files remain untracked.
- Last commit: none in the current workspace baseline.
- Working tree clean: no — preserve the user's existing work and do not reset it.

## Objective

Fix visual differences between Edit, the new main-canvas OGraf Preview, and Preview & Export,
specifically missing data-bound local images and different data-bound colors/gradients.

## Root cause

- Runtime preview `load()` received image-url defaults such as `asset:<id>` verbatim. That is an
  editor source reference rather than a browser URL, so the runtime `<img>` completed with natural
  dimensions 0×0.
- Edit mode applied only explicitly stored Test Data values and ignored field defaults. Runtime
  preview intentionally sent field defaults, so a bound layer could use its authored fallback in
  Edit and its field default in OGraf Preview.
- In the captured Atlas template, `Photo Image` authored one portrait but its `portrait` field
  default selected `reporter-portrait-v2`. `Main Bar` authored a blue-to-navy fallback while the
  `bar_paint` field default is blue-to-white. The discrepancy exposed both code paths.

## Completed and verified

- Added a shared preview-data resolver. Explicit test values win over declared field defaults while
  preserving falsey values such as `0`, `false`, and the empty string.
- Image-url values are resolved against `composition.assets` before in-editor Graphic calls. The
  main preview and Preview & Export now send data URIs rather than `asset:<id>` references.
- LayerNode/Edit rendering now evaluates the same declared defaults when no explicit Test Data value
  exists and resolves local image references through the same asset table.
- No project fields, authored layer values, asset selection, or colors were changed.

## Verification

- Browser capture before the fix reproduced the missing portrait. Shadow-DOM inspection showed
  `src="asset:…"`, `complete: true`, and natural dimensions 0×0.
- Browser capture after the fix showed the same portrait and bar paint in Edit and main OGraf
  Preview. The runtime image used an embedded SVG data URI and reported 150×150 natural dimensions.
- The older Preview & Export runtime was exercised separately and reported the same healthy 150×150
  image.
- Full `npm run verify`: passed — formatting, lint, all workspace typechecks, 41 test files / 186
  tests, runtime build, and editor production build. Only the existing large-editor-chunk warning
  remains.

## Important files changed

- `apps/editor/src/state/{previewData,dataBinding}.ts`
- `apps/editor/src/state/{previewData,dataBinding}.test.ts`
- `apps/editor/src/canvas/{LayerNode,Stage,RuntimePreviewStage}.tsx`
- `apps/editor/src/panels/PreviewExportPanel.tsx`
- `docs/{STATUS,ARCHITECTURE}.md`

## Known limitations and risks

- A field default may intentionally differ from an element's authored fallback. All editor preview
  surfaces now consistently show the field default; an OGraf host that supplies no key at all still
  leaves the runtime's authored fallback available.
- Local `asset:<id>` is an editor-source convention. Externally supplied playout data should use a
  renderer-accessible URL; package defaults continue to be rewritten to packaged relative paths.

## Environment

- Browser verification used a temporary `http://localhost:5173/` tab, which was closed afterward.
- MCP remained listening at `http://127.0.0.1:4318/mcp`.

## Next milestone

- Consider a Data-panel diagnostic when a bound field default materially differs from the authored
  fallback, so deliberate fallback/default designs are easier to understand.
