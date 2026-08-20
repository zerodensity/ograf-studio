# Handover — 2026-08-16 — Agent-first P1/P2 authoring

## Outcome

Completed the requested discovery, compact-read, typography-diagnostics, bulk-track, and broadcast
lint additions without changing existing default tool behavior or the certified output gate.

## Added contracts

- `ograf_get_capabilities` now returns all six element schemas/defaults, easing presets, binding
  targets, and empirically checked layer paint order, incoming easing, and top-left origins.
- `ograf_get_project` preserves the full snapshot by default. Explicit section filters and
  `tracks: "animated-only"` omit constant canonical tracks and redundant compatibility layer keys.
- `ograf_measure_text` measures runtime-rendered text at frame-0 authored bounds, reports fragment
  extent, line count, box overflow, fitting-prefix index, and inferred font fallback.
- `ograf_validate_project` keeps its exact old response by default. Opt-in browser overflow stress
  tests and broadcast house rules append warnings but never change OGraf certification validity.
- `set_property_track` replaces or merges a complete property track. `stagger_property_track`
  expands one template across ordered layers with an integer per-layer offset. Both are ordinary
  operations inside revision-checked, dry-runnable atomic batches.

## Safety and compatibility

- All new reads leave revision unchanged and browser-backed reads fail closed when disconnected.
- Full project reads, ordinary validation, and every pre-existing tool signature retain their
  previous defaults.
- Broadcast lint is advisory and opt-in. It is not part of the exact-artifact output gate.
- Capture, strips, and measurement cannot write files or substitute for save/export certification.

## Verification

- Live browser PNG proved higher-index green painted over lower-index red.
- A blue `quad-in` probe advanced slowly at frames 3/6 and accelerated into frame 12, proving key
  easing is incoming against the renderer rather than a source-name inference.
- Missing-font text resolved to `system-ui`; a long Turkish title produced six lines, overflow=true,
  and a fitting prefix while a short title fit on one line. Revision stayed unchanged.
- Whole-track plus stagger batch dry-ran without advancing revision, then committed once and
  generated nine property keys. Subsequent capture/strip/lint/project/certification reads did not
  advance revision.
- Full-HD broadcast lint warned for 18px text, 1.13:1 mid-grey contrast, and a 2px horizontal rule
  when interlaced output was declared.
- Exact-artifact certification passed project, official manifest schema, package layout, module
  API, and realtime/non-realtime lifecycle checks.
- `npm run verify`: 27 test files / 118 tests, formatting, lint, typecheck, and builds pass.
- Repository `ograf-authoring` Skill passes `quick_validate.py`.

## Main files

- `apps/editor/src/state/agentCapture.ts`
- `apps/editor/src/state/agentBridge.ts`
- `apps/mcp-server/src/editorBridge.ts`
- `apps/mcp-server/src/mcpServer.ts`
- `apps/mcp-server/src/schemas.ts`
- `packages/authoring-core/src/types.ts`
- `packages/authoring-core/src/operations.ts`

## Follow-up

Add persisted per-data-field stress values only after deciding whether they belong in the canonical
editor document or editor-only metadata. Current validate-call `testValues` are deliberately
ephemeral and cannot affect saved OGraf output.
