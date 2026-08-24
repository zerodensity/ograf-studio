# ADR-006: In-App BYOK Authoring Agent

Status: Accepted
Date: 2026-08-24

Implementation status: C0a extraction and C0b/W2 consolidation are complete on
`codex/ai-first-authoring`; the provider loop and chat UI have not started.

## Context

OGraf Studio is already agent-first: `authoring-core` provides revisioned atomic operations, the MCP
server exposes 28 tools, and `AgentReviewPanel` already presents agent proposals for human Accept or
Reject. That capability is currently reachable only by installing an external agent host and
configuring a local MCP server — a barrier most broadcast designers will never cross.

The gap is reach, not capability. A chat panel inside the editor makes the existing agent surface
usable by the people the product is actually for. Customers supply their own model credentials
(BYOK), which removes per-token cost risk from the vendor, satisfies facilities that cannot call
external endpoints, and answers the data-governance question raised by embargoed broadcast content.

Two failure modes must be avoided. First, a second agent implementation inside the browser would
duplicate the composition layer that currently lives in `mcpServer.ts` and drift from it. Second,
holding customer model credentials in browser JavaScript would expose them.

## Decision

- The in-app agent loop runs **server-side**, in the existing local server process. Model credentials
  are held there and never reach the browser. The chat panel is a thin view over the existing
  WebSocket bridge.
- The composition layer currently embedded in `apps/mcp-server/src/mcpServer.ts` is extracted into a
  shared `packages/agent-tools` package that takes the bridge and workspace as injected dependencies
  and exposes each tool as a `{name, schema, handler}` record.
- That package is rendered by **two front doors over one source**: MCP tool registrations for
  external agents, and provider-native tool definitions for the in-app loop. Neither front door owns
  tool logic.
- The in-app surface is a **filter** over the same records, not a fork. Certification, save, and
  export are UI actions rather than model-callable tools.
- `EditorBridge` is retained. Browser-backed capture, strips, measurement, and certification still
  require the editor; in-app they become more reliable because the tab is open by definition.
- The in-app system prompt is a **generated projection** of `skills/ograf-authoring/SKILL.md` with
  out-of-process concerns removed. Prompt/skill drift is gated in `npm run verify`, in the same
  manner as `contracts:check`.
- Ambient editor context (selection, frame, viewport) is supplied through `messages`, never through
  the system prompt, so the cached prefix stays stable.

## Consequences

- One tool vocabulary serves both the built-in chat and external agents; a new operation cannot reach
  one without the other.
- Extracting `agent-tools` is a prerequisite refactor with no user-visible behaviour change, and it
  is the natural moment to land W2's tool consolidation.
- C0a preserved the exact 28-tool contract before W2. C0b then replaced the duplicated apply,
  preview, and proposal schemas with one `ograf_apply_operations` record supporting `apply`,
  `dry-run`, `preview`, and `propose` modes. The generated contract fell from 334,854 to 133,868
  bytes and is guarded by a 150,000-byte verification budget.
- The generated OGraf output is unaffected. This decision changes who can drive authoring, not what
  is authored, and every existing invariant — portability at the compile boundary, mandatory
  certification, revision checking — continues to apply unchanged.
- BYOK moves token cost to the customer, which makes wasted tokens a visible product defect rather
  than a hidden margin cost. Prompt-caching discipline becomes a product requirement.
- Supporting multiple providers requires a tool-format adapter; the MCP contract remains the
  portability layer, as already assumed by `skills/ograf-authoring/agents/openai.yaml`.
- Two agents may now act on one project. This is arbitrated by the existing optimistic revision
  checks rather than by new machinery: the in-app loop runs in the process that already owns the
  bridge socket, so it adds no socket contention. The separate multi-tab limitation recorded in
  `docs/KNOWN_ISSUES.md` remains, and the chat panel must disable itself in a tab that is no longer
  the authoritative editor session.
- Credentials are stored in the OS keychain, with an environment variable as the documented fallback
  for shared and air-gapped workstations. No plaintext credential file is written, and the chat
  endpoint is loopback-bound like the existing bridge upgrade path.
