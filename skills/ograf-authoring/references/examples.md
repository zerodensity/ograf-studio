# Example: animated lower third

1. Read capabilities and the current revision, then call `create_lower_third` with the intended
   placement, initial headline/subheadline, field keys, and theme. Keep the default `wipe` for a
   professional mask reveal, or explicitly choose `stagger`, `slide`, or `none` when required.
2. Capture the returned layer, field, canvas-group, and timeline-group IDs. Refine the ordinary
   generated layers with normal element/transform operations and assign any additional semantic
   tags needed for later queries.
3. Read the timeline and confirm the default panel width wipe arrives with `cubic-out` and the End
   key uses `cubic-in`. Refine independent keys only when the brief needs motion beyond the recipe.
4. Use `ograf_preview_operations` for uncommitted visual refinements. If the change substantially
   affects layout/theme/motion, use `ograf_propose_operations` so the human can Accept or Reject it
   in OGraf Studio.
5. Run `ograf_review_design`, then render entrance start, mid-motion, settled frame, and exit.
   Inspect property tracks to confirm stagger and independent easing.
6. Validate and certify. Save `.ogeproj` only if requested; export `.ograf.zip` only if requested.

Use a small number of coherent batches so undo remains meaningful. Bind a field created earlier in
the same batch by `fieldKey`; use `fieldId` after its creation result has been returned.

# Example: repeated forecast cells

1. Register shared icons once with `add_asset`; retain the returned `asset:<id>` references.
2. In one batch, build one complete `D1` cell, add its data fields, and bind by exact `layerName` and
   `fieldKey`. Same-batch selectors resolve creations from earlier operations.
3. Author the source cell's entrance, hold, and exit property tracks before duplication.
   For a wipe, set `clipChildren: true` on the body, assign the content layers' `parentId` to it,
   and animate only the body's `height`; use a gradient rectangle fill instead of a fixed sheen asset.
4. Dry-run, then commit one `duplicate_group` using:
   - `count` for the remaining cells;
   - `transformOffset` for column spacing;
   - `frameOffset` for the authored-key cascade;
   - `bindings: "clone"`;
   - `namePattern: "D{n} "`;
   - `fieldKeyRewrite: {from: "d1", to: "d{n}"}`;
   - `labelRewrite: {from: "Day 1", to: "Day {n}"}`.
5. Retarget cloned defaults with `update_data_field` by `fieldKey`; no project read is needed solely
   to recover copied field IDs.
6. Create a named, color-coded timeline group for each completed day cell using its returned layer
   IDs. This keeps the repeated animation rows navigable without changing the canvas groups or
   compiled OGraf result.
7. Sample the first, middle, and last cells with `ograf_sample_tracks`, then inspect the complete
   cascade with `ograf_render_strip` and no explicit `frames`.
8. Run summary overflow validation with representative long values, broadcast lint, and exact OGraf
   certification before any requested save or export.

Lifecycle compatibility keys remain at Start/Step/End. Only authored non-lifecycle keys consume
positive `frameOffset` headroom.

For a simpler finite collection, select the source cell layers and use `create_repeater` with item
records, direction, and gap. It materializes grouped ordinary layers and independent fields with
semantic item/index tags. Use the lower-level `duplicate_group` workflow above when each copy needs
custom frame offsets, rewrite rules, or explicit binding share/clone/clear control.

# Example: Brand Kit and linked component review

1. Create Brand Kit tokens such as `brand.primary`, `type.headline.family`, and
   `type.headline.size`; bind them to compatible layer properties.
2. Save the reviewed layer selection as a component. Insert independent instances for graphics
   that will diverge, or linked instances when later explicit refresh is desired.
3. To revise the source, update the component snapshot from selected layers, preview a
   `refresh_component_instances` operation, and present it through `ograf_propose_operations` when
   replacement could remove local instance changes.
4. Accept only after the editor preview is correct; then query semantic roles/tags and rerun design
   QA to confirm every refreshed instance remains legible and on-air safe.

# Example: flashing and pulsing on-air title

1. Create or select the text layer and retain the desired finite entrance/exit tracks.
2. Call `set_layer_loop` with lifecycle activation, a 30-frame duration, and infinite repeats.
3. Add local `opacity` keys `0.2 → 1 → 0.2` with Sine easing.
4. Add local `width` and `height` keys `base → pulse → base` with independent Back/Quad easing.
5. Inspect with `ograf_get_timeline`, then exercise `playAction`, capture multiple loop phases, and
   confirm `goToTime` returns the same pixels for the same scheduled timestamp.

The entrance Promise resolves normally while the loop continues. The loop never advances the
Graphic to another Step; the controller remains responsible for the next action.
