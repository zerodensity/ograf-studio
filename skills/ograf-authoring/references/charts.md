# Chart plugin layers

Choose the chart entry in the **Plugins** toolbar above the canvas, then choose a type in the visual gallery: bar,
horizontal bar, stacked bar, line, area, pie, doughnut, radar, or polar area. Properties has the
same gallery for later type changes, plus direct editors for series, rows, values, colors, label
size, legend, and grid. Advanced JSON is for bulk data edits.

Installed, enabled, trusted chart providers appear dynamically in this toolbar. One button
represents each plugin ID; select a version in its gallery before adding the chart. This choice
pins that exact provider and is independent of the new-chart global default. Read
[renderer-plugins.md](./renderer-plugins.md) for trust and version boundaries.

For MCP, read `elementSchemas.chart` from `ograf_get_capabilities sections:["elements","editor"]`.
Create a chart with `add_layer.kind:"chart"` and an explicit `element.provider` reference
`{id,version,sha256}` already pinned in the composition's renderer catalog. There is no integrated
engine or implicit provider. A missing catalog requires the human installation/creation workflow,
not an invented module. Its `element.data` is JSON-safe:

```json
{
  "labels": ["North", "South"],
  "datasets": [
    {
      "label": "Viewers",
      "data": [5.2, 4.7],
      "backgroundColor": ["#38bdf8", "#818cf8"],
      "borderColor": "#38bdf8"
    }
  ]
}
```

Each dataset needs one finite number per label. Colors use `#RRGGBB`; a single background color
or one color per label is accepted. A chart layer's default size is 640 × 360. `fontSize` controls
axis/legend text in authored composition pixels (8–96), so use larger sizes on a full-HD canvas.
`showLegend`, `showGrid`, and `textColor` are ordinary static properties.

When adding several charts, give each its own space and review them together in playback. Studio's
chart gallery looks for a clear position when possible; explicit placements and charts added inside
groups keep the designer's chosen placement. If the canvas is crowded, adjust the layout manually.

Bind target property `data` to a `textarea` GDD field containing the JSON object as text when
playout should replace labels/values. Validate and capture changed data with `dataOverrides`.
Set `element.animation` to configure chart motion:

```json
{
  "type": "grow",
  "durationFrames": 25,
  "delayFrames": 0,
  "staggerFrames": 2,
  "easing": "cubic-out",
  "replayOnUpdate": true
}
```

Presets are `none`, `grow`, `reveal`, and `fade`; new charts default to Grow. Duration is 1–1500
frames, delay is 0–1500 frames, and Grow's stagger is 0–100 frames between consecutive items. Animation
starts at the lifecycle Start frame and can replay after changed chart-bound data reaches
`updateAction`. Native OGraf keyframes can additionally move or fade the whole layer. Capture an
early, middle, and settled frame to verify animation; compare `goToTime` captures with playback.

Optionally set `animation.curve` to `{x1,y1,x2,y2}` (each 0–1) for a custom cubic Bézier. It
overrides the named easing. When switching back to a named easing, remove `curve` from the full
animation object; the Properties easing picker does this automatically.

Chart drawing and animation use the OGraf clock and are deterministic under `goToTime`. Canvas
rendering requires an HTML Canvas-capable renderer. Tooltip interaction is disabled. The
approximate SVG diagnostic does not show chart pixels. Use browser capture and certify both
real-time and non-real-time profiles before saving/exporting.

When checking a chart with multiple series, inspect Preview before Take as well as during and after
playback. Chart canvases prepared offscreen must start at the authored layer dimensions, rather than
the browser's default canvas size, so axis labels and series do not jump when playback starts.

## Distribution charts and presentation (Chart.js renderer 1.1.0+)

New controls require a pinned provider whose manifest declares `chartFeatures`: `presentation-v1`,
`canonical-data-v1` and `morph-update-v1` as needed. Existing 1.0.2 providers and saved pins stay
unchanged. Select a reviewed, installed newer provider explicitly; do not rewrite an old digest or
silently trust new executable plugin bytes.

Use a canonical numeric source for distributions:

```json
{
  "mode": "counts",
  "seriesLabel": "Travel share",
  "rows": [
    { "id": "transit", "label": "Transit", "value": 40, "color": "#2676EF" },
    { "id": "car", "label": "Car", "value": 30, "color": "#8FC6F4" },
    { "id": "other", "label": "Other", "value": 20, "color": "#9AAFC6" }
  ]
}
```

Counts must be finite, non-negative, with a finite positive total. The parser calculates each
share at full precision; two-decimal display values can sum to 99.99%. `mode:"percentages"`
preserves supplied percentages and requires every value in 0–100 and a total of 100 within
`1e-6`. Missing or excess totals reject the complete update and retain on-air data. Never
silently normalize direct percentages. Legacy labels/datasets remain independent metrics and
do not have a total-100 constraint. Keep row IDs stable when reordering or updating categories.

Canonical modes fix the numeric axis at 0–100 with percent ticks. The saved normalized data
also contains derived labels/datasets for the existing authoring contract; canonical rows always
win over those derived copies. Do not manually add value text to categories: bar-end labels
derive from the same sampled value as the geometry.

Optional `element.presentation` is JSON only:

```json
{
  "valueAxis": { "min": 0, "max": 100, "step": 20, "format": "percent", "decimals": 0 },
  "fontFamily": "Inter",
  "fontWeight": 700,
  "maxBarThickness": 40,
  "valueLabels": { "show": true, "decimals": 1, "suffix": "%" },
  "gradient": { "from": "#2676EF", "to": "#8FC6F4" }
}
```

