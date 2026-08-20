# Handover — 2026-08-17 — Best-effort OGraf import

## Branch and revision

- Branch: `master`
- Last commit: none; this repository still has no committed baseline.
- PR or issue: linked to Roadmap section 2 and the P1 ZIP re-import limitation.
- Working tree clean: no; the repository baseline and this work remain untracked. Preserve all files.

## Objective

Add an **Import as Editable Project** workflow for real OGraf packages, recovering as much useful
authoring data as possible while making unavoidable losses explicit.

## Completed and verified

- Added **Import OGraf** to the menubar with `.ograf.zip` and multi-file manifest/package selection.
- Prefer a valid embedded `.ogeproj` when a package provides one.
- Statically recover this editor's compiled descriptor from `main.js` without evaluating imported
  JavaScript, reconstructing supported layers, elements, keyframes, independent property tracks,
  effects, loop clips, clipping relationships, data bindings, and lifecycle transitions.
- Recover packaged/data-URI images into the canonical asset registry and rewrite layer/field values
  to `asset:<id>` references.
- Recover project metadata, render requirement dimensions/frame rate, JSON Schema fields, required
  flags, defaults, custom actions, step count, and action-duration timing from the manifest.
- Fall back to a zero-layer editable manifest shell for opaque third-party runtimes, with a clear
  warning that visual JavaScript was not executed or decompiled.
- Added a modal import report containing recovery mode, manifest, layer count, all conversion losses,
  manifest errors, and converted-project validation warnings/errors.
- Added four focused regression tests for descriptor recovery, opaque fallback, embedded source, and
  ambiguous multi-manifest rejection.
- Imported the real `templates/atlas-news-package.ograf.zip`: 24 layers, 13 fields, 2 assets, and its
  animation/loop data were recovered.

## In progress

- None.

## Next actions

1. Consider embedding `.ogeproj` source in future editor exports for truly lossless self-round-trip.
2. Add mappings for any future compiled element types when the scene model gains them.
3. If third-party visual recovery becomes necessary, design a separately consented sandboxed runtime
   inspection mode; do not weaken the current no-execution import boundary silently.

## Decisions made

- Imported JavaScript is never executed during editable conversion. Descriptor extraction accepts
  strict JSON assigned to the editor marker, a static descriptor field, or the documented global
  marker only.
- Authoring-only names, groups, guides, constraints, lock state, and general parent metadata cannot
  be recovered from compiled output and are defaulted with a warning.
- A normal multi-file input is used rather than the File System Access API, supporting ZIP import in
  every target browser and deterministic browser testing.
- Conversion validation is advisory: recoverable projects still open and every issue appears in the
  report so the user can repair it.

## Important files changed

- `apps/editor/src/state/importOgraf.ts`
- `apps/editor/src/state/importOgraf.test.ts`
- `apps/editor/src/panels/Menubar.tsx`
- `apps/editor/src/panels/Menubar.css`
- `docs/STATUS.md`
- `docs/KNOWN_ISSUES.md`
- `docs/ROADMAP.md`

## Verification

- `npm run verify`: passed — formatting, lint, every workspace typecheck, 42 test files / 190 tests,
  runtime build, and editor production build. The existing large-editor-chunk warning remains.
- Manual or external OGraf verification: browser-imported the real Atlas `.ograf.zip` on an isolated
  port; the report showed 24 editable layers and 6 explicit warnings, both images appeared in
  Resources, and the browser console had no warnings or errors.

## Known failures and risks

- Arbitrary third-party `main.js` implementations are opaque and import as manifest-only shells.
- Compiled output does not retain authoring-only metadata; inferred text/generic layer names may need
  manual cleanup.
- Generic JSON Schema object/array fields are represented as JSON textarea values unless they match
  the editor's structured gradient model.
- Import memory is capped at 128 MB of expanded selected package data; very large packages fail with
  an explicit error.

## Environment and generated artifacts

- Primary editor remained available at `http://localhost:5173/`.
- Browser smoke testing used a temporary isolated editor on port 5174 with its MCP bridge disabled;
  the temporary server was stopped afterward.
- Normal Vite/TypeScript build artifacts were refreshed by `npm run verify`.

## Uncommitted work

- All files above remain uncommitted in the repository's existing no-baseline worktree.
