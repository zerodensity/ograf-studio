# Shared Looping Pattern lighting

Use a pattern's lighting controller to synchronize existing sweep curves and adjust their
strength. The controller is separate from `pattern.cycleFrames`, which drives row geometry.
Discover `elements` capabilities; read `patterns`, layers and loops before linking.

## Set up a controller

`set_tiling_pattern.patch.lighting` merges omitted settings from the current controller. An empty
object creates an enabled controller with a cycle one eighth of the pattern's row cycle, phase 0
and multipliers 1. Settings are:

| Setting       | Meaning                                                                | Range               |
| ------------- | ---------------------------------------------------------------------- | ------------------- |
| `enabled`     | False bypasses lighting controls and restores source timing/appearance | boolean             |
| `cycleFrames` | Shared light period, independent of row motion                         | integer 1–1,000,000 |
| `phase`       | Added fraction of each light sweep                                     | 0–1                 |
| `intensity`   | Multiplier on sampled opacity of all linked layers                     | 0–4                 |
| `glow`        | Additional opacity multiplier for glow-role layers                     | 0–4                 |
| `softness`    | Multiplier on existing blur, glow and shadow radii of glow-role layers | 0–4                 |

```json
{
  "type": "set_tiling_pattern",
  "patternName": "O/D shared motion",
  "patch": {
    "lighting": { "cycleFrames": 4800, "phase": 0, "intensity": 1, "glow": 1, "softness": 1 }
  }
}
```

Retain the returned pattern ID. Link each light in an atomic operations batch:

```json
{
  "type": "set_layer_lighting",
  "layerName": "Silver sweep",
  "link": { "patternId": "PATTERN_ID_FROM_RESULT", "role": "light", "cyclesPerLoop": 6 }
}
```

The link defaults to `cyclesPerLoop:1`, `phaseOffset:0`, `gain:1`. Valid ranges are integer 1–64
sweeps, 0–1 fractional phase offset and 0–4 gain. Use `role:"glow"` on bloom/halo layers; light-role
layers respond to intensity but not glow strength/softness. Softness scales existing effects; it
does not create a new glow effect. Add a glow/blur through the composable effects stack if needed.

## Preserve an existing graphic

A 4800-frame shared light cycle with sweep counts 6, 4, 8 and 3 preserves existing 800-, 1200-,
600- and 1600-frame source loops. Leave master phase, link phase at 0 and multipliers at 1. The
source loop's own phase offset remains additive. Check the LCM fits the supported period/count
ranges before linking; do not silently change speeds when it does not.

Moving sweeps must already have an infinite loop (`repeatCount:null`, lifecycle activation).
Each original curve is sampled over the shared period divided by `cyclesPerLoop`; its keys,
easing, gradient stops, effect IDs and nominal duration remain unchanged. An unanimated layer may
also link for static intensity/glow controls. Finite or per-Step loops must be changed deliberately
before linking; invalid combinations are rejected. Shared lighting does not create beam geometry
or automatically crop it. Keep authored fades, masks and offscreen wraps that make the source
sweep seamless. For a complete row-and-light loop, use compatible whole-cycle periods.

Controller bypass restores original curves and strengths. Unlink with `link:null` before deleting
the pattern/controller; guards include component snapshots. New components retain the links and
reuse the composition's pattern resource, like ordinary procedural pattern instances.

## Inspect and verify

`ograf_get_project` and scene inspection expose `layer.lighting`. `ograf_sample_tracks` accepts
`loopElapsedFrame`; returns effective numeric values, controller/link settings and the sampled
source-loop frame. Sample 0, intermediate phases, the shared period and reversed timestamps.
Do not infer source-frame progress from the row offset: geometry and light clocks are independent.

Recompile and inspect after changing controls. Use the existing connected-browser certification
and export path, then test realtime playback, scheduled reverse seeking, colors through runtime
`updateAction`, and Stop/Take Out. Field/token bindings still target each layer's existing color
or effect properties. Controller settings are authoring controls, not new runtime GDD fields;
do not invent controller binding paths. Live numeric effect bindings retain their existing final
override precedence; verify a bound blur/radius before expecting softness to change it.

The UI exposes settings under Resources → Patterns → Shared lighting and the same pattern editor
in Properties. Link the current selection as Light/Glow there, or choose the controller in a
layer's Properties → Shared lighting. Source curves remain in the Local property loop editor.
