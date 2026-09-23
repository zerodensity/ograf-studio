# Shader and pattern workflows

Read current capabilities and scene IDs/revision first. `shaders` and `tiling` are compact
capability sections; older servers may require `elements`. Add `loops` when authoring loops and
`editor` before browser checks. All examples below are operations inside a revision-checked
`ograf_apply_operations` batch, not standalone tool names.

## Shader paints

Apply a complete paint to an existing object's `fill`. Editable text can also use `strokePaint`
with a nonzero `strokeWidth`. Fill and outline have separate source, parameters and tracks.
Rectangle, ellipse, path, pattern, text, image, image sequence and Lottie support shader fills.
On media the original alpha supplies the silhouette; original RGB is replaced. One independent
embedded PNG/JPEG may be sampled as `iChannel0`; the shader cannot sample the painted media,
lower layers, or external broadcast video as a texture.

```json
{
  "type": "update_element",
  "layerName": "Title",
  "patch": {
    "fill": {
      "type": "shader",
      "name": "Blue waves",
      "fragmentSource": "#pragma ograf intensity slider min(0) max(2) step(0.01)\nconst float intensity = 1.0;\nvoid mainImage(out vec4 color, in vec2 pixel) {\n  vec2 uv = pixel / iResolution.xy;\n  float wave = 0.5 + 0.5 * sin(uv.x * 12.0 - iTime);\n  color = vec4(vec3(0.1, 0.4, 0.9) * wave * intensity, 1.0);\n}",
      "speed": 1,
      "resolutionScale": 1,
      "parameters": { "intensity": 1 }
    }
  }
}
```

The runtime supplies `main`, version, `iTime`, `iResolution`, optional `iChannel0`, and
`iChannelResolution[0]`; omit custom uniforms. `inputImage` embeds one PNG/JPEG data URI with
`repeat`/`clamp` wrapping and `linear`/`nearest` filtering. Source must be a self-contained single
Image pass. Additional channels, video, buffer feedback, audio, mouse/date/frame inputs and
multi-pass Shadertoy graphs are unsupported. Inspect source licensing before reuse.
RGBA output is multiplied by the object's coverage, so transparent rain can use a full-canvas
rectangle with alpha zero between drops. This does not create refraction of layers underneath.

`#pragma ograf NAME CONTROL` marks a literal global constant or object-like define. Controls:

| GLSL type   | Control | Runtime field         | Animation channels                   |
| ----------- | ------- | --------------------- | ------------------------------------ |
| float       | slider  | number                | `.NAME`                              |
| int         | slider  | integer               | `.NAME`, stepped                     |
| bool        | toggle  | boolean               | `.NAME`, stepped numeric 0/1         |
| vec2        | vector2 | object `{x,y}`        | `.NAME.x`, `.NAME.y`                 |
| vec3 / vec4 | color   | RGB / RGBA hex string | `.NAME.r`, `.g`, `.b`, optional `.a` |

Numeric limits use `min(N) max(N) step(N)`. No `expose` keyword is needed. Generated fields and
bindings are automatic; do not create duplicates. `paint.parameters` holds numbers, booleans,
or numeric arrays, while runtime field values use the types above. Inspect
`shaderPaintInspections` and `shaderAnimationProperties` for exact source diagnostics and tracks.

### Keyframes and local loops

Use `set_property_track` for composition-frame animation. For a four-second ambient loop at
25 fps, use the following pair after applying the example paint:

```json
[
  {
    "type": "set_layer_loop",
    "layerName": "Title",
    "durationFrames": 100,
    "repeatCount": null,
    "activation": { "type": "lifecycle" }
  },
  {
    "type": "set_loop_property_track",
    "layerName": "Title",
    "property": "fill.parameters.intensity",
    "replace": true,
    "keys": [
      { "frame": 0, "value": 1, "easing": "linear" },
      { "frame": 50, "value": 0.25, "easing": "sine-in-out" },
      { "frame": 100, "value": 1, "easing": "sine-in-out" }
    ]
  }
]
```

Inspect an existing loop before changing its duration/activation; preserve unrelated tracks.
Use `strokePaint.parameters.NAME` for text outline controls. Every channel is independent.
Floats use ordinary incoming easing/curves. Int/bool values hold until the next key. Key values
must respect declared ranges; color channels use 0..1. Active keyed channels override runtime
data for those components only. An inactive loop-only channel returns to data/default values.
Shader `iTime` continues independently of parameter tracks.

Sample `ograf_sample_tracks` with the on-air composition frame, exact `properties`, and
`loopElapsedFrame` at the start, intermediate points and one full cycle. Capture representative
composition frames and verify local-loop motion in the editor or exported runtime. Capture/strip
`frame` is composition time; those tools do not accept an invented `loopElapsedFrame` parameter.
Use browser certification and repeated/backward seeking for the actual WebGL artifact.