Font weight is 100–900; maximum bar thickness is 1–500 composition pixels. Axis and value-label
precision is 0–6; suffix is at most 12 characters. Axis minimum/maximum are finite within
±1e12 and maximum must exceed minimum. `step` is positive. Canonical distributions override
the range and tick format to 0–100 percent; independent metrics may use explicit ranges.
Gradients accept two hex endpoints and follow the numeric axis. No callbacks or arbitrary
upstream options are admitted from data.

Set `animation.updateMode:"morph"` with `replayOnUpdate:true` for old-to-new motion from the
currently displayed bars; rapid updates continue from the interrupted pose. The Chart instance
is reused for data and presentation edits. Missing `updateMode` preserves entrance replay.
A new Take explicitly resets the entrance. Inspect early/mid/end samples, rapid updates and
backward seeks; do not infer compatibility from the feature declaration alone.

These controls do not resize surrounding authored panels/brackets or add independent axis,
category and label choreography. Keep that native framing intact and configure its layout
separately.

## Standard chart mark fills (Chart.js renderer 1.2.0+)

Optional `element.fill` accepts Studio's standard `Paint`: solid/transparent, gradient, shader or
media. Select an installed, reviewed provider whose manifest declares `mark-paint-v1`; older
providers must reject the override instead of painting a whole chart canvas. Provider mask and
foreground layers keep axes, grid, category text, outlines and value labels intact while native
paint follows the changing chart marks. Omitting `fill` keeps dataset colors and the legacy
`presentation.gradient`; ordinary existing charts do not need a provider upgrade.
Set `update_element.patch.fill:null` to remove the override and return to those dataset colors.

For MCP, read `elementSchemas.chart.fill` and `paintSchemas` first. Use
`update_element.patch.fill` with the same paint shape as other supported layers. Shader fields,
exposed parameters and the composition clock retain their normal contracts. This example uses
one animated shader across the chart marks:

```json
{
  "type": "shader",
  "fragmentSource": "void mainImage(out vec4 color, in vec2 point) { vec2 uv = point / iResolution.xy; color = vec4(0.1 + 0.2 * uv.x, 0.3 + 0.15 * sin(iTime + uv.x * 4.0), 0.9, 1.0); }",
  "speed": 1,
  "resolutionScale": 1,
  "parameters": {}
}
```

Media uses the existing `MediaPaint` clip/live source shape and timing fields, including muted
playback, imported video asset references and optional live fallback images. It remains
real-time-only; do not declare non-real-time support for a media-filled chart. Live sources keep
their readiness and `ZeroDensityHTML` renderer requirements. Export packages referenced assets
and resolves their URLs against the exported module, including blob-mounted preview packages.

Inspect early/mid/settled chart motion and data morphs with each fill. Check axes/labels and mark
edges independently. Certify shader fills in real-time and non-real-time when both are declared;
certify media fills using the real-time profile. Renderer trust is specific to exact bytes:
installing a new 1.2.0 bundle requires the normal plugin review, while trusted 1.1.0 snapshots
remain unchanged.

## Per-mark animation plugins (Chart.js renderer 1.3.0+)

Select an installed, reviewed provider declaring `mark-animation-v1`. Use **Properties → Chart →
Bars / slices animation** for separate In/Out presets, Duration, Delay, Stagger and numeric pack
controls; only Apply publishes the draft. The same packs used for whole-layer motion can animate
individual bars, stacked segments, pie/doughnut slices and polar-area sectors. Line/area/radar
marks are not supported. Presets must be unrestricted or target `chart` or the actual mark kind
(`rectangle` for bars, `ellipse` for slices); text-only presets are rejected.

Read the exact composition `animationPresetPlugins` pins and use the existing operation:

```json
{
  "type": "apply_animation_preset",
  "target": "chart-marks",
  "layerName": "Results",
  "reference": { "id": "example.motion", "version": "1.0.0", "sha256": "<inspected digest>" },
  "presetId": "slide",
  "side": "in",
  "durationFrames": 10,
  "delayFrames": 0,
  "staggerFrames": 2,
  "parameters": { "distance": 80 }
}
```

The chart needs a compatible pinned renderer and a Start–Step–End lifecycle. Duration plus delay
and `staggerFrames * (labels.length * datasets.length - 1)` must fit the selected side's window.
There is no finish offset for marks. Source `element.markAnimations` pins each side's exact pack
reference/preset/parameters; definitions are shared in the composition catalog. Reset both sides
with `update_element.patch.markAnimations:{}`; preserve the other side when changing one.

Mark In replaces the ordinary chart entrance rather than double-playing it. Data updates retain
their existing chart replay/morph behavior and do not restart the mark lifecycle. Numeric value
labels follow their marks but retain their text color; axes, category text, grid and legend stay
stationary. Gradients/shaders/media follow the moving coverage. Whole-layer Animate In/Out remains
independent. Export bakes compact numeric curves with no installed animation pack dependency.
Review entrance/exit, data updates, mark fills, backward/repeated seeks and source reopen; certify
the exported artifacts under their declared modes. This does not authorize installing/trusting a pack.

## Live preview sizing (Chart.js renderer 1.3.1+)

Use the reviewed 1.3.1 provider to keep axes, labels and painted marks aligned under editor zoom
and fitted/fullscreen previews. Installation alone preserves existing chart pins; select the
new renderer explicitly. Verify the live editor at multiple zoom levels and the actual preview
after resizing, not only an untransformed composition capture. Check early and settled frames,
backward seeks and initially hidden charts becoming visible; all chart passes must share local
authored dimensions.
