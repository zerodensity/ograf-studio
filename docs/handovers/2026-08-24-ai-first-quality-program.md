# Handover — 2026-08-24 — AI-First Quality Program (work order)

> This is a **forward work order**, not a general record of completed work. It hands an incoming AI
> coder a prioritized, pre-analyzed program of changes with exact anchors, acceptance criteria, and
> invariants. Items explicitly marked complete below have landed; all other items remain proposed.

## Branch and revision

- Branch: `codex/ai-first-authoring`
- Release baseline: `1f6e697` — `feat: release OGraf Studio 0.03 AI-first authoring`
- Follow-up checkpoint: `ee7048d` — Preview Start/replay plus source-overlay geometry fixes
- Working tree: expected clean after the W1 documentation commit containing this updated work order
- Current verified baseline: `npm run verify` → **240 passed / 53 files**, plus contracts, format,
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
- **Certification is a hard gate.** Never add a path that writes `.ogs` or `.ograf.zip` without
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
Reality: 5 releases, an MCP server, `authoring-core`, a published Skill, 63 operations, 240 tests.
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
and the `.ogs`/`.ograf.zip` boundary.

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

### W3 — Fix the lower-third recipe's motion, add a motion vocabulary — completed 2026-08-24

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

**Result.** Added shared `wipe-reveal`, `stagger-cascade`, and `directional-slide` scene-model
presets. The lower-third default is now a compiled `clipChildren` wipe with cubic-out entrance and
cubic-in exit; `stagger`, `slide`, and `none` are explicit alternatives with four-direction motion.
Staggers reject atomically when they cannot fit before the first Step. Scale-pop, mask-slide, and
blur-in remain deferred until a real recipe needs them. Focused recipe/compiler/MCP tests pass,
`reviewCompositionDesign` scores the default output 100 with zero findings, its five-frame browser
strip was visually inspected, and dual-mode certification passed all five exact gates.

---

### W4 — Golden template corpus and template MCP tools (highest quality leverage)

**Problem.** `templates/` contains two files: `news-lower-third.ogs` and
`atlas-news-package.ogs`. That is not a library. Agents currently assemble professional graphics
from primitives every time, which is where taste failures originate.

**Change.**

1. Author **12–15 certified reference `.ogs` templates** spanning the real broadcast vocabulary:
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
  not make every existing project fail. Target: current `templates/*.ogs` score 85 or above after
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

### W12 — Full GDD schema support — **highest priority in this programme**

> Added 2026-08-24 after establishing the deployment target: these templates run in **Zero Density
> Lino** playout, driven by **Reality Hub**. That context makes the manifest schema the single most
> important surface OGraf Studio produces. Read the Deployment context section below before starting.

**Problem.** OGraf Studio implements seven flat scalar field types —
`text | textarea | number | boolean | color | gradient | image-url`
(`packages/scene-model/src/types.ts:379`) — over a `FieldDefinition` of
`{id, key, label, type, defaultValue, required}` (`types.ts:384`).

The official GDD schema vendored in `fixtures/ograf-schema/` defines considerably more, and **none of
the following is implemented**:

| OGraf GDD defines                                                      | Status  | Consumed by                                  |
| ---------------------------------------------------------------------- | ------- | -------------------------------------------- |
| `array` with `items`                                                   | missing | Variable-length collections from Hub modules |
| `object` with nested `properties`                                      | missing | Grouped operator fields                      |
| `select`, `select-multiple`                                            | missing | Form Builder dropdowns                       |
| `integer`                                                              | missing | Scores, counts                               |
| `duration-ms`                                                          | missing | Clocks, timers, countdowns                   |
| `percentage`                                                           | missing | Bars, gauges                                 |
| `file-path`                                                            | missing | Media pickers                                |
| JSON Schema constraints (`maxLength`, `minimum`, `maximum`, `pattern`) | missing | Operator-side validation                     |

