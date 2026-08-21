# Known Issues

## Closed P0 foundation issues

- Explicit lifecycle state, deterministic seeking, transition reconnection, shared timelines,
  canonical validation, blocked invalid export, and dev-time runtime rebuilds were implemented on
  2026-08-15.

## P1 — Reliability

- The product now runs runtime DOM/module/lifecycle certification before every file save, but
  overlapping-action, automated cross-browser E2E, and renderer-matrix coverage is still
  incomplete. ZIP re-import is best-effort: editor-generated descriptors round-trip substantially,
  while arbitrary third-party runtime JavaScript yields a manifest-only editable shell because the
  importer deliberately does not execute untrusted code or attempt general JavaScript decompilation.
- Asset payloads now persist once in `composition.assets` and layers/fields may use `asset:<id>`;
  large aggregate registries can still exhaust browser storage because `.ogeproj` remains a
  self-contained JSON document.
- The editor production bundle is large and needs route/panel code splitting.
- Every package containing a Lottie layer currently embeds the light canvas player (roughly 450 KB
  before ZIP compression). The supported profile is canvas-only and continuously looped; external
  images/fonts, expressions, markers/segments, one-shot playback, and dynamic Lottie text are not
  yet supported. Browser tests cover the deterministic model and bundle, but target HbbTV/OGraf
  renderer certification is still required.
- Font choices currently reference local system stacks rather than embedding font files. OGraf
  packages remain valid, but typography can fall back differently on a renderer without that face;
  portable font-resource packaging is still required for pixel-identical playout.
- `ograf_capture.resolvedFonts` reports the first available family in the authored stack using the
  browser Font Loading API, but is explicitly inferred. Per-glyph physical font reporting requires
  a future CDP-controlled browser path.
- The local editor bridge intentionally owns one live browser socket. Opening the same editor in
  multiple tabs makes those tabs replace one another and can produce noisy external revisions;
  single-owner arbitration or tab identity is still required.
