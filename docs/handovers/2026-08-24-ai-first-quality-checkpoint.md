# AI-first quality programme checkpoint

Date: 2026-08-24

Branch: `codex/ai-first-authoring`

This is the resume point requested after completing W9. The implementation is local and committed;
it has not been pushed or released in this checkpoint.

## Completed in this sequence

1. C0a — extracted transport-neutral tool records and ports into `packages/agent-tools`
   (`01b9ca9`).
2. C0b/W2 — consolidated apply, dry-run, preview, and propose into one
   `ograf_apply_operations` contract (`a44c4f0`).
3. Refreshed the two bundled templates through OGraf Studio/MCP. Both now exercise semantic roles,
   operator-safe field constraints, blend modes, cubic motion, and explicit QA intent; both score
   99/100 with only the advisory padding-rhythm finding (`8754477`).
4. W10 — added optional `sections` to `ograf_get_capabilities`; omitting it preserves the complete
   response (`4b62269`).
5. W9 — added `includeReview: true` for apply/dry-run. The result contains deterministic design QA
   plus a short-lived capture URL when available. Disconnected, unresponsive, or failed capture
   never invalidates the mutation/review (`cd920ab`).

## Verification at stop

- `npm run verify` passed: 54 test files, 271 tests, typecheck, lint, contract check, formatting, and
  production builds.
- The live W9 smoke test returned revision 1, design-QA score 99, and a localhost PNG capture URL;
  its temporary session was deleted.
- The MCP server is healthy on port 4318 and the editor dev server remains available on port 5173.

## Resume order

1. W6 — reusable style packs.
2. W8 — text stroke, before recipes so recipes can consume the finished text-style vocabulary.
3. W7 — semantic recipes built on W6/W8.
4. W4 — only after design direction is supplied.

W11/headless render and certification remains explicitly gated and must not start. The broader W12
and W13 work already present on this branch should be preserved.

## Preserve unrelated working files

At this stop point, `CLAUDE.md`, the original
`docs/handovers/2026-08-24-ai-first-quality-program.md`, and the untracked ADR-007 file contain
separate user-owned work. They were intentionally not staged, overwritten, or committed with this
checkpoint.
