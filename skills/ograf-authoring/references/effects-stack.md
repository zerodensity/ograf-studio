# Composable effects stack

Properties → Effects stack is an ordered filter chain. Types: blur, drop-shadow, glow,
brightness, contrast, saturate, hue-rotate. Each layer supports 16 entries, including the two
compatibility slots for older blur/shadow controls. Duplicate types are supported. The stack
stays inside one layer; avoid duplicate geometry just to combine shadows or glows.

## Create, then use returned paths

```json
[
  {
    "type": "add_effect",
    "layerName": "Pattern | Graphite face",
    "effectType": "glow",
    "patch": {
      "name": "Soft silver bloom",
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

`update_effect` accepts an effect ID and `patch: {name?,enabled?,params?}`. Numeric params use
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
filter/phase. Studio and export use one CSS chain; alpha masks use the equivalent ordered SVG
chain with padding for accumulated blur/shadow extents. Path masks ignore effects by definition.
Preserve the final certification gate before source save or package export.
