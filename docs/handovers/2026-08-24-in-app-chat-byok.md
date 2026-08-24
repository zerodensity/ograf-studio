# Handover — 2026-08-24 — In-App Chat Panel (BYOK) — implementation spec

> Forward work order for a new subsystem. Nothing here is implemented. Decision and rationale live in
> [ADR-006](../decisions/ADR-006-in-app-byok-agent.md); this document is the actionable plan.
>
> Companion programme: [AI-First Quality Program](./2026-08-24-ai-first-quality-program.md) (W1–W13).
> **C0 below overlaps W2 — read that item before starting.**

## Objective

Put a chat panel in the editor's left sidebar so a designer can author OGraf graphics by talking to a
model, using **their own** model credentials (BYOK).

**The framing that should drive every decision:** this is a _distribution_ change, not a capability
change. OGraf Studio is already agent-first — 63 revisioned operations, atomic batches, dry runs,
deterministic QA, and an Accept/Reject proposal flow. All of it is currently gated behind "install an
external agent host and configure a local MCP server." This subsystem removes that barrier. It must
not reinvent what is behind it.

## Baseline at time of writing

- Branch `codex/ai-first-authoring`; release baseline v0.04 (`e36a33d`)
- `PROJECT_DOCUMENT_VERSION` = **19**
- W1, W2, W3, W5, W12a, W12b, and W13 have landed. Before W2 the recursive operation contract was
  334,854 bytes across 28 tools; after consolidation it is 133,868 bytes across 26 tools.
- `apps/editor` depends on `codegen`, `ograf-runtime`, `ograf-types`, `scene-model`, `validation`.
  It does **not** depend on `authoring-core`.

---

## Architecture

### The layering that actually exists

A correction worth stating plainly, because it is easy to get wrong: **`authoring-core` is the
mutation engine, not the capability surface.** `mcpServer.ts` imports only four symbols from it —
`applyAuthoringOperations`, `RevisionConflictError`, `renderCompositionFrameSvg`, and the
`AuthoringOperation` type. Everything else composes other packages.

```
scene-model      domain model, design/broadcast QA, geometry, sampling
validation       schema + semantic checks   (already a dependency of authoring-core)
codegen          compile to OGraf artifacts, export profiles, package layout
authoring-core   operations + sessions + revisions + dry runs + SVG render
─────────────────────────────────────────────────────────────────────────
mcpServer.ts     COMPOSITION LAYER — ~2855 lines, the part to extract
editorBridge.ts  browser round-trip (capture, strip, measure, certify, proposals)
workspace.ts     workspace confinement + session registry
```

Building the chat directly on `authoring-core` would mean rewriting the composition layer and
maintaining two copies. Do not do that.

### Target shape

```
packages/agent-tools          ← extracted composition layer, single source
   ├── apps/mcp-server        ← renders MCP registrations (external agents)
   └── in-app agent loop      ← renders provider tool defs (built-in chat)
```

### Non-negotiables

- **The model loop runs server-side.** Customer credentials live in the local server process and
  never reach browser JavaScript. No API keys in the renderer, no direct provider calls from the page.
- **`EditorBridge` is retained.** The agent loop is server-side, so browser-backed work still needs
  the socket. It becomes more reliable in-app because the tab is open by definition — this is the
  W11 headless problem evaporating for this path, not the bridge becoming unnecessary.
- **Every existing invariant still applies**: portability at the compile boundary, mandatory
  certification before any file write, revision checking, lifecycle key rules. This subsystem changes
  who drives authoring, not what gets authored.

---

## Work items

### C0 — Extract `packages/agent-tools` and land W2 — completed 2026-08-24

Move the tool composition out of `apps/mcp-server/src/mcpServer.ts` into a new package that:

- accepts an `EditorBridge`-shaped interface and an `AuthoringWorkspace` as injected dependencies
  (define the bridge interface here — this is also the seam W11 will later need);
- exposes each tool as a plain record: `{ name, title, description, schema, annotations, handler }`;
- owns no transport, no MCP SDK import, no HTTP.