Two further defects:

1. **`gddType` is never emitted.** `packages/validation/src/validateManifest.ts:15` registers the GDD
   type schema for _validation_, but `packages/codegen/src/compileDataSchema.ts` never writes a
   `gddType` on any property. Compiled manifests therefore carry plain JSON Schema with no GDD hints,
   so a consuming form builder cannot tell a colour picker from a text box.
2. **No operator-facing description.** `FieldDefinition` has `label` but no help text, so the
   generated form can never explain a field.

**Why this outranks everything else.** The schema is OGraf Studio's entire contract with the playout
stack. Reality Hub Form Builder generates the operator panel from it; Hub modules push data into it;
MOS fills it from the newsroom rundown. Concretely:

- No `array` → a Hub module can fetch a twelve-row leaderboard, but the template can only render a
  fixed count. Variable-length graphics are impossible — and this is an implementation gap, not a
  spec limitation.
- No `select` → operators type free text where a controlled vocabulary belongs.
- No `maxLength` → a journalist types 90 characters into a 40-character lower third. Authoring-time
  `ograf_measure_text` and shrink-to-fit cannot help, because the limit is never communicated to the
  form. This is the most common live-graphics failure in news.

**Good news on feasibility.** `JSONSchemaProperty` in `compileDataSchema.ts:8` _already_ declares
`enum`, `items`, `properties`, `required`, `minItems`, `minimum`, and `maximum` — the gradient field
already exercises the nested-object and array machinery at `compileDataSchema.ts:56`. The compiler is
largely capable; the **authoring model** is what is flat.

**Change — phase this. Do not attempt it as one commit.**

**W12a — scalar enrichment (low risk, most of the operator benefit).**

- Extend `FieldType` with `select`, `select-multiple`, `integer`, `duration-ms`, `percentage`,
  `file-path`.
- Extend `FieldDefinition` with optional `description`, `options` (for the select types), and a
  `constraints` object (`maxLength`, `minLength`, `minimum`, `maximum`, `pattern`, `step`).
- Emit `gddType` from `compileDataSchema.ts` for every field, including the existing types
  (`single-line`, `multi-line`, `color-rrggbb`/`color-rrggbbaa`, `file-path`).
- Surface all of it in the Inspector's data-field editor, `ograf_get_capabilities`, and the
  `add_data_field` / `update_data_field` MCP operations.
- Feed `constraints.maxLength` into authoring QA: `ograf_measure_text` should stress the declared
  maximum, and `designQa` should warn when a bound text layer has no `maxLength`.

**W12b — collections (`array` / `object`) — separate effort, own design pass.**

The data half is straightforward; the **rendering** half is the real work and needs a written design
before any code:

- How does an `array` field bind to layers? A repeated group must be cloned per item at runtime,
  which is a genuine new runtime capability in `packages/ograf-runtime`, not an authoring-time
  materialization. This is distinct from `create_repeater`, which is explicitly finite.
- How does it interact with `supportsNonRealTime`? Data is set before `goToTime()` seeks, so it is
  deterministic **provided** no animation depends on item arrival order or on a count that changes
  mid-timeline. State that constraint explicitly and enforce it in validation.
- What is the authoring representation? Most likely one template group tagged as the item prototype,
  with item-scoped bindings resolving against `array[i]`.
- What happens when the array is longer than the design accommodates? Define overflow (clip, scroll,
  paginate) as an authored property, not an accident.

Do not start W12b until that design is written and agreed.

**Constraints.**

- Bumps `PROJECT_DOCUMENT_VERSION` (16 → 17, or 17 → 18 if W8 lands first). Migration test mandatory;
  existing fields default to no constraints and no description.
- Every addition must validate against the vendored official schemas — the GDD fixtures are the
  authority, not this document.
- Certification must still pass; add a manifest test asserting `gddType` is emitted for every field
  and that constraints round-trip.
