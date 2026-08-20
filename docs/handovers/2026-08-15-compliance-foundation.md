# Handover — Compliance Foundation

Date: 2026-08-15  
Milestone: OGraf lifecycle and architecture hardening

## Outcome

The project now has an explicit Start → zero-or-more Step → End state model. Legacy documents are
migrated to document version 2. Editor preview and exported playout use the same compiled descriptor
and runtime timeline builder. Non-realtime schedules and image sequences are timestamp-derived.
Canonical EBU schema validation and semantic project validation block invalid ZIP exports.

## Important implementation points

- `packages/scene-model/src/migrations.ts` is the entry point for upgrading parsed projects.
- `packages/ograf-runtime/src/lifecycle.ts` is the pure lifecycle resolver used by realtime actions
  and schedule replay.
- `packages/codegen/src/compileDescriptor.ts` defines the preview/export boundary.
- `packages/ograf-runtime/src/buildRuntimeTimeline.ts` is the sole GSAP timeline interpreter.
- `packages/validation/src/officialSchemas.ts` exposes the vendored canonical schema set.
- `apps/editor/src/state/exportPackage.ts` blocks invalid exports and extracts embedded resources.
- `apps/editor/vite.config.ts` rebuilds the export runtime when runtime source changes in dev.

## Verification

Run `npm run verify`. At handover, typecheck, 46 tests, lint, formatting, and production build pass.
The build reports a non-fatal editor chunk-size warning (about 978 kB minified).

Manual local-browser smoke testing also passed: Start → Step 1 → End returned the correct optional
`currentStep`, and a scheduled non-realtime take sought to 0.5 opacity halfway through its transition
and 1.0 after completion. The browser console remained clean.

## Next work

Continue Roadmap phase 2 with runtime DOM/concurrency and ZIP smoke tests, then browser E2E. After
that, implement the complete broadcaster-facing inventory in phases 3–5; do not collapse or omit
items from `docs/ROADMAP.md`.

## Risks

- Asset bytes are removed from exported `main.js` but remain data URIs in saved/autosaved projects.
- Scheduled non-realtime behavior has pure lifecycle coverage but still needs a DOM-level renderer
  contract suite.
- The old `docs/HANDOVER.md` is retained as historical context and contains obsolete limitations.