`apps/mcp-server` becomes a thin renderer that maps those records onto `server.registerTool(...)`.

W2 is complete. `apply`, browser-free `dry-run`, rendered `preview`, and human-review `propose` now
share one mode-discriminated `ograf_apply_operations` schema. The removed preview/proposal names are
an intentional public MCP break in favor of the context reduction.

**Acceptance result.** C0a passed unchanged contracts and the full verification gate before W2.
C0b preserved the four behaviors and reduced the contract by 60% to 133,868 bytes. The old ≤65 KB
target predated recursive W12b schemas and was replaced with a measured ≤150,000-byte budget. The
generator rejects both budget drift and reintroduction of the duplicated tool names.

---

### C1 — Server-side agent loop + provider adapter

Add an agent loop to the local server process:

- Reads the tool records from `agent-tools`, filtered to the in-app surface (see C2).
- Runs the request → tool-call → execute → continue cycle.
- Streams events to the browser over the existing WebSocket.

**Provider adapter.** BYOK means multiple tool-calling dialects (Anthropic `tool_use`, OpenAI
function calling, Gemini). Write one adapter that renders the shared tool records into each provider's
format and normalizes responses back. Keep it small and isolated; it is the only provider-aware code
in the system.

**Configuration**, stored server-side only: provider, base URL, model id, credential, optional
organization/project. A base-URL override is **required, not optional** — it is how air-gapped
facilities point at an internal gateway or self-hosted model, and without it that market is closed.

**Cost controls, from day one:**

| Lever           | What to do                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Prompt caching  | Cache the `tools` + `system` prefix. It is perfectly stable and the single largest saving available.                            |
| Ambient context | Goes in `messages`, **never** in `system` — see C4.                                                                             |
| Model tiering   | Route trivial operations (rename, set property, add key) to a cheap model; reserve the capable model for design reasoning.      |
| Effort          | Default routine authoring to medium effort; reserve high/xhigh for complex work.                                                |
| Images          | Default `maxDimension` aggressively on capture/strip; full-resolution is opt-in. Vision tokens dominate visual-iteration loops. |

**Instrument `cache_read_input_tokens` and surface it.** If it is zero across turns, something
volatile has entered the prefix. Under BYOK a silent cache invalidator is invisible in behaviour and
shows up only on the customer's bill — which makes it a support ticket, not a margin line.

**Acceptance.**

- A chat prompt produces a tool call that mutates the visible editor project, and `revision`
  increments exactly once for the batch.
- The same instruction, run against Anthropic and against an OpenAI-compatible endpoint, produces the
  same operation batch from one shared tool-record set.
- `cache_read_input_tokens > 0` on the second and every subsequent turn of a session. A test asserts
  this; it is the regression guard for the whole cost model.
- A configured non-default base URL is actually used — provable against a local mock endpoint.
- No credential appears in any WebSocket frame, browser-visible config, or log line. A test asserts
  redaction on a forced provider error.
- A provider failure surfaces as a chat error state without terminating the loop or leaking headers.

---

### C2 — Reduced in-app tool surface

The chat does not need all 28 tools. Expose a **filtered subset of the same records** — never a fork.

- **Exclude and make UI actions instead:** `ograf_certify_project`, `ograf_save_project`,
  `ograf_export_package`. These are consequential, user-initiated, and already have UI affordances.
- **Exclude as meaningless in-app:** session lifecycle and workspace-opening tools that assume an
  external host.
- **Keep:** query/inspect, timeline, sampling, apply (with `mode`), capture/strip, measure, review,
  validate.

Target roughly 12–15 tools. Smaller prefix, lower cost, and fewer ways for a model to do something
surprising to somebody's project.

**Acceptance.**

- The in-app list is produced by filtering the shared records. No second handler implementation
  exists anywhere — verify by search, not by inspection.
- `ograf_certify_project`, `ograf_save_project`, and `ograf_export_package` are absent from the
  in-app tool list and are not reachable by the model.
- Adding a tool to `agent-tools` appears on the MCP surface automatically, and in-app only if the
  filter admits it. A test covers both halves.
- The in-app list is 12–15 tools.

---

