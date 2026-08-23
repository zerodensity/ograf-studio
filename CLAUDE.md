# OGraf Studio

A browser-based visual editor for authoring OGraf-compliant HTML5 broadcast graphics templates (lower thirds, scoreboards, tickers), inspired by Loopic (https://app.loopic.io). OGraf spec: https://ograf.ebu.io/v1/specification/docs/Specification.html

**Before doing anything else, read `docs/HANDOVER.md` in full.** It has current build status, the data model, the canvas/timeline architecture (including two subtle race conditions already found and fixed — don't reintroduce them), and a list of environment-specific gotchas that will otherwise cost real time to rediscover. `docs/PLAN.md` is the original architecture plan (still directionally correct, but HANDOVER.md documents where reality diverged and is the source of truth for current state).

Quick facts:

- npm workspaces monorepo (not pnpm — pnpm doesn't work in this environment, see HANDOVER.md).
- Phases 0–4 are done (static builder, NLE-style keyframe timeline, undo/redo, data binding, real preview harness + export). Phase 5 sub-phases 5a–5d are also done (real `ograf-devtool` cross-check, non-realtime scheduling, real asset import, three new element types — Ellipse/Path/Image-Sequence). See docs/HANDOVER.md's "Phase 5 progress" for details and remaining Phase 5 items (nested Compositions, Lottie, masks, sandboxed custom-script escape hatch, visual path editor).
- `apps/editor` is the app; `packages/scene-model` is the real data model (now 6 element types: Rectangle/Ellipse/Text/Image/Path/Image-Sequence, plus an `Asset` registry for imported images); `packages/codegen` compiles a Composition into a descriptor + manifest; `packages/ograf-runtime` is the generic descriptor-driven `Graphic` Custom Element, including real `setActionsSchedule`/non-realtime scheduling and an Image-Sequence playback driver (also pre-built to `dist/graphic-runtime.js`, embedded into every exported `main.js`); `packages/validation` wraps ajv against a local OGraf manifest schema; `packages/ograf-types` mirrors the EBU `Graphic` interface + manifest shape. `packages/ui-kit` is still an empty stub.
- Dev/build scripts prebuild `ograf-runtime`'s dist bundle first (`npm run dev` / `npm run build` at the root) — don't run `apps/editor`'s dev script standalone without that bundle existing at least once. If you edit `packages/ograf-runtime/src` while the dev server is already running, rebuild it manually (`npm run build --workspace @ograf-editor/ograf-runtime`) — it does not auto-rebuild on file change.
- Dev server: `npm run dev` (root) → http://localhost:5173. Typecheck: `npm run typecheck`. Lint: `npm run lint` (oxlint, silent on success).
- Nothing is committed to git yet — confirm with the user before the first commit.