- Touches `scene-model` (types, factory, migrations), `codegen` (`compileDataSchema`), `validation`,
  the editor Inspector, `authoring-core` operations, and the MCP schema. It is the largest item on
  this board — budget accordingly.

**Acceptance.**

- A compiled manifest carries `gddType` and constraints for every field and passes official schema
  validation plus full certification.
- A `select` field renders as a dropdown, and a `maxLength` field as a length-limited input, in
  Reality Hub Form Builder against a real `.ograf.zip`.
- W12b only: a template renders a variable-length array end to end from a Hub module.

---

### W13 — Blend modes

**Problem.** No `blendMode` exists anywhere in the scene model, compiler, or runtime — confirmed by
search. `docs/ROADMAP.md:101` already queues blend modes alongside video and nested compositions.
Multiply, screen, add, and overlay are everyday broadcast-design tools; their absence caps how
sophisticated any template can look.

**Change.** Add an optional `blendMode` to every layer, compiling to CSS `mix-blend-mode`. It is
CSS-native, deterministic under `goToTime()`, static (not animatable — keep it a discrete setting
like shadow enable/colour), and compiles to a single property with no runtime dependency.

Support the useful subset rather than the full CSS list: `normal`, `multiply`, `screen`, `overlay`,
`darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`,
`exclusion`.

**Resolve this before writing code — it is the whole risk of the item.**

> **Blending against transparent output.** OGraf templates render over a transparent background for
> downstream keying. With no opaque backdrop there is nothing to blend into, and CSS blending is
> governed by stacking context and `isolation`. A layer set to `multiply` may look correct over the
> editor's checkerboard and disappear — or key incorrectly — on air.

Decide and document explicitly:

- Do layers blend only within their own group/stacking context, or against the entire composition
  stack beneath them?
- Does the composition root get `isolation: isolate`? If it does, layers can never blend with the
  external video bed; if it does not, behaviour depends on the renderer's compositing.
- What does a blended layer do when `transparentOutput` is enabled?

Whatever is chosen must produce **identical** results across Stage, OGraf Preview, PNG
capture/strips, SVG diagnostics, and the compiled runtime — the editor must not flatter the result.

**Constraints.**

- Bumps `PROJECT_DOCUMENT_VERSION`; migration defaults every existing layer to `normal`.
- Interacts with `clipChildren`: a clipping parent already creates a stacking context. Add explicit
  tests for a blended child inside a clipping parent.
- Add to `ograf_get_capabilities.elementSchemas`, the Inspector, and the MCP `update_element`
  operation.
- Verify against Lino, not only the devtool — blending is exactly where a renderer's compositor can
  legitimately differ.

**Acceptance.** A multiply-blended layer over a transparent composition renders identically in the
editor, in PNG capture, and in the certified package, and its on-air behaviour in Lino is documented.

---

## Deployment context

Established 2026-08-24. This changes how several priorities should be read, and it is the reason
W12 exists.

**These templates run in Zero Density Lino playout, orchestrated by Reality Hub.** That stack already
owns, by explicit design:

- **Data sourcing and business logic.** Reality Hub states that data handling belongs in Hub modules,
  "keeping rendering projects focused on graphics instead of external API connections, data parsing,
  and operational control," and that data is fetched, validated, normalized, filtered, and
  transformed in the module layer _before_ it reaches templates.
- **Operator interfaces.** Form Builder generates no-code operator panels from the template schema.
- **Rundowns and playout.** Lino Playout provides rundowns/playlists, Program/Preview, and Take
  In / Take Next / Continue / Take Out / Clear / Change / Update.
- **Newsroom integration.** MOS to iNEWS, ENPS, Octopus, and Dina; CII, RossTalk, and REST automation.
- **Multi-user, roles, permissions, and multi-channel operation.**

**Consequences for this programme:**