### C3 — Knowledge layer: generated system prompt

The in-app system prompt is a **generated projection** of `skills/ograf-authoring/SKILL.md`.

**Bundle it; do not build a retrieval tool.** Measured corpus:

| File                             | ~Tokens     |
| -------------------------------- | ----------- |
| `SKILL.md`                       | 3,800       |
| `references/tool-workflows.md`   | 4,888       |
| `references/examples.md`         | 1,269       |
| `references/ograf-invariants.md` | 1,205       |
| `references/setup.md`            | 626         |
| **Total**                        | **~11,800** |

Inside the cached prefix that is roughly **1,200 effective tokens per turn** at the ~0.1× cache-read
rate. A single retrieval round trip costs an entire extra request cycle — more than bundling the whole
corpus for a whole session. Retrieval only pays at roughly an order of magnitude more content.

**Strip out-of-process concerns — the point is attention, not tokens.** In-app, the editor is running
by definition, so this content is worse than dead weight; it tells the model to reason about
impossible failure modes:

- `references/setup.md` in full — local startup and server recovery.
- "If the editor is disconnected and you have browser control, open it at localhost:5173 yourself."
- "The live browser editor must be open for previews, capture, certification, save, and export."
- The `editor.connected` / `editor.responsive` / `certificationReady` handshake in step 1.

Expect roughly 8–9k tokens after the projection.

**Add a drift gate.** Generate the prompt from `SKILL.md` and check it in `npm run verify`, exactly
as `contracts:check` guards the MCP surface. One knowledge source, two renderers.

**Revisit retrieval when W4 lands.** A 12–15 template corpus with descriptions will be large and
selectively relevant — that is the real retrieval case, and `ograf_list_templates` is already its tool.

**Acceptance.**

- Editing `SKILL.md` without regenerating fails `npm run verify`. Prove the gate by mutating the
  skill in a test, not by reasoning about it.
- Two consecutive generations are byte-identical.
- The generated prompt contains none of the stripped strings above. Assert their absence explicitly —
  this is what stops out-of-process guidance creeping back in on a later edit.
- The projection is ≤ 9,000 tokens, measured, with the number recorded in the test so regressions are
  visible.

---

### C4 — Ambient context (the actual differentiator)

This is what makes an in-app agent better than an external one, and it is worth more than the chat box.

Supply current **selection, frame, viewport, and recent edits** with each turn. A designer can then
select something and say "make this pop more" and have it work — an external agent has no cursor and
must have everything spelled out.

**Placement is critical.** Caching is a strict prefix match over `tools` → `system` → `messages`.
Ambient state changes every turn; putting it in the system prompt invalidates the entire cached
prefix on every request, converting the cheapest component into one of the most expensive.

- **Preferred**, where the customer's model supports it: append a mid-conversation system message —
  `{"role": "system", content: "Selection: …, frame 47"}` into `messages[]`. Preserves the cached
  prefix and carries operator authority, so editor state cannot be confused with user input.
  Model-gated: Opus 5, Opus 4.8, Fable 5, Mythos 5 — **not** Sonnet 5, which returns 400.
- **Portable fallback:** a plain prefix on the user message.

**Acceptance.**

- With a layer selected, "make this wider" targets that layer without the user naming it.
- **`cache_read_input_tokens` stays above zero across turns in which the selection changes.** This is
  the criterion that proves ambient context is not in the system prompt, and it is the one most
  likely to regress silently. Test it directly.
- A unit test on the request builder asserts ambient content appears in `messages` and never in
  `system`.
- On a model without mid-conversation system-message support, the portable fallback engages without
  error — cover Sonnet 5 explicitly, since it returns 400 rather than degrading.

---

### C5 — Chat panel UI

**Location: left sidebar.** `AppShell` already has a resizable `.left-sidebar` with `useResizable.ts`.
Chat is where intent is formed, so it belongs at the start of the reading order alongside Layers; the
right side is Inspector-style fine-tuning that must sit next to the canvas it tunes.

- **Width 360–420px**, resizable and collapsible. A layer-list-width panel is unreadable for chat.
- **Tab it with Layers** rather than stacking a third section — three panes in one sidebar is cramped
  at 1080p.
