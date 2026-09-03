# Handover — 2026-09-02 — Path gradients, masks and Brand Kit removal

## Branch and revision

- Branch: `codex/ai-first-authoring`.
- Base commit: `7c0b2da2f9293d3e0ae2542b611714ed5f5fae13`.
- Changes remain in the working tree; no commit or push was requested.
- Roadmap: advanced graphics path paints/masks, plus broadcast Brand Kit removal.

## Completed and verified

- Document v26: path Paint, nonzero/even-odd holes, gradient stop animation/binding, layer masks,
  source-only visibility, inversion, independent animated sources, nested alpha dependencies and
  parent clipping. Components, duplication, collections and OGraf import preserve/remap sources.
- Shared Studio/runtime/capture rendering. Capture now preserves SVG mask references on an isolated
  clone instead of fetching local fragment IDs as images. The regression previously produced a
  solid red square; it now produces a red ring with green outside and through its hole.
- Inspector path gradient and mask controls; Resources **Remove applied pack**. Removal preserves
  materialized styles/timing and custom tokens, clears component links to removed pack tokens, and
  is undoable. Browser removal retained both Graphite custom tokens and identical layer data.
- Canonical MCP `set_layer_mask` and `remove_style_pack`, named source selection in atomic batches,
  mask relationships/consumers in queries, generated contracts and in-app AI prompt (about 7,442
  estimated tokens). Repository skill, portable ZIP and local Codex skill copy were updated.
- Packaged server embeds its export runtime explicitly. Existing-session project opening is now
  undoable instead of failing on the existing `editor` session.
- Current Graphite Motion background now uses only O/D with uneven gaps, native gradient paths and
  14 shared path masks. It has 38 layers, preserves seven signed row speeds, and repeats every 96 s.

## Verification

- `npm run verify`: passed, including contract/prompt drift, formatting, lint, workspace types,
  **441 tests across 90 files**, runtime build and editor build.
- `npm run build:standalone --workspace editor` and Windows executable packaging: passed.
- Browser checks: linear/conic paths with holes and strokes; independently rotating path masks;
  black/transparent gradient alpha, blur, inverse masks, image alpha; deterministic seeks; mask-aware
  PNG capture; Inspector controls and Brand Kit removal.
- Installed executable: project/official OGraf manifest/package/module and realtime/non-realtime
  lifecycle certification all passed on the O/D project.
- O/D sampled position, opacity, blur and shadow values have zero difference at elapsed frames
  0 and 4800. Vertical face gradients preserve the intermediate horizontal tile-wrap seams.
- Skill `quick_validate.py`: passed for repository and installed copies.

## Environment and artifacts

- Studio: `http://127.0.0.1:4318/`; MCP: `http://127.0.0.1:4318/mcp`.
- Installed server: `C:\works\zd_ograf_editor\release\OGrafStudioServer.exe`.
- SHA-256: `8DF33A9B1AF2A1EBF5FF982D1DB8719678A6AA1B2415FAEF06120FE965CCF704`.
- Prior executable retained as `release/OGrafStudioServer-before-path-masks.exe`.
- Editable/output graphic: `C:\Users\smalkim\Documents\OGraf Studio\Projects\Graphite Motion`.
- Live exported-graphic preview: `http://127.0.0.1:4320/preview.html?v=1.2.0`.
- Installed authoring skill: `C:\Users\smalkim\.codex\skills\ograf-authoring`.
- `scripts/smokePathMasks.ts` prepares a six-case browser fixture under editor dist for local source
  hosting after builds. Verification logs are in `.tmp/verify-path-masks.log`.
- Source-change backup is under `C:\Users\smalkim\Documents\ChatGPT\Ograf\studio-feature-deliverables`.

## Limits

- Alpha sources: rectangle, ellipse, path, image. Path mode: rectangle, ellipse, path. Every layer
  kind can be a target. Text/Lottie/image-sequence sources and luma mode remain outside this profile.
- Conic alpha uses half-degree SVG tessellation; native visible gradients retain CSS rendering.
- Runtime/capture were checked in the local Chromium environment. Other target renderers and
  sustained frame-time performance are not claimed as measured or certified by this run.
- Headless certification and broader compositor/procedural features remain deferred.
