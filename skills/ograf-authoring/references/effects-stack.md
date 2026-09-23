# Composable effects stack

Properties → Effects stack is an ordered filter chain. Types: blur, drop-shadow, glow,
brightness, contrast, saturate, hue-rotate, shader. Each layer supports 16 entries, including the two
compatibility slots for older blur/shadow controls. Duplicate types are supported. The stack
stays inside one layer; avoid duplicate geometry just to combine shadows or glows.

New effects start bypassed. Choose Normal, Screen, Add, Multiply, Overlay, Darken or Lighten to
activate one; MCP `blendMode` also enables unless `enabled:false` is explicit. `blendOpacity`
(0..1) mixes its result with the input. Glow/shadow modes blend their generated contribution;
adjustments blend the processed image. Existing entries without blend settings keep Normal/100%.
Blend settings are static; effect parameter keyframes remain independent. Bypass preserves all
settings and keys. All bypassed produces no extra filter graph.

## Create, then use returned paths

```json
[
  {
    "type": "add_effect",
    "layerName": "Pattern | Graphite face",
    "effectType": "glow",
    "patch": {
      "name": "Soft silver bloom",
      "blendMode": "screen",
      "blendOpacity": 0.6,
      "params": { "radius": 12, "color": "#a8d8ff", "opacity": 0.35 }
    }
  }
]
```

The result contains the effect ID, layer ID, name, and exact `properties` paths. Reuse those paths
for `set_property_track`, `set_loop_property_track`, `bind_design_token`, and `set_layer_bindings`.
For example the returned radius path has shape `effects.<effect-id>.radius`. IDs are local to a
layer and do not change when the effect moves or is renamed. Inspect the resolved `effectStack`
through `ograf_inspect_scene`; it includes enabled state, params and legacy property mappings.

`update_effect` accepts an effect ID and `patch: {name?,enabled?,blendMode?,blendOpacity?,params?}`. Numeric params use
authored lifecycle frames by default; use `scope: "frame"` plus `frame` for one key. Full tracks
can be supplied independently. A bypass only changes `enabled` and preserves keys/bindings.
`duplicate_effect` copies the selected effect's tracks and bindings with fresh effect/key IDs.
`remove_effect` removes its keys and links, retaining data fields and unrelated animation.
`reorder_effects` requires all current IDs exactly once, in the desired top-to-bottom order.

## Parameters and compositing

Read the live capability catalog for current bounds and defaults. Blur/glow/shadow radius is
0–256 px; shadow offsets are -2048–2048 px; opacity is 0–1. Brightness, contrast and saturation
use multipliers 0–4 (1 is unchanged), and hue uses degrees. Effect colors use #RRGGBB/#RRGGBBAA.
Numeric eased overshoot is clamped to the supported range. Glow adds an outer colored halo to
the preceding result. A subsequent blur or color adjustment processes that halo too; order matters.

## Shader effect

`add_effect` with `effectType:"shader"` creates a bypassed identity post-process shader. Enable a
Blend mode, then edit its complete `shader` paint. `iChannel0` is the flattened incoming layer image
after every preceding stack entry; the shader output is blended with that input and becomes the
source for later effects. `iResolution` and `iChannelResolution[0]` describe the padded effect
buffer. The pass is WebGL 2 and uses absolute OGraf time. A separate `inputImage` is rejected because
the stack owns `iChannel0`; additional texture channels, feedback, video and audio remain unsupported.

The editor disclosure exposes source loading, render scale and pragma controls. Shader-effect source
and static control edits are stored with the effect; declared controls are not yet effect-track or
runtime-binding targets. Use browser capture and final certification—SVG-only previews omit the GLSL
pixels. A layer with an enabled shader effect cannot be used as an alpha-mask source; path masks
still ignore paint and effects.

Old projects preserve blur then shadow through `base-blur` and `base-shadow` slots. Their property
paths remain `blur`, `dropShadowBlur`, `dropShadowOpacity`, `dropShadowOffsetX`, `dropShadowOffsetY`
and `dropShadowColor`. They can be reordered/bypassed/duplicated like other entries. Editing through
legacy `update_effects` restores the corresponding slot if removed. Prefer the instance operations
for new work. Do not replace a whole stack to change one parameter.

Color and number Brand Kit tokens can drive new effect params. Bind a `color` or `number` GDD field
to the returned parameter path for live `updateAction` control. Runtime data overrides the sampled
parameter without restarting the loop; authored values remain intact. A color field's existing
`defaultTokenId` link can keep its default synchronized with Brand Kit.

## Verify

Check a frame where the effect is visible, compare different orders, and sample animation before
and after reordering. Realtime updates and scheduled backward seeking must reproduce the same
filter/phase. Studio and export keep CSS for Normal/100% chains and use an sRGB SVG filter graph
for per-effect blending; alpha masks use the same ordered graph with padding for accumulated blur/shadow extents. Path masks ignore effects by definition.
Preserve the final certification gate before source save or package export.