- **Proposals stay in `AgentReviewPanel`.** Let chat _reference_ them. A proposal that scrolls out of
  the message list is a proposal nobody acts on.
- Visually consequential batches → proposal. Purely additive batches → direct apply, consistent with
  the existing Skill guidance.
- Show token/cost usage. Under BYOK the customer is paying and will ask.

**Event protocol.** Carried over the existing editor WebSocket alongside current bridge traffic — do
not open a second connection. Minimum viable set; add streaming deltas only when C5 is otherwise
stable.

Browser → server:

| Message       | Payload                                |
| ------------- | -------------------------------------- |
| `chat.send`   | `{ turnId, sessionId, text, ambient }` |
| `chat.cancel` | `{ turnId }`                           |

Server → browser:

| Message           | Payload                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `chat.turn.start` | `{ turnId }`                                                               |
| `chat.text`       | `{ turnId, text }` — one block per assistant text segment                  |
| `chat.tool`       | `{ turnId, callId, name, summary, status: 'running' \| 'ok' \| 'error' }`  |
| `chat.proposal`   | `{ turnId, proposalId }` — a reference only; `AgentReviewPanel` renders it |
| `chat.turn.end`   | `{ turnId, stopReason, usage: { input, output, cacheRead } }`              |
| `chat.error`      | `{ turnId, message }` — redacted, never carries provider headers           |

`chat.tool` sends a human-readable `summary`, not raw arguments: a UUID-laden operation batch is
noise in a chat transcript, and raw payloads are where credentials and project internals leak into a
screenshare.

**Required states.** Idle, awaiting-response, tool-running, cancelled, provider-error,
not-authoritative-session (see Concurrency), and unconfigured (no credential yet). The last two are
the ones most often skipped and most often hit.

**Acceptance.**

- Panel renders in the left sidebar, tabbed with Layers, resizable within 360–420px and collapsible.
  Tab choice and width persist across reload as a local UI preference, not in `.ogeproj`.
- A visually consequential batch produces a proposal in `AgentReviewPanel`, referenced from the
  transcript; Accept applies the exact previewed batch and Reject leaves `revision` unchanged.
- `chat.cancel` mid-turn stops the loop and leaves `revision` unchanged.
- In a tab that is not the authoritative editor session, the panel disables itself with a clear
  explanation rather than silently failing.
- Per-message and per-session usage are visible; cumulative-per-project persists in local app state
  and **not** in `.ogeproj`. A test asserts the project document is untouched by usage tracking.
- No credential material appears in any frame of the protocol above.

---

## Phasing

```
C0   extract agent-tools + land W2        [done]
C1   server-side loop + provider adapter  BYOK config, cost controls
C2   reduced tool surface                 filter, not fork
C3   generated system prompt + drift gate
C5   chat panel + proposal integration    first user-visible milestone
C4   ambient context                      the differentiator
--   streaming, history, cost UI          only after the above is solid
```

C4 is listed after C5 deliberately: get the loop correct against explicit instructions before adding
implicit context, or you will not know which layer is misbehaving.

---

## What not to do

- Do not run the model loop, or hold credentials, in the browser.
- Do not build the chat on `authoring-core` alone — see the layering section.
- Do not route the in-app chat through HTTP MCP to your own process.
- Do not fork tool logic for the in-app surface; filter the shared records.
- Do not put ambient context in the system prompt.
- Do not build a guidance-retrieval tool for the current ~12k corpus.
- Do not build data connectors, rundowns, MOS support, or operator panels — Reality Hub owns that
  layer (see the Deployment context section of the quality-programme handover).
- Do not let this become a chat product. Ship the smallest loop that drives the existing proposal
  flow; defer streaming, history, and retry UX.

---

## Risks

- **Orphaned editor tabs.** Multiple editor tabs still replace one another's bridge socket
  (`docs/KNOWN_ISSUES.md`), and a chat panel in an orphaned tab would appear to do nothing. Mitigated
  by the divergence-signal requirement in the Concurrency section — not a shipping blocker, but the
  mitigation is mandatory.