The editor offers Auto-keyframe, Timeline **+ Property → Fill shader / Outline shader**, key Value,
and local Loop preview. Removing the last shader key in the editor releases animation ownership.
MCP `remove_property_key` currently requires at least one remaining key; do not promise identical
last-key deletion through that operation. Removing/retyping exposed declarations prunes invalid
channels; keep symbol names stable when their animations should survive source edits.

### Shader Resources

Resources → Shaders provides New Shader, editable names, Edit, Load, Save shader, and removal.
Saved resources live in `project.shaders`; applied paints are copies, not live library links.
Read saved shaders with `ograf_get_project include:["shaders"]`, then copy `resource.paint` into
`update_element.patch.fill` or text `strokePaint`. Library create/rename/delete and GLSL file
loading are editor UI actions, not dedicated MCP mutations. To load GLSL through MCP, read the
authorized source and send its text in the complete paint. Preserve existing paint values when
changing one parameter. Set text `strokePaint:null` to restore solid `strokeColor`; replacing
fill with a solid restores a shape fill, while omitted media fill restores original pixels.

## Visual pattern presets

`ograf_get_capabilities sections:["tiling"]` returns `tiling.presets.entries`. Each entry has an
ordinary `patch` from the same preset builder as the editor. The reference canvas is 1920×1080
at 25 fps. Adapt `width`, `height`, and `cycleFrames` to the inspected composition. Dots is the
neutral starting point; Stripes, Chevrons, Diamonds, Checkerboard and the original Monogram are
also available. Presets start static. There is no `presetId` operation field.

Use `set_tiling_pattern` with the chosen patch. `createLayer:true` creates a linked layer;
`false` saves only the definition. Empty patches retain the legacy O/D defaults. Do not silently
replace an existing custom pattern with a preset: editing by ID changes every linked instance.
When deliberately applying a preset to an existing pattern, preserve its name/lighting unless
the user asked to change them. Additional layers use `add_layer.kind:"pattern"`,
`element:{patternId}`, and a transform matching the pattern canvas.

| Editor control            | MCP patch / behavior                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Rows / Fit rows           | `rows`, `fitRows:true`; row height is derived                                                              |
| Symbol size               | `fitRows:false`, `rowHeight`; choose how many rows fit                                                     |
| Horizontal / vertical gap | `gap`, `rowGap`                                                                                            |
| Stagger                   | `rowPhaseStep` in motif turns                                                                              |
| Variation / Shuffle       | `spacingVariation`, `seed`                                                                                 |
| Animate                   | positive integer `cyclesPerLoop`; zero is static; clear per-row cycle overrides when applying to every row |
| Loop duration             | `cycleFrames = seconds × frameRate`; choose/report rounding for fractional frames                          |
| Direction                 | `left`, `right`, or `alternate`                                                                            |
| Play/Pause preview        | editor-only preview; does not alter project timing                                                         |

`symbols` contain `{key,d,viewBoxWidth,viewBoxHeight,width,height,fillRule}` and `sequence` entries
contain `{symbolKey,gapScale}`. Geometry lives in `composition.patterns`; never bake repeated copies
or author `element.definition`. Ordinary layer transform/paint/effect tracks remain separate from
row motion. Gradient paint repeats in each motif; shader fill uses the pattern's moving alpha mask.

The editor can copy selected rectangles, ellipses or paths, replace a symbol from built-in shapes,
import SVG silhouettes, and reorder the visual sequence. Its SVG importer supports common filled
paths/shapes and affine transforms, preserves supported holes, and rejects unsupported clips,
masks, text, images, external content and ambiguous overlapping separate shapes. Outline visible
strokes/text first. There is no MCP SVG-to-symbol or selected-group conversion command; supply
validated explicit vector symbols or use that editor workflow. SVG asset import creates an image
asset and is not a pattern-symbol conversion.

### Sharing and independent copies

Pattern resources are shared; their layer instances own fill, outline, transforms and effects.
To make one instance independent through MCP, read its resource, copy the definition's authored
fields without `id` to a new `set_tiling_pattern` operation with `createLayer:false`, then use its
returned ID in `update_element.patch.patternId` for only that layer. Preserve all other layer data
and inspect a separate lighting link before deliberately relinking it. The UI provides Duplicate,
Add to canvas, usage counts and Make independent for the same distinction.

Keep whole-number row cycles and verify `patternRows` at elapsed zero and `cycleFrames` for the
seam. `rowOverrides` can retain independent direction, cycles, phase, width, blur and opacity;
remove applicable overrides when shared controls should apply. Pattern row motion uses lifecycle
activation; per-Step activation is unsupported. Remove/relink live layers, component snapshots
and shared-lighting references before deleting the definition. Shared lighting is described in
[shared-lighting.md](./shared-lighting.md).
