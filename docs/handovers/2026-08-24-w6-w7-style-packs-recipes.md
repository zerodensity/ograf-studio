# Handover — 2026-08-24 — W6/W7 style packs and recipes

## Branch and revision

- Branch: `codex/ai-first-authoring`
- Last commit: `009c256 feat: add broadcast style packs and recipes`
- PR or issue: none; local checkpoint, not pushed in this turn
- Working tree clean: no; three unrelated user-owned files remain intentionally uncommitted

## Objective

Implement W6 broadcast style packs and W7's materialized bug, ticker, scoreboard, and clock recipes
without requiring user-supplied design assets.

## Completed and verified

- Added immutable News, Sports, Entertainment, and Documentary catalog definitions with palette,
  modular 1080-line type scale, font stack/weights, radius/outline, and editable motion conventions.
- Added `apply_style_pack` through scene model, authoring core, MCP schema/results/capabilities,
  Resources panel, and editor store. Applying a pack copies or refreshes normal editable Brand Kit
  tokens, synchronizes existing consumers, and materializes compatible semantic layer properties.
- Extended shared motion presets with optional entrance/exit duration and easing conventions while
  retaining existing lower-third defaults and deterministic lifecycle boundaries.
- Added materialized `create_bug`, `create_ticker`, `create_scoreboard`, and `create_clock`
  operations plus a compact Recipe selector in the canvas toolbar.
- Every recipe creates ordinary editable layers, constrained fields, semantic roles/tags,
  persistent canvas grouping, one Timeline Group, complete result mappings, and style-pack-aware
  motion. Lower thirds also accept an optional style pack.
- Ticker crawl motion is one absolute-time local X loop inside a `clipChildren` window; its finite
  lifecycle X track remains static. Score values use document-v20 text outlines.
- Updated README, status, architecture, roadmap, unreleased notes, generated MCP contracts, and the
  bundled `ograf-authoring` skill; validated and rebuilt the skill archive.

## In progress

None. W4 and W11 were not started.

## Next actions

1. Wait for explicit user direction and visual references before starting W4's golden template
   corpus/template tools.
2. Keep W11 headless render/certify gated until the user explicitly authorizes it.

## Decisions made

- Pack definitions are immutable code/catalog data; applied project tokens are editable starting
  points, not locks.
- Canonical pack tokens are composition-local and materialize into existing standard element
  properties. Pack identity and recipe machinery never compile into OGraf output.
- One composition owns one current pack vocabulary. Explicitly changing packs refreshes and
  rematerializes existing linked semantic layers; recipes without an explicit pack reuse edited
  current tokens.
- The four recipe variants share one compact MCP schema branch to keep the generated contract below
  the W2 context budget.
- Editor recipe entry uses one dropdown rather than four additional toolbar buttons.

## Important files changed

- `packages/scene-model/src/stylePacks.ts`, `broadcastRecipes.ts`, `motionPresets.ts`
- `packages/scene-model/src/semanticRecipes.ts`, `designSystem.ts`
- `packages/authoring-core/src/types.ts`, `operations.ts`, `session.ts`
- `packages/agent-tools/src/schemas.ts`, `toolRecords.ts`
- `apps/editor/src/state/projectStore.ts`
- `apps/editor/src/panels/ResourcesPanel.tsx`
- `apps/editor/src/canvas/AddElementToolbar.tsx`
- `skills/ograf-authoring/`
- `README.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `docs/releases/NEXT.md`, `docs/generated/mcp-contracts.json`

## Verification

- `npm run verify`: passed; contract drift, formatting, lint, all workspace typechecks, **300 tests
  across 58 files**, runtime bundle, and editor production build. The documented large editor-chunk
  advisory remains.
- Live package: Sports scoreboard, clock, bug, and ticker rendered together at the first Step and
  scored 99/100 deterministic design QA.
- Ticker sample: local loop duration 472 frames; crawl X moved from 1800 at loop start to -468 at
  half-loop while the finite lifecycle X track stayed constant.
- All five exact dual-profile certification gates passed. The temporary session was deleted.
- Generated MCP contract: 146,632 bytes, below the enforced 150,000-byte budget.
- Runtime dependency check: authoring-only catalog/recipe initialization is fully tree-shaken; the
  runtime remains exactly 614.78 kB (133.45 kB gzip), matching the W8 baseline.

## Known failures and risks

- No known W6/W7 functional failure remains.
- The supplied packs are neutral professional starting points, not substitutes for a broadcaster's
  real brand guide. Their copied tokens are intentionally editable.
- A deterministic capture at the exact first Step shows the ticker before loop time has advanced;
  loop sampling and realtime playback provide the actual crawl motion.

## Environment and generated artifacts

- Editor dev server remains available on port 5173.
- MCP server remains healthy on port 4318 with an editor connected.
- Live proof image: `%TEMP%\ograf-w67-live.png`.
- Current public release remains 0.05; W6/W7 are recorded in `docs/releases/NEXT.md`.

## Uncommitted work

- `CLAUDE.md` — pre-existing user-owned modification
- `docs/handovers/2026-08-24-ai-first-quality-program.md` — pre-existing user-owned modification
- `docs/decisions/ADR-007-declarative-conditional-visibility.md` — pre-existing user-owned untracked
  file
