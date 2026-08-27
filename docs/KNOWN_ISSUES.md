# Known Issues

- Remote presentation backgrounds are editor-only but remain dependent on their source host. Big
  Buck Bunny streams from jsDelivr, and still-image URLs can fail offline or when facility network
  policy blocks their host. Locally selected still images are embedded in `.ogs` and remain
  available offline.

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
  large aggregate registries can still exhaust browser storage because `.ogs` remains a
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
- Visual operation previews, proposal images, browser text measurement, and exact certification
  still require one connected, responsive editor tab. Headless render/certify is intentionally not
  part of this implementation and remains deferred.
- W2 reduced the generated MCP contract from 334,854 to 133,868 bytes by removing two duplicated
  operation-tool schemas. It is now guarded by a 150,000-byte drift budget. Further prompt/context
  reduction depends on W10 capability projections and the reduced in-app tool filter; the removed
  `ograf_preview_operations` and `ograf_propose_operations` names are a deliberate public MCP break
  in favor of `ograf_apply_operations` modes.
- Semantic roles/tags and deterministic design/motion QA improve selection and review but are
  advisory authoring metadata, not an automatic guarantee of good editorial design.
- Linked component refresh is explicit and replacement-based. It preserves instance placement but
  can replace local content/style edits; use independent instances when those overrides must remain
  permanent. Granular override tracking is not implemented.
- Repeaters materialize a finite collection at authoring time. They do not expose a runtime array
  field or dynamically add/remove rows from controller data.
- W12b runtime collections are deliberately bounded and index-based. They accept object-item arrays,
  explicit X/Y stride, capacity 1..100, and truncate overflow. Scalar arrays are schema-only;
  scroll, pagination, grids, keyed reordering animation, independent item timing, and nested repeated
  arrays remain unimplemented. Official-schema/devtool certification is covered, while one real
  Reality Hub → Lino module smoke test remains required for target-stack proof.
- Blend modes intentionally composite only against lower layers inside the isolated OGraf
  composition. They never sample a controller or graphics server's external video bed. Target
  renderer differences in CSS blend-mode precision still require the planned Lino/on-air smoke
  matrix before this feature is described as renderer-certified.
- Brand-token links are composition-local authoring metadata. Values are portable because they are
  materialized into standard layer properties, but there is no cross-project token library or
  playout-time theme token API.