1. **Do not build data connectors, rundown features, MOS support, or operator UIs into OGraf Studio.**
   That is Reality Hub's layer, and duplicating it is wasted work.
2. **The manifest schema is the contract.** Everything OGraf Studio can express about a field becomes
   the operator's experience. This is why W12 is the highest-priority item.
3. **Broadcast-legal colour is deliberately out of scope.** Reality renders through its own engine
   and video I/O, which owns legal-range conversion. At most add a one-line advisory lint; do not
   build a colour pipeline.
4. **Certification against the official devtool is accepted as sufficient.** A cross-renderer matrix
   is low value when the target is one known renderer. One smoke test of a real `.ograf.zip` in Lino
   would close the remaining gap and is worth doing once.
5. **The relevant commercial benchmark is Viz Flowics** (cloud, 2D, HTML5), not Viz Artist. Flowics
   ships a public template library — independent confirmation of W4 — and treats localization/RTL as
   a shipping feature rather than a QA check.

---

## Sequencing

```
Phase 0   W1                     docs hygiene, unblocks every agent session          [done]
Phase 1   W12a -> W13            playout contract; highest value for the Lino target
Phase 2   W4 -> W3 -> W6         quality content; W3 must land before W5
Phase 3   W5                     quality oracle (depends on W3)
Phase 4   W2 -> W10 -> W9        context and round-trip efficiency
Phase 5   W8 -> W7               primitives and recipe breadth (W7 depends on W3)
Phase 6   W12b                   collections; BLOCKED on a written design pass
Phase 7   W11                    GATED on explicit user approval
```

W12a and W13 were promoted ahead of the quality content once the Lino/Reality Hub deployment target
was established: they determine what the playout stack can actually do with the output, which
outranks how good the output looks. W13 is small; W12a is not.

W2 remains independently shippable at any point and is the cheapest large win if context pressure is
the immediate pain.

**Document-version ordering.** W8, W12, and W13 each bump `PROJECT_DOCUMENT_VERSION`. Land them in a
deliberate order, one bump per item, each with its own migration and test. Do not batch them.

---

## What not to do

- Do not add a proprietary runtime primitive to solve a design problem. Materialize instead. The one
  sanctioned exception is W12b's array repetition, and only after its design pass.
- Do not build data connectors, polling, rundowns, MOS support, or operator UIs into OGraf Studio.
  Reality Hub owns that layer by design — see Deployment context. Express capability through the
  manifest schema instead.
- Do not invent field types or schema keywords. The vendored GDD fixtures in `fixtures/ograf-schema/`
  are the authority; if it is not in the spec, it does not ship.
- Do not build a broadcast-legal colour pipeline. The playout engine owns legal-range conversion.
- Do not make `designQa` non-deterministic or browser-dependent. Its value is that it runs anywhere.
- Do not hand-edit `docs/generated/mcp-contracts.*`.
- Do not widen `operations` to `z.unknown()` to shrink the schema (see W2).
- Do not start W11, and do not start W12b before its design is written and agreed.
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
- **W12 is the largest item on this board.** It spans `scene-model`, `codegen`, `validation`, the
  editor Inspector, `authoring-core`, and the MCP schema, and bumps the document version. Phasing it
  as W12a/W12b is not optional.
- **W12b introduces a genuine runtime capability.** Array-driven repetition means cloning layers at
  runtime inside `packages/ograf-runtime` — the first thing in this programme that cannot be solved by
  authoring-time materialization. It is legitimate (the array shape is spec-native and the runtime is
  already shipped in every package), but it must not break `supportsNonRealTime`. Write the design
  first.
- **W13's real risk is transparent output, not the property.** `mix-blend-mode` with no opaque backdrop
  is governed by stacking context and `isolation`; a layer can look correct in the editor and key
  wrongly on air. Resolve the isolation question before implementing, and verify in Lino rather than
  only against the devtool.
- **Three items bump the document version** (W8, W12, W13). Sequence them one at a time.
