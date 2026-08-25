# Handover — 2026-08-24 — In-app BYOK chat implementation

## Branch and revision

- Branch: `codex/ai-first-authoring`
- Last commit before this work: `e59e62c docs: record W6 W7 implementation handover`
- Working tree clean: no; this implementation is intentionally uncommitted pending user review.

## Objective

Implement C1-C5 from the accepted in-app BYOK chat specification without forking the existing
authoring operations or exposing credentials to browser JavaScript.

## Completed and verified

- C1: server-side request/tool/continue loop with isolated Anthropic and OpenAI-compatible adapters,
  configurable base URL/model, Windows Credential Manager first and environment fallback, error
  redaction, cancellation, usage/cache-read accounting, and optional cheap-model routing.
- C2: an exact 14-tool filter over canonical `agent-tools` records. The rendered provider wire
  surface is 59,911 bytes; file output, certification, import, project lifecycle, and external-host
  session tools are absent.
- C3: deterministic in-app prompt projection from the complete `ograf-authoring` Skill and selected
  references. The generated prompt is approximately 6,542 tokens; unavailable/setup guidance is
  rejected and `prompt:check` is part of `npm run verify`.
- C4: selection IDs/primary selection, current frame, viewport dimensions/current canvas zoom, and
  recent editor activity are attached to each user turn in messages, never the system prompt.
  Supported models receive a mid-conversation system entry; Sonnet and other portable paths receive
  the user-prefix fallback.
- C5: persistent 360-420 px resizable/collapsible Layers/Chat sidebar, unconfigured/offline/inactive
  tab states, summarized tool progress, cancellation, proposal references, and per-message,
  per-session, and browser-local per-project token usage.
- Multi-tab replacement sends an explicit inactive-session event and stops reconnecting the orphaned
  tab. External MCP activity is visible; a session-local exclusive toggle arbitrates hard
  in-app/external-agent exclusivity while optimistic revisions remain the default.
- Added an interactive hidden-input Windows Credential Manager helper and documented server-only
  BYOK configuration/data boundaries.

## In progress

None for the approved C1-C5 implementation.

## Next actions

1. Configure one real provider credential/model and perform an end-to-end customer-account smoke
   test; no real credential was available during implementation.
2. After user approval, stage only implementation/documentation files, preserving the unrelated
   user-owned dirty files listed below, then commit/push/release only when requested.
3. Treat streaming deltas, persisted transcript history, price conversion, and more providers as
   follow-up work rather than expanding this first milestone.

## Decisions made

- The in-app loop calls canonical records directly; it does not route through local HTTP MCP.
- The stable prompt/tools prefix is generated and cached; ambient application state stays in
  conversation messages.
- Consequential file/project lifecycle actions remain in visible Studio UI.
- Per-project usage is local UI telemetry keyed by project ID and is excluded from portable source.

## Important files changed

- `packages/agent-tools/src/inAppTools.ts`
- `packages/agent-tools/src/inAppPromptProjection.ts`
- `packages/agent-tools/src/generatedInAppPrompt.ts`
- `apps/mcp-server/src/agent/*`
- `apps/mcp-server/src/editorBridge.ts`
- `apps/editor/src/state/agentBridge.ts`
- `apps/editor/src/panels/AgentChatPanel.tsx`
- `apps/editor/src/layout/LeftSidebar.tsx`
- `scripts/generateInAppPrompt.ts`
- `scripts/configureAgentCredential.ps1`

## Verification

- `npm run verify`: passed on 2026-08-24; generated MCP/prompt drift, formatting, lint, all workspace
  typechecks, 310 tests across 62 files, runtime build, and production editor build. The existing
  large editor chunk advisory remains.
- Local provider mocks proved both endpoint dialects, non-default base URLs, tool-call
  normalization, one exact revision for an operation batch, second-request cache accounting,
  provider-error redaction, and exclusive concurrency.
- Live browser: Chat rendered at the intended sidebar width with the explicit unconfigured state;
  opening a second Studio tab immediately disabled Chat in the orphaned tab with the authoritative-
  session explanation. The active Chat tab and MCP server were left running.
- Real-provider smoke: not run because no customer model credential was configured.

## Known failures and risks

- Provider APIs evolve; adapters are intentionally isolated and covered by local wire mocks, but a
  real-account smoke is still required before calling any specific model/provider combination
  production-proven.
- Cancellation is cooperative. It aborts provider work and prevents new tool calls; an already
  executing atomic tool handler is allowed to finish rather than being interrupted mid-transaction.
- Anthropic converts ambient mid-system entries to a portable user-prefixed form because its current
  Messages wire format does not accept arbitrary system roles inside `messages`.

## Environment and generated artifacts

- Editor: `http://localhost:5173/`
- MCP/editor bridge: `http://127.0.0.1:4318/mcp`, `ws://127.0.0.1:4318/editor`
- Generated prompt: `docs/generated/in-app-system-prompt.md`

## Uncommitted work

Preserve these pre-existing user-owned changes and do not include them automatically in this work:

- `CLAUDE.md`
- `docs/handovers/2026-08-24-ai-first-quality-program.md`
- `docs/handovers/2026-08-24-in-app-chat-byok.md`
- `docs/decisions/ADR-007-declarative-conditional-visibility.md`
