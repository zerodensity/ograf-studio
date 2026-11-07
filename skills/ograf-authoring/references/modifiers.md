# Smart layout modifiers

Discover `elements` capabilities and inspect the composition before authoring. `modifiers` in the
capability result lists types, numeric ranges, `staticParameters` and `splinePath` controls;
project reads with `include:["elements"]` retain
each layer's modifier stack. Inspection returns `modifierAnimationProperties` with stable paths.

Modifiers derive layout/visibility without overwriting authored transforms. The editor, preview,
captures and exported runtime share evaluation. They are not shader effects or JavaScript snippets.
This milestone has layer-owned stacks; geometry references and Hide targets can name groups.
Grid Arrange, Radial Arrange and Justify are container modifiers: the owner arranges its direct
children (`parentId`, Scene order) and each child's own descendants move rigidly with it.

## Operations

Use these inside ordinary revision-checked `ograf_apply_operations` batches:

- `add_modifier`: layerId or exact layerName, modifierType, params, optional name/enabled/index.
  Returned results contain the stable modifier ID and numeric property paths.
- `update_modifier`: modifierId and patch `{name?,enabled?,params?}`. Numeric edits accept authored
  or explicit frame scope. Existing bound numeric defaults remain editable.
- `duplicate_modifier`: copies its own tracks and bindings under a new ID, initially disabled.
- `remove_modifier`: removes only that entry and its owned tracks/bindings.
- `reorder_modifiers`: modifierIds must include the whole owner's stack exactly once.

Maximum 16 modifiers per layer. Numeric paths are `modifiers.ID.PARAM`; use normal property/loop
tracks or a numeric field binding. Use returned IDs, not list indices. References use
`{kind:"layer",layerId}` or `{kind:"group",groupId}`; IDs refer to the same composition.
Runtime data takes precedence over sampled keys on a bound numeric parameter.
Enums, references and boolean switches are static; do not create numeric tracks for them. Grid
columns/rows and radial count/rings are numeric channels rounded to whole counts at evaluation.

## Lower-third chain

Create the title, backing and logo first, then use their returned IDs:

```json
[
  {
    "type": "add_modifier",
    "layerId": "TITLE_ID",
    "modifierType": "max-text-width",
    "params": { "maxWidth": 720, "mode": "squeeze" }
  },
  {
    "type": "add_modifier",
    "layerId": "BACKING_ID",
    "modifierType": "auto-size",
    "params": {
      "source": { "kind": "layer", "layerId": "TITLE_ID" },
      "width": true,
      "height": false,
      "paddingLeft": 24,
      "paddingRight": 24
    }
  },
  {
    "type": "add_modifier",
    "layerId": "LOGO_ID",
    "modifierType": "auto-follow",
    "params": {
      "source": { "kind": "layer", "layerId": "BACKING_ID" },
      "axisX": true,
      "axisY": false,
      "sourceAnchorX": 1,
      "targetAnchorX": 0,
      "offsetX": 12
    }
  }
]
```

Auto Size preserves its authored anchor; position the backing intentionally or add Follow to
position it relative to the title. Size and Follow can coexist on the same object when their
dependencies do not cycle. Squeeze changes horizontal glyph scale only; Shrink scales both axes
and respects `minFontSize`, so a legibility floor can prevent complete fitting.

For Hide on Empty use source `{kind:"layer",layerId:"TEXT_ID",property:"content"}` or
`{kind:"field",fieldId:"FIELD_ID",sourcePath:[]}`. Image layers use property `src`. An omitted
target hides the owner; `target:{kind:"group",groupId:"GROUP_ID"}` hides the chosen group.
`trimWhitespace` defaults true; `invert` defaults false. Zero and false stay meaningful.

## Arrangement, Look At and Spline Path

Parent the items first (`set_layer_layout` with `parentId`), then add to the container:

```json
[
  {
    "type": "add_modifier",
    "layerId": "ROW_ID",
    "modifierType": "grid-arrange",
    "params": { "columns": 6, "rows": 0, "spreadX": 216, "spreadY": 276 }
  },
  {
    "type": "add_modifier",
    "layerId": "ROW_ID",
    "modifierType": "justify",
    "params": { "horizontal": "center", "vertical": "none" }
  }
]
```

- `grid-arrange`: `columns` 1..256, `rows` 0 = grow, `spreadX/Y` = pitch between cell top-left
  corners in composition pixels, `startCorner` top-left|top-right|bottom-left|bottom-right,
  `direction` horizontal (fill rows) | vertical (fill columns). Children beyond columns×rows hide
  with their descendants.
- `radial-arrange`: centers children on rings around the owner box center. `count` 0 = all,
  `rings` 1..64 from `innerRadius` to `outerRadius`, `startAngle`/`endAngle` in degrees
  (0 = right, 90 = down; a 360° span spaces items evenly, an open arc spans end to end),
  `arrangement` equal (equal share per ring) | radiate (spokes), `startFromOuter`, `orient`
  (rotation = angle + `baseRotation`). Animate start/end angle together for a spinning carousel.
- `justify`: aligns the union of visible children to the owner box: `horizontal`
  none|left|center|right, `vertical` none|top|center|bottom, plus `offsetX/Y`. Stack it after an
  arrange modifier so hiding a child re-centers the rest.
