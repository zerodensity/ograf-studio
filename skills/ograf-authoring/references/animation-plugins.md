# Declarative animation preset packs

For recipe-level incoming/outgoing choices, see [Transition Logic content animations](./template-sets-and-crops.md#incoming-and-outgoing-content-animations-version-5).
Those choices target one whole non-shared content wrapper and pin packs on the graph; the layer
workflow below remains the way to animate individual objects.

For individual chart bars and slices, read [per-mark animation plugins](charts.md#per-mark-animation-plugins-chartjs-renderer-130).
The same operation accepts `target:"chart-marks"` with duration/delay/stagger, requiring a provider
with `mark-animation-v1`; these choices remain independent of whole-layer animation.

Discover `sections:["plugins","editor"]` before use. `animationPresetPlugins` describes bounded,
data-only `kind:"animation-presets"` bundles: `manifest.json`, `presets.json`, `LICENSE.txt` in an
`.ogsplugin.zip`. **File → Preferences → OGraf Studio → Plugins** manages them alongside chart
plugins. Broadcast Motion is included and enabled on a fresh Studio installation. Human install/update/enable
actions are separate from project authoring; MCP cannot install or grant trust. Do not manufacture
catalog snapshots to bypass that workflow.

Read `get_project include:["plugins","layers","tracks"]` for exact composition pins, preset names,
sides, numeric controls and last-applied layer metadata. Narrow reads omit license/full key data;
an explicit full source read preserves the definitions. Select only an existing exact
`reference:{id,version,sha256}` from `composition.animationPresetPlugins`.

Use this operation inside a revision-checked atomic batch:

```json
{
  "type": "apply_animation_preset",
  "layerName": "Panel",
  "reference": { "id": "example.motion", "version": "1.0.0", "sha256": "<inspected digest>" },
  "presetId": "slide",
  "side": "in",
  "durationFrames": 12,
  "parameters": { "distance": 80 }
}
```

Presets bake ordinary keys. The In window is Start to first Step; Out is last Step to End. Positive
integral duration plus optional non-negative integral `offsetFrames` must fit. Offset finishes
early and holds the result to the boundary. Separate normalized keys colliding after frame rounding
are rejected; increase duration rather than dropping keys. Respect locks and channel applicability.
Numeric controls must be declared and within their ranges; omitted controls use the pack defaults.

Applying replaces only declared channels within that side's window. Other tracks and loops remain;
inspect custom authored motion before replacing it. The on-air anchor is retained. Native
`set_layer_motion` resets the previously applied pack's owned channels for that side and clears its
last-applied metadata. That metadata is provenance, not an active animation engine or proof the
user has not manually edited its keys.

Source retains exact definitions and controls; compiled output uses the normal tracks and has no
animation-pack runtime dependency. Local removal/disable and installed updates never change baked
playback automatically. Render representative entrance/exit frames, seek backward and certify the
actual realtime/non-realtime artifacts before claiming compatibility. Whole-layer preset packs do
not add per-letter text animation, arbitrary CSS/JavaScript, property paths, timers, or new layer
kinds. See `docs/ANIMATION_PLUGINS.md` for the SDK and source example.

Use `remove_animation_preset_plugin` only for requested source-catalog cleanup, with the exact
unused reference and a dry run first. It refuses object/component provenance references, preserves
tracks, and never changes local installation. Local enable/disable controls Studio's choosers;
MCP can still reapply validated definitions retained in source.
