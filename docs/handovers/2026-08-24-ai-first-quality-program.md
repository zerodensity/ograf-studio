# Handover — 2026-08-24 — AI-First Quality Program (work order)

> This is a **forward work order**, not a general record of completed work. It hands an incoming AI
> coder a prioritized, pre-analyzed program of changes with exact anchors, acceptance criteria, and
> invariants. Items explicitly marked complete below have landed; all other items remain proposed.

## Branch and revision

- Branch: `codex/ai-first-authoring`
- Release baseline: `1f6e697` — `feat: release OGraf Studio 0.03 AI-first authoring`
- Follow-up checkpoint: `ee7048d` — Preview Start/replay plus source-overlay geometry fixes
- Working tree: expected clean after the W1 documentation commit containing this updated work order
- Current verified baseline: `npm run verify` → **231 passed / 52 files**, plus contracts, format,
  lint, typecheck, runtime build, and editor production build
- Preceding handover: [2026-08-24 AI-first authoring areas 1-9](./2026-08-24-ai-first-authoring-1-9.md)

## Objective

OGraf Studio has solved **correctness** for AI agents and has not yet solved **quality**. An agent
driving the MCP surface today reliably produces output that is valid, certified, on-model — and
visually generic. This program closes the quality gap, reduces the agent context tax, and pre-scopes
(but does not start) headless autonomy.