- `look-at`: `source` layer/group reference; rotates the owner about its transform origin so its
  `axis` x (right side) or y (bottom side) faces the reference center; `flip` adds 180°, plus
  `rotationOffset`.
- Spline Path is the layer `motionPath` (`set_layer_layout`): `sourceLayerId` (path layer),
  `progress` 0..1 (track `motionPathProgress`), `orientToPath`, offsets and optional
  `rotationOffset` −360..360 (base orientation added to the tangent while orienting). Progress
  supports lifecycle and local-loop tracks; it is not an element-data binding target. Other path
  controls are static. Orientation follows the rendered tangent, including the source path's
  nonuniform scale and rotation. A modifier-driven path uses its final geometry in the same
  frame. Pass `motionPath:null` to detach.

### Animated radial layout

Create the container and children, parent the children, then add `radial-arrange` to the container.
Use the returned modifier ID in both `set_property_track` and `set_loop_property_track`, for
example `modifiers.RETURNED_ID.startAngle`; animate `endAngle` by the same delta to retain the arc.
Use `set_layer_bindings` with a numeric field and `targetProperty:
"modifiers.RETURNED_ID.outerRadius"` for a data-controlled radius. Bound data overrides that
channel's sampled keys. `update_modifier` edits also update the bound field's default.

Numeric limits for the newer modifiers:

| Modifier       | Numeric parameters                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Grid Arrange   | columns 1..256; rows 0..256; spreadX/Y 0..32768                                                                     |
| Radial Arrange | count 0..1024; rings 1..64; innerRadius/outerRadius 0..32768; startAngle/endAngle −720..720; baseRotation −360..360 |
| Justify        | offsetX/Y −32768..32768                                                                                             |
| Look At        | rotationOffset −360..360                                                                                            |

`count:0` uses every visible child. `rows:0` grows the grid automatically. A radial ring count
larger than the visible item count is reduced while evaluating. Look At can aim at a layer or a
group; its source must exist, and it must not depend on the rotation of the Look At owner.
The target group must not contain the Look At owner.

Only visible children are arranged; a hidden child keeps its authored place, so hide its artwork
too. Container modifiers conflict with the owner's Auto Layout, with a child's Motion Path and with
any other driver of a child's x/y (e.g. Auto Follow). Look At conflicts with an oriented Motion
Path. Compiled packages keep `modifierParentId` only for these hierarchies; runtime collection rows
under an outside container are arranged as children too.

## Boundaries and verification

- Reference cycles, including combined Spline Path/modifier cycles, and two geometry drivers
  owning the same axis are rejected. Stacking order
  does not override dependency order or change layer paint order.
- Auto Size/Follow geometry owners cannot simultaneously be driven by Auto Layout or a Motion Path
  in this milestone. Max Text Width can participate in Auto Layout.
- Guide references cannot export. Retarget/remove consumers before deleting referenced artwork.
- Components and copied groups remap internal references. Saving/copying a subgroup reference is
  rejected if flattening the existing component group would silently widen its membership.
- Verify long, short, empty and restored text, live-data changes, duplicate/bypass/undo, packaged
  font readiness, repeated/backward seeks, and editor/export output. Source validation alone is
  not an OGraf rendering/certification result. Do not save/export uncertified files.

## Modifier example playback review

For the six-example modifier set, review Grid Arrange, Radial Arrange, Justify, Look At,
Spline Path and Responsive Text in the editor, Preview & Export (including fullscreen), and
the actual coordinated package in the requested external renderer. Match its manifest dimensions
and frame rate; do not infer animation smoothness from a settled screenshot or deterministic strip.

- Switch forward and backward through all six. Capture the moving and held output; wait for each
  Take/Update/Out promise to complete before labeling a screenshot settled. A coordinated switch
  can include the outgoing template's authored Out followed by the incoming template's In.
  Read those durations before treating expected motion or a hold as a playback fault.
- Confirm arrangement descendants stay attached, radial layout moves smoothly, Look At retains its
  pivot, and the Spline rider follows the rendered tangent. Re-enter a previously played example
  and verify the same start and end poses.
- Change Justify's sponsor text and Responsive Text's headline while on air: default, short, long,
  empty, whitespace, non-ASCII, then restored. Empty text should hide the intended group; restoring
  it should recalculate fitting, backing size, following objects and centering without replaying In.
  Keep labels inside their cards; a data field without a fitting modifier can legitimately overflow.
- Cases without exposed fields still need switching and lifecycle review. Do not invent data
  controls or claim coverage of features absent from the example.
- Test Out/Take and Clear/Take, overlapping switches, and external real-time/non-real-time lifecycle
  checks. Retain captures of the preview, not only the controller. Restore original operator data.
- In Devtool, a custom Take does not rewrite the main Input Data form. Align its slot state before
  using Update: that payload includes the selected state as well as data. For non-real-time seeks,
  add a Play event at time zero; loading initial data alone intentionally leaves the graphic off air.

Studio defers Navigator PNG thumbnail work during its actual fullscreen preview and resumes the
latest pending thumbnail after exit, including a detached Preview & Export window. The displayed
thumbnail can therefore remain unchanged while fullscreen is open. When investigating startup
stutter, compare normal playback with a browser performance trace of the same fullscreen switch;
capture-tool latency is not an animation timing measurement. Keep authored frame timing intact.
