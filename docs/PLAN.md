# OGraf-Compatible HTML5 Graphics Template Editor — Original Architecture Plan

> **Note (added at handover time):** this is the original plan approved before any code was written. It's still the right mental model for the overall shape of the project, but see `docs/HANDOVER.md` for what was _actually_ built, where implementation deviated from this plan (stack versions, package manager, a couple of terminology changes), and what's genuinely next. Treat this file as historical/directional, and HANDOVER.md as the source of truth for current state.

## Context

`C:\works\zd_ograf_editor` is currently empty — this is a greenfield build. The goal is a **visual/WYSIWYG editor** for authoring OGraf-compliant HTML5 broadcast graphics templates (lower thirds, scoreboards, tickers, etc.), filling a real gap in the OGraf ecosystem: the existing reference tools (SuperFlyTV's `ograf-devtool` and `ograf-server`) only _test/play_ already-hand-coded templates — neither lets a non-programmer author one visually. The commercial product **Loopic** (https://app.loopic.io) is the explicit feature/UX north star (inspiration only — no copied code), since it already does this for CasparCG/SPX/LiveOS/H2R and recently added OGraf export.

This plan is informed by deep research into:

- The **OGraf Graphics spec** (manifest format `*.ograf.json`, the `Graphic` Custom Element JS interface: `load`/`dispose`/`updateAction`/`playAction`/`stopAction`/`customAction`/`goToTime`/`setActionsSchedule`, `stepCount`/`renderRequirements` capability model).
- The **OGraf Server API spec** (REST contract a real Controller/playout system would use against a Server/Renderer — informs what our in-app preview harness must faithfully emulate, but is not itself something this editor needs to implement).
- **ograf-devtool** and **ograf-server** source (React+Vite/Koa reference implementations; Shadow-DOM Custom Element isolation pattern; layer-manager/graphic-instance architecture).
- **Loopic's** documented editing model (Composition/Layer/Element hierarchy, keyframe+bezier animation, `key`-based data binding, Template Definition Builder, Actions API) — used as the primary UX precedent, adapted where it conflicts with OGraf's discrete step-based lifecycle contract.

Confirmed product decisions: **visual/WYSIWYG builder**, **web app**, **built-in OGraf-compliant preview/test harness**, **local-only storage (no backend)**, **modern evergreen Chromium baseline only**.

## Architecture Decisions

**Stack**: TypeScript (strict) + React 18 + Vite 5 + pnpm workspaces. Zustand+Immer for state, with a custom named-undo-step command stack (not generic time-travel).

**Canvas approach — real DOM+CSS, not a canvas/SVG abstraction.** Since OGraf graphics _are_ DOM/CSS Custom Elements, the design canvas manipulates real elements directly via `react-moveable`/`react-selecto` (drag/resize/rotate/snap on real `transform` CSS), eliminating any edit-time↔export-time fidelity gap. Every Layer's pose is `translate/rotate/scale` + `transform-origin`, matching Loopic's own property set.

**Animation engine — GSAP 3** (free), used both for in-editor timeline authoring and inside the exported runtime.

**The Steps-vs-frames decision (most important call in the project).** Reject Loopic's continuous-frame-timeline-plus-arbitrary-JS as the _primary_ authoring model. Instead: **discrete, named Steps** (each a full pose snapshot of every layer) connected by **Transitions** (per-property keyframes/bezier easing, GSAP-driven), compiled underneath into one continuous GSAP master timeline with step-boundary labels. This makes templates _correct by construction_ against OGraf's contract:

- `stepCount` = `steps.length` (or `0` for an "auto play, no pause" toggle).
- `playAction({goto/delta})` = seek/tween the master timeline to a step label, return `currentStep`.
- `goToTime`/`setActionsSchedule` (non-realtime) fall out for free as `timeline.seek()` / scheduled dispatch, since the compiled representation is already one continuous timeline.
- `updateAction` = an optional per-layer "update pulse" (keyframed emphasis, no user JS needed for common cases).
- `stopAction` = plays the Transition into an author-flagged **Outro step** (visual marker, echoing Loopic's red outro-frame).
- A sandboxed "advanced custom script" escape hatch (Loopic's `useOnInvoke` analogue) is deferred to Phase 5, off by default, wrapped in try/catch/timeout so it can't break lifecycle correctness.

> **Handover update:** "Steps" were renamed to **"Keyframes"** on explicit user request after Phase 2 shipped (see HANDOVER.md). The concept, and everything below about it, is unchanged — only the name. Also, transition timing moved from milliseconds to **frames** (`Composition.frameRate` + `Transition.durationFrames`), per a later user request.

**Data binding** — a **Data panel** modeled directly on Loopic's Template Definition Builder: author defines typed `FieldDefinition[]` (text/textarea/number/boolean/color/image-url), binds each to a Layer's `bindingKey`+target property via a plain dropdown (no code). Compiles straight into the manifest's `schema` (JSON Schema) and a declarative binding-dispatch table consumed at runtime by `load()`/`updateAction()`. Custom Actions authored the same way, compiling into `manifest.customActions[]`.

**Preview/test harness** — `RendererHarness` renders a live-compiled Custom Element inside an **open** Shadow DOM (open rather than ograf-devtool's closed, deliberately, for in-tool debuggability), sourced by compiling the in-memory Project through the _same_ compiler used for real export (critical: preview and export must never diverge). Test toolbar: Load (schema-driven form), Play/Pause/Step nav, Update-Data form, Custom Action picker, non-realtime scrub bar + schedule editor (shown only if `supportsNonRealTime`), Issue/error panel (catches thrown errors and the OGraf-specific `550` status).

**Runtime is interpreted, not templated per-project.** One hand-written generic class, `GraphicElement extends HTMLElement implements Graphic`, interprets a compiled JSON "descriptor" (Lottie-player-style architecture) rather than generating bespoke JS per template — this is what guarantees preview and export are identical and drastically shrinks the export-bugs surface.

**Export pipeline** (fully client-side, no backend needed): Project → Compiled Descriptor → assemble `{id}.ograf.json` manifest → bundle `GraphicElement` + trimmed GSAP + inlined descriptor into a single dependency-free `main.js` (esbuild-wasm) → validate against the EBU JSON Schema via **ajv** (cached copy for offline use, block export on failure) → copy/optimize assets, auto-capture thumbnails from the harness → zip with **JSZip**, save via File System Access API (`showSaveFilePicker`).

**Storage**: local-only via File System Access API for both editor projects and export, matching both reference tools' precedent — no backend at all. (Firefox/Safari get a degraded download/upload-based fallback later; not a Phase 0–4 blocker.)

## Project Structure

```
/apps
  /editor                    # React+Vite SPA
    src/canvas/                # Stage.tsx, LayerNode.tsx, react-moveable wiring
    src/panels/                 # Resources, Inspector, Steps/Timeline, Data, Export, Preview
    src/store/                    # Zustand stores + undo/redo command stack
/packages
  /ograf-types                 # TS mirrors of EBU JSON Schemas + the Graphic interface
  /scene-model                  # Project/Composition/Layer/Element/Step/Transition types
  /ograf-runtime                 # GraphicElement.ts — generic descriptor interpreter (shared by preview+export)
  /codegen                        # descriptor compiler, manifest assembler, esbuild bundling, JSZip packaging
  /validation                      # ajv wrapper + cached EBU schema fetch/fallback
  /ui-kit                            # shared Inspector rows, bezier curve editor, drag-scrub number input
/fixtures                            # sample .ograf.json packages, used to cross-test against ograf-devtool
```

## Phased Roadmap (each phase independently demoable)

- **Phase 0 — Scaffold**: pnpm workspace, Vite+React+TS shell, six-panel layout skeleton, lint/typecheck.
- **Phase 1 — Static builder**: Project/Composition/Layer/Element model (Rectangle/Text/Image), real DOM+CSS canvas with drag/resize/rotate/snap, layer list, Inspector, single implicit Step, local autosave via File System Access API. _Demo: build a static lower-third._
- **Phase 2 — Steps & Transitions**: Steps panel, per-step pose capture, per-property bezier-eased Transitions (GSAP), in-canvas play/scrub. _Demo: animated multi-step lower-third, playing live._
- **Phase 3 — Data binding**: Data panel (Field Definitions, bindingKey wiring), live test-data panel, `schema` generation, Custom Actions authoring.
- **Phase 4 — Preview harness + Export**: `GraphicElement` generic runtime, Shadow-DOM preview harness with full action test-control toolbar + Issue panel, ajv manifest validation, full zip export. **Compliance gate: export a real package and successfully load it in the actual open-source `ograf-devtool`.**
- **Phase 5 — Polish/advanced**: nested Compositions, Path/Ellipse/Image-Sequence/Lottie elements, guide layers, masks, auto-thumbnails, non-realtime scheduling authoring UI, advanced binding expressions, sandboxed custom-script escape hatch, undo/redo polish.

> **Handover update:** Phases 0–2 are done and verified (Phase 2 subsequently extended well past its original scope — see HANDOVER.md for the real NLE-style timeline, frame-based timing, undo/redo, and terminology rename that came after). Phase 3 has not been started.

## Critical Files (build order)

1. `packages/scene-model/src/model.ts` — Project/Composition/Layer/Element/Step/Transition types; everything else builds against this.
2. `packages/ograf-types/` — TS types mirrored from `https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json` and the EBU `Graphic` interface.
3. `apps/editor/src/canvas/Stage.tsx` — the real DOM+CSS WYSIWYG canvas + `react-moveable` integration.
4. `packages/codegen/src/compileDescriptor.ts` — Project → Compiled Graphic Descriptor (shared by preview and export).
5. `packages/ograf-runtime/src/GraphicElement.ts` — the generic descriptor-driven Custom Element; the piece that makes preview and export identical.
6. `packages/codegen/src/assembleManifest.ts` — Compiled Descriptor + Project settings → `.ograf.json`.
7. `packages/validation/src/validateManifest.ts` — ajv + cached EBU schema, the compliance gate before export.

> **Handover update:** items 1 and 3 exist (as `scene-model/src/types.ts`+`factory.ts`, and `Stage.tsx`). Items 2, 4, 5, 6, 7 are still just empty placeholder packages — none of Phase 4 has started.

## Verification

- Each phase ends with a manual run (`pnpm --filter editor dev`) demonstrating the phase's stated demo scenario in a real Chromium browser.
- Phase 4's gate is the strongest correctness signal available short of a real Renderer: export a template and load it in `ograf-devtool` (cloned locally, per its README: `npm i && npm run install:client && npm run build:client && npm run start`) to confirm the manifest validates and the Custom Element's lifecycle methods behave as expected end to end.
- `packages/validation`'s ajv check against the live EBU schema URL is the automated compliance check going forward; add it as a unit test fixture using the sample packages under `/fixtures`.
- No automated test framework choice is locked in this plan — recommend adding Vitest for `packages/*` unit tests starting Phase 1 (compiler/manifest logic is the highest-value thing to unit test), and deferring end-to-end/browser test tooling until the canvas interactions in Phase 1–2 stabilize.

> **Handover update:** the `pnpm --filter editor dev` command doesn't work in this environment — use `npm run dev` from the repo root instead (see HANDOVER.md, "Environment gotchas"). No automated tests (Vitest or otherwise) have been added yet — everything so far has been verified manually via the Browser pane tooling.

## Explicitly Deferred / Assumed Defaults (not blocking, revisit later)

- No real-time multi-user collaboration in MVP (Loopic doesn't have it either; local-only storage rules it out for now anyway).
- Lottie import deferred to Phase 5.
- Exported packages default to fully self-contained/offline-capable (`accessToPublicInternet: false` by default in `renderRequirements`), overridable per project.
- No import/migration path from Loopic/CasparCG/SPX project files — net-new authoring only.
