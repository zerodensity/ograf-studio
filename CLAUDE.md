# OGraf Studio

OGraf Studio is a browser-based visual editor and deterministic runtime for authoring portable EBU
OGraf-compatible HTML5 broadcast graphics. The current product release is **0.03**.

## Read first

1. `AGENTS.md` — repository working agreement, architectural invariants, verification, and handover
   requirements.
2. `docs/STATUS.md` — current implemented capability and verification truth.
3. `docs/ARCHITECTURE.md` — runtime, editor, persistence, compilation, and certification boundaries.
4. The newest dated file in `docs/handovers/` — current work, decisions, risks, and next actions.
5. `skills/ograf-authoring/SKILL.md` — required contract when an AI agent authors graphics through
   the running OGraf Studio MCP server. It is not the source-development workflow.

`docs/HANDOVER.md` and `docs/PLAN.md` are historical background. Do not treat their old phase
status, package inventory, or next-step lists as current truth when they differ from the files above.

## Durable local facts

- The repository uses **npm workspaces**, not pnpm.
- Run the editor from the repository root with `npm run dev`; the default URL is
  `http://localhost:5173/`.
- Run the optional local MCP server with `npm run mcp:start`; its default endpoint is
  `http://127.0.0.1:4318/mcp`.
- Root `dev`, `mcp:start`, `test`, `build`, and `verify` prebuild
  `packages/ograf-runtime/dist/graphic-runtime.js`.
- If `packages/ograf-runtime/src` changes while the editor dev server is already running, rebuild it
  manually with `npm run build --workspace @ograf-editor/ograf-runtime`; Vite does not rebuild that
  workspace bundle automatically.
- Run `npm run verify` before handoff. MCP schema changes also require
  `npm run contracts:generate`; generated contracts must never be edited by hand.

## File boundary

- `.ogeproj` is versioned editable source and migrates once before entering application state.
- `.ograf.zip` is certified playout output.
- Never bypass the product certification path by manually assembling project JSON or release ZIPs.
