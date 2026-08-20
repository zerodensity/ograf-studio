# Handover — 2026-08-16 — Agent-first P0 PNG capture

## Objective

Give MCP agents pixel-level feedback from the authoritative browser renderer while preserving the
existing optimistic-concurrency and certified-output safety boundaries.

## Completed and verified

- Added `ograf_capture` with composition and viewport targets.
- Composition capture uses the shared DOM element renderer, canonical property/effect evaluator,
  deterministic image-sequence sampling, field defaults, and non-mutating `dataOverrides`.
- PNG is the P0 output format. Transparent matte retains alpha; checker and `#RRGGBB` mattes
  composite diagnostic backgrounds without changing the project.
- Added max-dimension downscaling, natural/rendered dimensions, inferred font fallback metadata,
  five-minute random localhost URLs, and opt-in inline MCP image content.
- Browser capture fails closed when the editor is disconnected. Save/export certification remains
  a separate mandatory exact-artifact gate.
- Added browser content-host cleanup so repeated shrink-to-fit captures do not retain
  `ResizeObserver` instances.
- Updated the repository OGraf authoring Skill to prefer PNG capture over the legacy SVG snapshot.

## Live verification

- Built a 640×360 animated, data-bound, two-layer fixture exclusively through MCP operations.
- Transparent/checker/magenta captures returned different PNG pixels; the transparent corner had
  alpha 0 and both diagnostic mattes had alpha 255.
- `dataOverrides.headline` changed the captured text without changing revision (3 before and after).
- A deliberately missing first font resolved to the next available `system-ui` family and was
  labeled `resolution: "inferred"`.
- Viewport capture returned the complete editor chrome at 900×506 from a 1280×720 viewport.
- An MCP SDK client received a valid inline `image/png` block at 320×180.
- The fixture also passed all five live exact-artifact gates: project, official manifest schema,
  package, module/API, and realtime/non-realtime lifecycle.
- `npm run verify` passed: formatting, lint, all workspace typechecks, 27 test files / 114 tests,
  and production builds. The existing large editor-chunk warning remains unchanged.

## Important implementation files

- `apps/editor/src/state/agentCapture.ts`
- `apps/editor/src/state/agentBridge.ts`
- `apps/mcp-server/src/editorBridge.ts`
- `apps/mcp-server/src/mcpServer.ts`
- `apps/mcp-server/src/index.ts`
- `packages/ograf-runtime/src/renderElement.ts`

## Next action

Implement P0 `ograf_render_strip` on the same browser rasterization path. It must remain read-only,
return one PNG contact sheet, and be verified with a deliberately missing hold key.

## Known limitation discovered during verification

The bridge has one live browser owner. Multiple editor tabs replace one another and can increment
the live session revision as they reconnect. Isolated verification used MCP port 4319 and editor
port 5175 to avoid disturbing the user's active editor session.
