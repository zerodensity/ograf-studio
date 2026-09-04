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
- Lottie source frames include `animationData.ip`, while the bundled player seek API is relative to
  that in-point. Keep conversion at the runtime adapter boundary. `load()` must await Lottie
  `DOMLoaded`; a timer or successful JSON parse is not proof that embedded assets rendered.
- Lottie input must be one complete self-contained document. Reject external image/font paths,
  segmented documents, undecodable/nonpositive embedded images, and luma mattes; alpha mattes are
  supported. Expressions remain warning-only because the light Canvas build ignores them.
- A changed non-realtime Lottie seek rebuilds and awaits the light Canvas player. Certification
  compares exact Canvas pixel signatures before and after a backward/repeated seek. Realtime keeps
  one player and uses absolute elapsed time; Canvas proof does not establish another renderer.
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
- Generic keys and transitions default to linear; intentional non-linear recipe motion must be
  explicit. Existing stored or migrated easing remains authoritative.
- Ordinary newly added layers default to opacity 1 at Start, Step, and End. Hidden lifecycle
  boundaries must be explicit authored motion rather than an implicit generic-layer side effect.
- Authored transform/effect edits write every lifecycle frame; frame-scoped edits require an
  explicit frame.
- Shrink-to-fit never renders below the text layer's authored `minFontSize`. A degenerate result
  means that floor was reached and the box still cannot contain the text.
- Fit-to-width may grow above or shrink below the authored font size. It chooses the largest uniform
  size that contains the complete text and stroke inside both fixed box axes, without non-uniform
  glyph distortion; only explicit line breaks create multiple lines.
- Squeeze deliberately scales glyph width and height independently to fill both authored box axes.
  Treat that deformation as intentional styling rather than a legibility fallback.
- Duplicate-group frame offsets never clamp keys; insufficient duration is an atomic error.
- A clipping parent masks only direct children whose `parentId` points to it. The mask follows the
  parent's animated transformed bounds, rotation/origin, and rectangle radius; duplicated groups
  must remap both ids. Child rotation remains independent rather than inheriting the parent angle.
- Authored dimensions remain positive, so a collapsed wipe mask uses the normalized one-pixel
  minimum rather than an invalid zero-sized layer. Stagger recipe keys must fit entirely before the
  first pausable Step and reject instead of clamping or crossing lifecycle bounds.
- Intentional ancestor clipping is not text-box overflow and must not become a validation fault.
- Gradient paints require at least two normalized stops with finite angle, offsets, and opacities.
- Path fills use the shared paint contract and a nonzero/even-odd fill rule. Their gradients span
  the rendered layer box, and existing solid paths migrate without pixel changes.
- Pattern instances reference one composition resource. Compilation resolves its definition;
  package import deduplicates those resolved definitions back into editable shared resources.
  Seeded spacing is fixed across cycles, and row travel is an integer multiple of the motif period
  over `cycleFrames`. Pattern SVG paint repeats per tile; shared geometry and mask clocks remain
  synchronized independently of numeric effect-loop duration. Limits are 32 rows, 32 symbols and
  64 sequence entries; invalid definitions and deletion of referenced resources fail atomically.
- A layer mask references a same-composition source; sources cannot be guides or participate in
  cycles. Alpha sources may be rectangles, ellipses, paths, patterns or images; geometric path mode excludes
  images and ignores source opacity/effects. Targets may be any layer type. Inversion is confined
  to target bounds. A source-only layer remains in the compiled descriptor but does not paint.
  Masks and clip-to-parent can coexist. Mask chains include the source's own alpha mask and clip;
  path mode uses only its geometry. Collection masks remain internal to each prototype instance.
- Masks use SVG compositing in the shared renderer; conic paint alpha uses half-degree SVG wedges
  because browser SVG masks do not render embedded HTML. Visible path gradients use native CSS.
- Gradient stop-offset tracks use `fill.stops[N].offset`, reference an existing zero-based stop, and
  keep authored key values within 0..1.
- Blend modes are static layer properties evaluated inside one isolated transparent composition.
  They must not depend on, sample, or change according to an external controller/video background.
  Editor transparency checkerboards remain outside the composition isolation boundary.
- Loop keys use a separate local `0..durationFrames` ruler. Keep infinite-loop endpoints visually
  seamless unless an offscreen masked wrap is intentional.
- Semantic roles, tags, and descriptions are authoring-only. They may guide queries, recipes, QA,
  and review, but must not add a runtime dependency or alter OGraf lifecycle behavior.
- Brand-token links are authoring-only and their current values must be materialized into supported
  element properties before compilation.
- Repeater output and component instances compile as ordinary layers and fields. Linked component
  refresh is an explicit authoring replacement, never a playout-time master/instance relationship.
- A visual proposal must apply only after explicit acceptance and only against its original base
  revision. Rejection, expiry, or revision drift leaves the project unchanged.

## Data

Field keys must be unique. Nested object keys must be unique among siblings. Bindings resolve to
stable field IDs, a scalar leaf through an unambiguous `sourcePath` segment array, and a valid element
target property. Asset IDs are unique and `asset:<id>` references must resolve inside the same
composition. Keep authored defaults useful because they become schema defaults and are exercised
during lifecycle certification.

Every field compiles an operator-facing `gddType`. Select defaults must reference declared options;
select-multiple defaults must contain only declared string values. Descriptions, option labels, file
extensions, recursive object properties, array item schemas, and constraints belong in the manifest
schema and must survive OGraf import/export. A runtime collection accepts only object-item arrays,
one contiguous persistent-group prototype, explicit finite offsets, capacity 1..100, and truncate
overflow. Capacity equals `maxItems`; prototype clip parents stay inside the prototype; one array
field drives at most one collection. Scheduled updates are pure index-based snapshots and must remain
reproducible when `goToTime()` seeks backward.
