# Example: animated lower third

1. Read `ograf_get_project`; record revision and composition ID.
2. Commit one additive batch adding a background rectangle, accent rectangle, name text, and role text with authored element styles and transforms; capture generated layer IDs.
3. Read the timeline, then add independent keys:
   - background `x`: off-canvas to on-canvas with `cubic-out`;
   - name `opacity`: 0 to 1 with `sine-out`;
   - role `x` and `opacity`: slightly delayed, with separate easing;
   - shadow opacity/blur only on the background.
4. Add name and role data fields, then bind by exact `layerName` + `fieldKey` where convenient.
5. Render the entrance start, mid-motion, settled frame, and exit. Inspect the property tracks to confirm stagger and independent easing.
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

# Example: flashing and pulsing on-air title

1. Create or select the text layer and retain the desired finite entrance/exit tracks.
2. Call `set_layer_loop` with lifecycle activation, a 30-frame duration, and infinite repeats.
3. Add local `opacity` keys `0.2 → 1 → 0.2` with Sine easing.
4. Add local `width` and `height` keys `base → pulse → base` with independent Back/Quad easing.
5. Inspect with `ograf_get_timeline`, then exercise `playAction`, capture multiple loop phases, and
   confirm `goToTime` returns the same pixels for the same scheduled timestamp.

The entrance Promise resolves normally while the loop continues. The loop never advances the
Graphic to another Step; the controller remains responsible for the next action.
