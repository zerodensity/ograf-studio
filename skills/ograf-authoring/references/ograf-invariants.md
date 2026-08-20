# OGraf authoring invariants

## Compatibility

The EBU OGraf v1 specification and official schemas outrank local assumptions. A project being semantically valid is necessary but insufficient: final output must also pass manifest schema, package layout, ESM/default-export/API, realtime lifecycle, and non-realtime lifecycle checks.

Save/export must certify the same artifact bytes that are written. If certification is unavailable or fails, stop and report the errors; do not create an uncertified substitute.

## Lifecycle and timing

- Every composition has exactly one Start first and one End last.
- Only Step states may occur between them and contribute to OGraf `stepCount`.
- Transitions connect adjacent lifecycle states.
- Layer animation keys sit on the composition frame ruler but belong to one layer and one property.
- Frame rate and transition durations determine the total frame range.
- Non-realtime behavior must remain deterministic under `goToTime()` and scheduled-action replay.
- Local loop clips share the OGraf clock. Derive their phase from the action schedule and timestamp,
  never mutable timer ticks. A loop may continue while parked at a Step but must not call or advance
  `playAction`, `stopAction`, or another lifecycle state itself.

## Scene behavior

- Width, height, and frame rate must remain positive.
- Authored positions and sizes are normalized by the core; frames are integers.
- Guide layers are editor-only and do not render to output.
- Each property track retains at least one key.
- Easing is per incoming property key, never global.
- Custom cubic Bézier curves override the named easing for that key.
- Authored transform/effect edits write every lifecycle frame; frame-scoped edits require an
  explicit frame.
- Shrink-to-fit never renders below 50% of authored font size. A degenerate result means the floor
  was reached and the box still cannot contain the text.
- Duplicate-group frame offsets never clamp keys; insufficient duration is an atomic error.
- A clipping parent masks only direct children whose `parentId` points to it. The mask follows the
  parent's animated transformed bounds, rotation/origin, and rectangle radius; duplicated groups
  must remap both ids. Child rotation remains independent rather than inheriting the parent angle.
- Intentional ancestor clipping is not text-box overflow and must not become a validation fault.
- Gradient paints require at least two normalized stops with finite angle, offsets, and opacities.
- Gradient stop-offset tracks use `fill.stops[N].offset`, reference an existing zero-based stop, and
  keep authored key values within 0..1.
- Loop keys use a separate local `0..durationFrames` ruler. Keep infinite-loop endpoints visually
  seamless unless an offscreen masked wrap is intentional.

## Data

Field keys must be unique. Bindings resolve to stable field IDs and a valid element target property. Asset IDs are unique and `asset:<id>` references must resolve inside the same composition. Keep authored defaults useful because they become schema defaults and are exercised during lifecycle certification.
