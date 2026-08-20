# Handover — 2026-08-16 — Codex

## Branch and revision

- Branch: repository has no established committed baseline
- Last commit: none
- PR or issue: none
- Working tree clean: no; the project remains an uncommitted working tree by prior user choice

## Objective

Make the OGraf editor safely usable by AI agents through MCP and provide a reusable Skill, without
creating a second document model or any path around mandatory OGraf certification.

## Completed and verified

- Added framework-neutral `packages/authoring-core` with atomic operations, revisions, dry runs,
  agent undo/redo, external-editor synchronization, validation, summaries, and SVG frame rendering.
- Added localhost `apps/mcp-server` with read/inspect/render/validate, project-session,
  revision-checked mutation, undo/redo, certification, save, and export tools.
- Added a live WebSocket editor bridge and visible menubar agent status.
- Shared exact artifact compilation between browser UI and MCP output.
- Confined MCP paths to the workspace; added confirmation/overwrite policy and fail-closed browser
  certification for all MCP file output.
- Added and validated `skills/ograf-authoring` with MCP dependency metadata and workflow references.
- Added ADR-003 and updated architecture, roadmap, and status documentation.

## In progress

- No implementation item is intentionally left half-complete in this slice.

## Next actions

1. Add headless cross-browser certification CI and agent task/evaluation fixtures.
2. Add authenticated authorization before any non-local or multi-user MCP deployment.
3. Extend asset/font ingestion through bounded resource operations without accepting arbitrary URLs.

## Decisions made

- React remains an adapter; authoring semantics live in a framework-neutral core.
- Optimistic revisions and atomic batches replace last-write-wins behavior.
- Human UI history and agent transaction history remain separate; a human edit invalidates agent
  undo history because it changes the transaction base.
- Browser exact-artifact lifecycle certification remains mandatory and cannot be bypassed by MCP.

## Important files changed

- `packages/authoring-core/src/`
- `packages/codegen/src/buildExportArtifacts.ts`
- `apps/mcp-server/src/`
- `apps/editor/src/state/agentBridge.ts`
- `skills/ograf-authoring/`
- `docs/decisions/ADR-003-agent-authoring-mcp.md`

## Verification

- `npm run verify`: passed (format, lint, typecheck, 111 tests, and production build)
- MCP SDK integration: tool discovery, atomic mutation, and stale-revision rejection covered
- Skill validation: passed
- Manual or external OGraf verification: live MCP mutation synchronized into the browser; exact
  artifacts passed project, official manifest schema, package, module/API, and realtime/non-realtime
  lifecycle checks; MCP undo restored the original browser document.

## Known failures and risks

- Certification/save/export intentionally fail when no live browser editor is connected.
- MCP is local-only and unauthenticated; do not bind it to a network interface.
- Element content patches are structurally generic at the MCP boundary; project/output validation
  remains the final guard and richer per-element input schemas are a follow-up hardening item.

## Environment and generated artifacts

- Default MCP endpoint: `http://127.0.0.1:4318/mcp`
- Editor bridge: `ws://127.0.0.1:4318/editor`
- Override workspace with `OGRAF_WORKSPACE_ROOT`; override port with `OGRAF_MCP_PORT`.

## Uncommitted work

- All repository content is uncommitted; do not reset or clean it.