- **Token waste becomes a visible defect.** "OGraf Studio burned $40 of my credits on one lower third"
  is churn, not a margin footnote. This is why C0/W2 and caching are prerequisites rather than
  optimizations.
- **Scope creep into chat-client work.** The failure mode is a quarter spent on message UX.
- **Provider drift.** Every provider's tool dialect changes. Keep the adapter isolated and tested.
- **Data governance.** Broadcast content is frequently embargoed — election results, transfer news,
  pre-written obituaries. Customers' legal teams will ask where template content goes. Document it,
  support zero-data-retention configurations, and make the base-URL override prominent.

---

## Resolved decisions — answered 2026-08-24

1. **Providers at launch: Anthropic + OpenAI-compatible.** Two adapters. The OpenAI-compatible path
   covers vLLM, Ollama, LiteLLM, Azure OpenAI, and most internal gateways, so it doubles as the
   air-gapped story alongside the base-URL override.
2. **Session identity: `sessionId: "editor"`**, the same session external agents use. The in-app agent
   collaborates on the visible project; its transactions land in the existing agent-transaction
   history, which is already separate from browser undo.
3. **Concurrency: both allowed by default, with an optional exclusive lock.** See the revised risk
   note below — this is less dangerous than first assessed.
4. **Cost display: all three** — per-message, per-session, and cumulative per project. Per-message and
   per-session are in-memory. **Cumulative per project must not be written into `.ogeproj`**: that
   file is portable authoring source that ships to other people, and usage telemetry does not belong
   in it. Persist it in local app state keyed by project id.
5. **Credential storage: OS keychain primary, environment variable fallback, never a plaintext file.**
   See below.

## Credential handling (C1)

Storage, in order of preference:

| Mechanism                | Use                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OS keychain**          | Primary. Encrypted at rest, scoped to the OS user, unlocked by their login session. Windows Credential Manager / DPAPI on the primary platform.                                                         |
| **Environment variable** | Documented fallback. Nothing stored by the app, and it is how IT injects secrets on shared master-control workstations and air-gapped machines — the same population using the internal-gateway option. |
| Per-launch entry         | Rejected. Sounds safest but trains users to paste keys repeatedly from wherever they actually keep them, which is usually less secure.                                                                  |
| Plaintext config file    | Never. Readable by any process running as that user, lands in backups, gets committed, appears in screenshares.                                                                                         |

Handling rules, which matter as much as storage:

- **The key never reaches the renderer.** No provider calls from the page, no key in any WebSocket
  payload, no key in browser-visible config.
- **Redact credentials in logs and error paths.** Provider SDK errors sometimes echo request headers;
  this is the most common real-world leak.
- **Bind the chat endpoint to loopback**, matching the `isLocalRequest` check already enforced on the
  WebSocket upgrade at `apps/mcp-server/src/editorBridge.ts:203`.
- **Scope the credential** where the provider supports it — workspace-restricted rather than
  organization-wide.

## Concurrency — revised assessment

An earlier draft of this document listed two-agent concurrency as a shipping blocker. That
overstated it.

- The in-app agent runs **server-side, in the process that already owns the single bridge socket**. It
  does not open a second connection, so it adds no socket contention.
- Concurrent _edits_ are exactly what `authoring-core`'s optimistic revision checks and
  `RevisionConflictError` exist to arbitrate. That mechanism is already proven against external
  agents editing alongside a human.

The genuine issue recorded in `docs/KNOWN_ISSUES.md` is narrower: multiple **editor tabs** replace one
another's socket. A chat panel makes that more visible — an orphaned tab's chat would appear to do
nothing — but it is a pre-existing problem, not a new class of one.

**Required mitigation, not a blocker:** the chat panel subscribes to the existing authoritative-session
divergence signal (see `docs/STATUS.md` — divergent tabs already receive an explicit synchronization
rather than last-writer-wins) and disables itself with a clear "this tab is not the active editor
session" state. Add an optional exclusive-lock toggle for teams that want hard exclusivity, and a
visible indicator when an external agent is connected.
