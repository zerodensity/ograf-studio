# Handover — 2026-08-24 — Codex

## Branch and revision

- Branch: `codex/ai-first-authoring`
- Last commit: release commit containing this handover (`HEAD`)
- PR or issue: none
- Working tree clean: yes after the release commit

## Objective

Implement the first nine AI-first improvement areas for OGraf Studio while explicitly deferring
area 10, headless render/certify.

## Completed and verified

- Added semantic roles, tags, intent, semantic scene query, and a materialized lower-third recipe.
- Added rendered operation dry runs and revision-checked visual proposals requiring explicit human
  Accept or Reject in the editor.
- Generated Markdown/JSON MCP contracts from the registered server schemas; drift is the first
  `npm run verify` gate and generated output is Prettier-canonical.
- Moved portable SVG bundle import into the shared scene model and added workspace-confined MCP
  asset and Photoshop SVG/CSS/image/font bundle imports with bounded payloads.
- Added composition Brand Kits, typed design tokens, compatible layer-property bindings, and
  materialized portable element values.
- Added optional authoring-linked component instances with explicit snapshot update and instance
  refresh; independent instances remain supported and compiled output stays ordinary OGraf layers.
- Added finite horizontal/vertical repeater recipes that materialize grouped layers, cloned fields,
  complete mappings, and semantic item/index tags.
- Added deterministic design/motion QA with stable findings, scoring, preview frames, and optional
  browser contact sheets.
- Added the editor Agent Review panel and bridge proposal lifecycle, including reconnect
  presentation, expiry/rejection, and stale-revision protection.
- Updated README, skill/reference guidance, roadmap, status, known issues, 0.03 release notes, and
  the portable `ograf-authoring.zip` skill bundle.

## In progress

- No code remains in progress for areas 1-9.

## Next actions

1. Review the new editor UX against a production graphic and adjust recipe/QA heuristics from real
   usage rather than expanding them speculatively.
2. Monitor production use and GitHub feedback for focused follow-up fixes.
3. Do not implement area 10 until the user explicitly resumes headless render/certify work.

## Decisions made

- Semantic roles, token links, component links, and repeater provenance are authoring metadata;
  exported templates remain ordinary portable OGraf content.
- Design-token values are materialized immediately into compatible element properties.
- Linked components refresh explicitly and replacement-based; no live master exists at playout.
- Repeaters materialize a finite collection at authoring time rather than introducing a proprietary
  runtime array primitive.
- Visual dry runs never mutate project state. Human proposals apply the exact previewed operations
  only after acceptance and only when the original base revision is still current.
- Generated MCP references are derived from actual registered tool contracts, not maintained by
  hand.

## Important files changed

- `packages/scene-model/src/types.ts`
- `packages/scene-model/src/semanticRecipes.ts`
- `packages/scene-model/src/designSystem.ts`
- `packages/scene-model/src/components.ts`
- `packages/scene-model/src/repeaterRecipes.ts`
- `packages/scene-model/src/designQa.ts`
- `packages/scene-model/src/svgBundleImport.ts`
- `packages/authoring-core/src/operations.ts`
- `apps/mcp-server/src/mcpServer.ts`
- `apps/mcp-server/src/editorBridge.ts`
- `apps/editor/src/panels/AgentReviewPanel.tsx`
- `scripts/generateMcpContracts.ts`
- `docs/generated/mcp-contracts.md`

## Verification

- `npm run verify`: passed — generated-contract drift, formatting, lint, all workspace typechecks,
  228 tests in 51 files, runtime bundle, and editor production build.
- Focused resumed checks: 61 authoring, migration, and MCP integration tests passed.
- Skill validation: `quick_validate.py` passed; `ograf-authoring.zip` was rebuilt and its contents
  inspected.
- Manual or external OGraf verification: not performed in this pass; automated MCP browser bridge
  tests cover projected preview and explicit proposal acceptance.

## Known failures and risks

- The editor build still reports the existing large-chunk advisory.
- Visual dry runs/proposals and exact certification require a connected, responsive editor; area 10
  headless render/certify remains deferred.
- Linked refresh can replace local instance edits; use independent instances when overrides must
  persist.
- Repeaters are author-time finite collections, not runtime arrays.
- Semantic/design QA is deterministic and useful, but remains advisory rather than an editorial or
  compliance guarantee.

## Environment and generated artifacts

- Windows, Node.js 22.21.0, npm workspaces.
- `docs/generated/mcp-contracts.json` and `.md` contain 28 registered tools and must be regenerated
  with `npm run contracts:generate`, never edited directly.
- `packages/ograf-runtime/dist` and editor `dist` remain generated/ignored build outputs.

## Uncommitted work

- None expected after the release commit.