**Success condition:** an agent given a one-line brief ("build a sports lower third in our house
style") produces something a broadcast designer would accept with minor notes, not something they
would rebuild.

---

## Read before touching anything

1. `AGENTS.md` — the repository working agreement. Its architectural invariants bind this work.
2. `docs/STATUS.md` — current project truth.
3. `docs/ARCHITECTURE.md`.
4. `skills/ograf-authoring/SKILL.md` — the agent-facing contract. Several work items below change
   behaviour the Skill documents; the Skill must be updated in the same commit.

### Non-negotiable invariants

Drawn from `AGENTS.md` and the existing design. Violating any of them is a regression even if tests
pass.

- **Portability at the compile boundary.** Semantic roles/tags, brand tokens, component links,
  timeline groups, guides, locks, parenting, and constraints are _authoring metadata_. They must not
  reach the compiled descriptor. Only `clipChildren` compiles, as a reduced child-side clip relation.
- **No proprietary runtime.** Every new authoring concept must materialize into standard element
  properties and ordinary layers. If a feature would require shipping a new runtime dependency into
  the package, redesign it.
- **Lifecycle keys are global; property keys are local.** Editing one layer must never create or
  retime another layer's keys, and must never silently move lifecycle markers.
- **Non-realtime honesty.** `supportsNonRealTime` may only stay true if every animated element
  remains deterministic under `goToTime()`.
- **Certification is a hard gate.** Never add a path that writes `.ogeproj` or `.ograf.zip` without
  passing the exact-artifact certification.
- **One migration boundary.** `PROJECT_DOCUMENT_VERSION` is currently **16**
  (`packages/scene-model/src/factory.ts:415`). Any schema change bumps it and adds a migration in
  `packages/scene-model/src/migrations.ts` with a test.
- **Contracts are generated, never hand-edited.** `npm run contracts:check` is the first gate in
  `npm run verify`. Regenerate with `npm run contracts:generate` after any MCP schema change.

---

## Assessment summary (why this program exists)

| Dimension                        | Score   | Note                                                  |
| -------------------------------- | ------- | ----------------------------------------------------- |
| Machine-controllable surface     | 9.5     | 28 tools, 63 operation kinds, near-total GUI parity   |
| Determinism and transactionality | 9.5     | Atomic batches, revision checks, dry runs, agent undo |
| Correctness oracle               | 9.5     | Exact-artifact certification, fails closed            |
| Human-in-the-loop                | 9.0     | Accept/Reject proposal drawer, separated histories    |
| Safety and guardrails            | 9.0     | Workspace confinement, no untrusted JS execution      |
| Perception / feedback loop       | 8.0     | PNG capture, strips, text measurement — browser-gated |
| **Quality oracle**               | **5.0** | Structural only; cannot detect mediocrity             |
| **Craft scaffolding**            | **5.0** | 2 recipes, 2 templates                                |
| **Context efficiency**           | **5.0** | ~105 KB of triplicated schema always loaded           |
| **Headless autonomy**            | **4.0** | 8/28 tools require a live browser tab                 |

**Overall AI-first: 8.2/10.** OGraf-_compatible_ output: 9.5/10. Broadcast-_professional_ output:
5.5/10.

The remaining gap is mostly **content** — templates, recipes, style packs, QA rules — not
architecture. That is deliberately the cheaper half, and it is what this program targets.

---

## Work items

Each item is independently shippable. IDs are stable; reference them in commits.

### W1 — Refresh `CLAUDE.md` — completed 2026-08-24

**Problem.** `CLAUDE.md` is auto-loaded into every AI session and is two milestones stale. It states
Phase 5 is partially complete, `ui-kit` is an empty stub, and _"Nothing is committed to git yet"_.
Reality: 5 releases, an MCP server, `authoring-core`, a published Skill, 63 operations, 228 tests.
Every agent session currently starts from a false model of the project.

**Change.** Rewrite `CLAUDE.md` as a short pointer file:

- Product name **OGraf Studio**; current release 0.03.
- Point at `docs/STATUS.md` (current truth), `AGENTS.md` (invariants),
  `skills/ograf-authoring/SKILL.md` (agent contract), newest `docs/handovers/*`.
- Keep the genuinely durable environment gotchas: npm workspaces not pnpm; `ograf-runtime` dist must
  be prebuilt; manual rebuild after editing `packages/ograf-runtime/src` while the dev server runs.
- Delete the stale phase narrative and the "nothing committed" line.

**Acceptance.** No factual claim in `CLAUDE.md` contradicts `docs/STATUS.md`.

**Result.** Replaced the stale phase narrative with a short pointer file covering the current
product identity/release, authoritative documents, durable npm/runtime-build facts, verification,
and the `.ogeproj`/`.ograf.zip` boundary.

---

### W2 — Collapse the three operations tools into one (context tax)

**Problem.** `ograf_apply_operations`, `ograf_preview_operations`, and `ograf_propose_operations`
each declare `z.array(authoringOperationSchema).min(1)`. The serialized union is **byte-identical**
at 34,922 characters in all three — verified by diff. That is ~105 KB of the 132 KB contract surface,
triplicated, loaded into agent context before any work begins: roughly **25k tokens of pure
redundancy** on every session.

**Anchors.**

- Union definition: `apps/mcp-server/src/schemas.ts:167` —
  `export const authoringOperationSchema = z.discriminatedUnion('type', [...])`
- `ograf_preview_operations` — `apps/mcp-server/src/mcpServer.ts:1828`, schema at line 1836
- `ograf_propose_operations` — `apps/mcp-server/src/mcpServer.ts:1962`, schema at line 1972
- `ograf_apply_operations` — `apps/mcp-server/src/mcpServer.ts:2629`, schema at line 2637

**Change.** Merge into a single `ograf_apply_operations` carrying a `mode` discriminator:

```
mode: 'apply' | 'preview' | 'propose'   // default 'apply'
```

- `apply` — current behaviour, mutates, increments revision.
- `preview` — current `ograf_preview_operations`: revision-neutral dry run plus projected render.
- `propose` — current `ograf_propose_operations`: revision-neutral, presented in-editor for
  Accept/Reject.

Keep the existing `dryRun` boolean working for the browser-free projection, or fold it into
`mode: 'preview'` with a `render: false` option — the coder's call, but document the choice.

**Do not** solve this by loosening `operations` to `z.unknown()` on two of the tools. The agent needs
the schema when it calls `preview` first, which is the documented workflow.

**Migration.** Retain `ograf_preview_operations` and `ograf_propose_operations` as thin deprecated
aliases for one release, with descriptions marked deprecated and pointing at the merged tool. Remove
in 0.05.

**Acceptance.**

- `docs/generated/mcp-contracts.json` total drops from ~132 KB to 65 KB or less.
- `npm run contracts:check` passes after `npm run contracts:generate`.
- Existing MCP integration tests in `apps/mcp-server/src/mcpServer.test.ts` cover all three modes.
- `skills/ograf-authoring/SKILL.md` step 3 and `references/tool-workflows.md` updated.

---

### W3 — Fix the lower-third recipe's motion, add a motion vocabulary

**Problem.** This is the highest quality-per-line fix in the repository.

`materializeLowerThird` builds all four layers through one `recipeLayer` helper
(`packages/scene-model/src/semanticRecipes.ts:46`) with a shared `motion` object, producing keys at
identical lifecycle frames. Result: **panel, accent, headline, and subheadline translate in perfect
lockstep**, with `ease-in-out` on entrance.

Two problems:

1. Lockstep translation with no stagger and no reveal is the visual signature of amateur CG.
   Professional lower thirds use a mask wipe plus a short cascade into the text.
2. `ease-in-out` on a short entrance reads sluggish. Broadcast entrances decelerate (ease-out); exits
   accelerate (ease-in).

It also **contradicts the product's own documented house rule**. `SKILL.md` instructs agents:
_"Prefer a `clipChildren` parent plus one animated size track for wipes/reveals; do not approximate
masking with synchronized opacity fades on every child."_ The flagship recipe does neither.

**Change.**

1. Extend `LowerThirdRecipeOptions.motion` (`packages/scene-model/src/semanticRecipes.ts:24`):

```
motion?: {
  style?: 'wipe' | 'stagger' | 'slide' | 'none';   // default 'wipe'
  entrance?: 'left' | 'right' | 'up' | 'down' | 'none';
  exit?: 'left' | 'right' | 'up' | 'down' | 'none';
  staggerFrames?: number;                           // default 3
}
```

2. Implement `style`:

   - **`wipe`** (new default) — panel becomes a `clipChildren` parent; animate its `width` from 0 to
     authored width; accent/headline/subheadline are children revealed by the mask. This exercises
     the deterministic compiled clip path that already exists in
     `packages/scene-model/src/clipping.ts`.
   - **`stagger`** — retain translation but offset each layer by `staggerFrames` in
     panel → accent → headline → subheadline order.
   - **`slide`** — current lockstep behaviour, preserved for compatibility.
   - **`none`** — no lifecycle motion authored.

3. Easing: entrance keys take a decelerating preset, exit keys an accelerating one, instead of
   inheriting `ease-in-out` from the transition (`packages/scene-model/src/semanticRecipes.ts:72`).
   Pick from the existing `EASING_PRESETS` catalog — do not invent new curve maths.

4. Generalize into a reusable module `packages/scene-model/src/motionPresets.ts` exporting named
   entrance/exit builders (`wipe-reveal`, `stagger-cascade`, `scale-pop`, `mask-slide`, `blur-in`)
   that any recipe can consume. Export from `index.ts` and surface the preset names in
   `ograf_get_capabilities` under `semanticAuthoring.recipes`.

**Constraints.**

- `staggerFrames` must not push any key past the End frame. Reject atomically with a clear error
  rather than clamping — matches existing `duplicate_group` behaviour.
- The wipe mask must survive certification and compile to the existing clip relation. Add a compiler
  test asserting no new descriptor fields appear.
- The default change alters behaviour for existing agent calls. Note it in `docs/STATUS.md` and the
  0.04 release notes.

**Acceptance.**

- New tests in `packages/scene-model/src/semanticRecipes.test.ts` for each `style`.
- A `wipe` lower third certifies through all five gates.
- `reviewCompositionDesign` on the default recipe output emits **zero** motion warnings, including
  the new lockstep rule from W5.

---

### W4 — Golden template corpus and template MCP tools (highest quality leverage)

**Problem.** `templates/` contains two files: `news-lower-third.ogeproj` and
`atlas-news-package.ogeproj`. That is not a library. Agents currently assemble professional graphics
from primitives every time, which is where taste failures originate.

**Change.**

1. Author **12–15 certified reference `.ogeproj` templates** spanning the real broadcast vocabulary:
   lower third (news / sports / entertainment variants), bug/DOG, ticker/crawl, scoreboard, clock,
   full-frame title, stat panel, over-the-shoulder, endboard, credits roll, L-bar, break bumper.

   Requirements per template: fully populated `set_layer_semantics` roles/tags/descriptions; bound
   data fields for every editable text; a Brand Kit; passes certification; scores 90 or above on
   `ograf_review_design` after W5 lands.

2. Add two read-only MCP tools:

   - `ograf_list_templates` — returns id, name, category, description, composition size/fps, field
     summary, semantic role inventory. Compact; no payloads.
   - `ograf_open_template` — opens a named template into a new authoring session (or `editor`),
     mirroring `ograf_open_project` semantics and confinement.

3. Update `SKILL.md`: instruct agents to **check for a matching template before authoring from
   primitives**, and to adapt rather than rebuild.

**Constraints.**

- Templates are workspace content, not code. Keep them out of the editor bundle.
- `ograf_open_template` must reuse `ograf_open_project`'s migration path so old templates migrate at
  the single boundary.
- Add a CI test that loads every template, migrates it, and validates it. A stale template is worse
  than no template.

**Acceptance.** An agent can go from a one-line brief to a certified, on-brand graphic in 3 tool
calls or fewer for any covered category.

---

### W5 — Teach `designQa` craft, not just structure

**Problem.** `packages/scene-model/src/designQa.ts` (298 lines) checks bounds, missing roles, minimum
font size, unbound text, headline larger than subheadline, sub-2-frame transitions, excessive travel
speed, palette size, and repeater spacing. All useful. All **structural**.

Nothing detects lockstep motion, wrong-direction easing, a type scale that is technically larger but
visually indistinct (`31px` vs `30px` passes the current strict comparison at
`packages/scene-model/src/designQa.ts:203`), misaligned text left edges, inconsistent padding rhythm,
or loop seam discontinuity. **An agent can score 100/100 on a design a broadcast designer would
reject on sight.**

**Change.** Add rule families, following the existing
`add(id, severity, category, message, layerIds, frames)` pattern at
`packages/scene-model/src/designQa.ts:69`. Keep every rule deterministic and browser-free.

| Rule id prefix            | Severity | Detects                                                                                             |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `motion.lockstep`         | warning  | 3 or more layers sharing identical translation delta _and_ identical key frames across a transition |
| `motion.easing-direction` | warning  | Entrance key easing that accelerates, or exit easing that decelerates                               |
| `motion.no-stagger`       | info     | A semantic group entering with zero timing offset between members                                   |
| `typography.scale-ratio`  | warning  | headline/subheadline font-size ratio below 1.2 (replaces the current strict comparison)             |
| `layout.edge-alignment`   | warning  | Text layers in one group whose left edges differ by 1–8 px (near-miss, not intentional)             |
| `layout.padding-rhythm`   | info     | Inconsistent inner padding across sibling containers                                                |
| `loop.seam`               | warning  | A loop clip whose first and last key values differ on a continuous property                         |

**Constraints.**

- Extend the `DesignQaCategory` union rather than overloading existing categories.
- Finding ids must stay stable and layer-scoped — agents key off them.
- Recalibrate the score weights at `packages/scene-model/src/designQa.ts:274` so the added rules do
  not make every existing project fail. Target: current `templates/*.ogeproj` score 85 or above after
  the change, and W3's fixed recipe 95 or above.
- **Run W3 before W5**, or the new lockstep rule will immediately fail the shipped recipe.

**Acceptance.** Each rule has a positive and negative test in `designQa.test.ts`.
`ograf_review_design` output shape is unchanged apart from new finding ids.

---

### W6 — Broadcast style packs (Brand Kit presets)

**Problem.** Brand Kits exist (`packages/scene-model/src/designSystem.ts`) but ship empty. An agent
inventing a palette and type scale per project produces incoherence.

**Change.** Ship named, immutable style packs — **News**, **Sports**, **Entertainment**,
**Documentary** — each carrying palette tokens, a modular type scale, standard motion durations, and
easing conventions. Expose via an `apply_style_pack` operation (or a `stylePack` option on the
recipes) and list them in `ograf_get_capabilities` under `designSystem`.

**Constraints.** Values materialize into standard element properties exactly as tokens do today. No
new runtime dependency. Packs are starting points, not locks — the user must be able to edit every
value afterwards.

---

### W7 — Expand the recipe library

**Problem.** Two recipes: `create_lower_third`, `create_repeater`.

**Change.** Add materialized recipes for the categories in W4 that benefit from parameterization
rather than a static template — at minimum `create_bug`, `create_ticker`, `create_scoreboard`,
`create_clock`. Follow the `materializeLowerThird` pattern exactly: ordinary layers, semantic tags,
bound fields, complete returned id mapping, no runtime dependency.

`create_ticker` must use the `clipChildren` mask for its crawl and a local loop clip for motion — do
**not** author a long translate track across the whole lifecycle.

**Dependency.** Build on W3's `motionPresets.ts` so recipes share one motion language.

---

### W8 — Text stroke

**Problem.** `TextElement` (`packages/scene-model/src/types.ts`) has no stroke/outline, while
rectangle, ellipse, and path all carry `strokeColor`/`strokeWidth`. Outlined text is non-negotiable
for sports scorebugs and any text over unpredictable video.

**Change.** Add `strokeColor: string` and `strokeWidth: number` to `TextElement`. Wire through:
`factory.ts` defaults → editor Inspector → compiler → `ograf-runtime` → PNG capture → SVG render.
`strokeWidth` should be an animatable numeric property.

**Constraints.**

- Bump `PROJECT_DOCUMENT_VERSION` to 17 and add a migration defaulting existing text to
  `strokeWidth: 0`.
- Use `paint-order: stroke fill` so the stroke sits behind the glyph — the CSS default centers it and
  eats the letterform.
- Add to `ograf_get_capabilities.elementSchemas.text` and to the design-token `targetProperties`
  list.

**Follow-on (separate item, do not bundle):** per-word / per-character reveal. Highest-value motion
primitive still missing, but it needs its own design pass on how sub-element animation compiles
deterministically under `goToTime()`.

---

### W9 — `ograf_apply_and_review` (round-trip reduction)

**Problem.** The iterate-to-quality loop is apply → capture → review → apply. Four round-trips per
refinement, and that loop is where agents spend most of their turns.

**Change.** Add a tool (or an `includeReview: true` option on the merged W2 tool) that applies a
batch and returns, in one response: new revision, operation results with ids,
`reviewCompositionDesign` findings, and a browser capture URL when the editor is connected.

**Constraints.** Must degrade gracefully to browser-free output when the editor is disconnected —
apply and QA still work; only the capture is omitted. Never fail the apply because the capture
failed.

---

### W10 — `sections` filter on `ograf_get_capabilities`

**Problem.** The capabilities payload is ~14 KB of source
(`apps/mcp-server/src/mcpServer.ts:976`–`1279`) and is the first call of every session.

**Change.** Add an optional `sections` array (`elements`, `easing`, `semantics`, `designSystem`,
`loops`, `bindings`, `editor`) mirroring the pattern `ograf_get_project` already uses. Default
remains the full payload for compatibility.

---

### W11 — Headless certify/render — **GATED, DO NOT START**

> `docs/STATUS.md` and the previous handover both state: _"Do not start headless render/certify until
> the user explicitly resumes area 10."_ **That gate is still closed.** This section exists so the
> work is pre-scoped when it opens — not as authorization to begin.

**Problem.** Eight of 28 tools require a connected, responsive browser tab: `ograf_capture`,
`ograf_render_strip`, `ograf_preview_operations`, `ograf_propose_operations`, `ograf_measure_text`,
`ograf_certify_project`, `ograf_save_project`, `ograf_export_package`. Because certification is
mandatory before save, **the entire output path is gated on a human having a browser tab open.** No
CI, no cloud agent, no batch certification.

**Pre-scoped approach.** `EditorBridge` is a concrete class (`apps/mcp-server/src/editorBridge.ts:211`)
owning a WebSocket to `apps/editor/src/state/agentBridge.ts`. Certification is already isolated in a
disposable iframe/custom-element realm behind a serialized work queue.

1. Extract an interface from the public surface of `EditorBridge` (`health`, `certify`, `capture`,
   `renderStrip`, `measureText`, proposal lifecycle).
2. Implement a second backend that drives a headless Chromium (Playwright/CDP) against the same
   editor build.
3. Select backend by config; keep the live-tab backend the default for interactive sessions.

This is largely a transport swap, not a rewrite — but it is real work and it needs its own handover.

---

## Sequencing

```
Phase 0   W1                     docs hygiene, unblocks every agent session
Phase 1   W4 -> W3 -> W6         quality content; W3 must land before W5
Phase 2   W5                     quality oracle (depends on W3)
Phase 3   W2 -> W10 -> W9        context and round-trip efficiency
Phase 4   W8 -> W7               primitives and recipe breadth (W7 depends on W3)
Phase 5   W11                    GATED on explicit user approval
```

W2 is independently shippable at any point and is the cheapest large win if context pressure is the
immediate pain.

---

## What not to do

- Do not add a proprietary runtime primitive to solve a design problem. Materialize instead.
- Do not make `designQa` non-deterministic or browser-dependent. Its value is that it runs anywhere.
- Do not hand-edit `docs/generated/mcp-contracts.*`.
- Do not widen `operations` to `z.unknown()` to shrink the schema (see W2).
- Do not start W11.
- Do not expand recipe/QA heuristics speculatively beyond what is specified here — the previous
  handover's standing instruction is to tune from real production usage.

---

## Verification protocol

Per work item:

```bash
npm run verify
```

This runs, in order: `contracts:check`, `format:check`, `lint`, `typecheck`, `test`, `build`.
`contracts:check` is first and will fail on any MCP schema change until you run
`npm run contracts:generate`.

Additionally, for items touching recipes, QA, motion, or the element schema:

- Certify at least one affected template through all five gates via `ograf_certify_project`.
- Confirm no authoring metadata leaked into the compiled descriptor (compiler test).
- Record the result in a new dated handover. Per `AGENTS.md`, _"Completed means verified, not merely
  implemented."_

## Known risks

- **W3 changes a default.** Existing agent calls to `create_lower_third` will produce different
  motion. Intended, but it must be called out in release notes.
- **W5 can regress scores project-wide.** Recalibrate weights and re-baseline `templates/*` in the
  same commit.
- **W8 bumps the document version.** Migration test is mandatory; a missed migration corrupts user
  projects at the single load boundary.
- **W2 changes the public MCP surface.** Keep deprecated aliases for one release.
- The editor production bundle is already large and emits a chunk advisory. W4 must not bundle
  template payloads into the app.
