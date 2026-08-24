# OGraf Studio — Next release

## Broadcast style packs

- Added immutable News, Sports, Entertainment, and Documentary catalog definitions containing
  palette, modular type scale, font weights/stacks, radius/outline, and motion conventions.
- Added `apply_style_pack` across the Resources panel, editor store, authoring core, MCP schema, and
  capability discovery. Applied values become normal editable Brand Kit tokens and materialized
  semantic layer properties; no style-pack runtime dependency is exported.

## Materialized recipe library

- Added bug/DOG, ticker/crawl, two-team scoreboard, and 24-hour clock recipes with compact editor
  selection, MCP operations, complete ID mappings, semantic roles/tags, constrained data fields,
  Timeline Groups, and style-pack-aware motion.
- The ticker uses a deterministic lifecycle-activated local X loop inside a `clipChildren` window;
  its finite lifecycle translation stays static. Scoreboard values use document-v20 text outlines.

## Validation

- `npm run verify` passes generated-contract drift, formatting, lint, all workspace typechecks,
  **300 tests across 58 files**, the runtime bundle, and the production editor build.
- Live browser verification rendered a coherent Sports scoreboard, clock, bug, and ticker package at
  99/100 design QA; deterministic half-loop ticker sampling and all five exact dual-profile
  certification gates passed.
- The generated MCP contract is 146,632 bytes, below the enforced 150,000-byte W2 budget. The
  authoring-only catalog is fully tree-shaken and leaves the playout runtime bundle unchanged.

This file is the unreleased changelog. Add completed, verified changes here before assigning the
next version and tag.
