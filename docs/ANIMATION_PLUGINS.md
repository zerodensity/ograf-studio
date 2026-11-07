# Animation preset plugins

Animation plugins add named whole-layer entrances and exits without adding runtime JavaScript.
Studio validates their JSON, maps normalized key times into the chosen In/Out window, and creates
normal editable property tracks. Chart renderer plugins remain a separate plugin kind.

## Use a pack

Broadcast Motion is included with Studio and enabled on fresh installations. To add another pack:

1. Open **File → Preferences → OGraf Studio → Plugins → Add plugin…** and select an `.ogsplugin.zip`.
2. Review its type, publisher, version and declared license, then install it.
3. Select objects, open **Plugins**, choose **Animation** and select the pack's card and version. **Animate In/Out → Plugins…** is also available in Properties.
4. Choose a template card, then set the side, duration and numeric controls in **Animation Settings** on the right and **Apply**. One application is one
   undo step; browsing and parameter drafts do not change the project.

Updates install alongside old versions. Existing keys do not update automatically. Disabling or
removing a local pack hides it from the chooser but does not prevent playback of baked keys.
Editable source retains exact preset definitions and last-applied settings for reapplication;
exported OGraf graphics need only the ordinary tracks, not the preset pack.

### Use in Transition Logic

The Transitions pane's **Incoming animation** and **Outgoing animation** selectors also list
compatible presets. They apply to the whole incoming/outgoing non-shared content, modeled as a
rectangle wrapper; only presets supporting that target and the requested side are offered.
The transition's existing phase timing owns duration. Controls use the pack's declared bounds.

Selecting a preset pins its exact definition/version/digest once in the set's Transition Logic
catalog. It creates a transition-specific override, not a destructive edit to the template's
layer tracks. Shared objects continue to morph, and ordinary data updates do not replay entrances.
**Template animation** instead plays the template's authored layer animations; **Transition style
(default)** retains the existing style. Version 5 preserves these choices in compact and compatible
`.ogs` sets; coordinated exports contain baked tracks with no executable plugin dependency.

Use the gear inside the plugin card for installation settings; right-click **Manage plugin…** opens the same controls.

## Bundle format

Use exactly these three files at the ZIP root, or in one enclosing directory:

```text
manifest.json
presets.json
LICENSE.txt
```

`manifest.json` declares a unique ID, exact version and kind:

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "kind": "animation-presets",
  "id": "example.motion",
  "version": "1.0.0",
  "name": "Example motion",
  "author": "Example publisher",
  "license": "MIT"
}
```

Include the full applicable notices in `LICENSE.txt`; a manifest label does not verify legal
permissions or publisher identity. Optional description and embedded PNG/WebP icon metadata use
the same non-executable icon rules as chart plugins.

`presets.json` contains a JSON array. This example supplies a parameterized slide entrance:

```json
[
  {
    "id": "slide",
    "name": "Slide from left",
    "parameters": [
      { "id": "distance", "label": "Distance", "default": 80, "min": 0, "max": 2000, "step": 1 }
    ],
    "tracks": {
      "in": [
        {
          "property": "x",
          "mode": "offset",
          "keys": [
            { "at": 0, "value": { "parameter": "distance", "multiplier": -1 } },
            { "at": 1, "value": "on-air", "easing": "cubic-out" }
          ]
        }
      ]
    }
  }
]
```

Presets may supply `in`, `out`, or both. Optional `targetKinds` restricts compatible element kinds.
Supported channels are `x`, `y`, `rotation`, `opacity`, `scale`, `clipLeft`, `clipRight`, `clipTop`,
`clipBottom`, and `blur`. Blur needs an applicable blur effect; scale does not resize/reflow text.

Each channel is declared once per side. Keys must be ordered, have unique `at` values from 0 to 1,
and include both endpoints. The entrance's final key and exit's first key must use `on-air` to
preserve the existing pose. A value can be a finite number, `on-air`, or a declared numeric
parameter with optional multiplier/offset. The modes are:

- `absolute`: use the resolved number directly.
- `offset`: add the resolved number to that channel's on-air value.
- `factor`: multiply its on-air value by the resolved number.

`on-air` always returns the original anchor, regardless of mode. Optional incoming `easing` uses
Studio's easing catalog. There are no scripts, CSS, timers, general formulas, imports or arbitrary property
paths. Unknown fields, unsupported channels, non-finite values, invalid ranges and missing
parameters are rejected. Applying replaces only declared channel keys inside the chosen lifecycle
window, preserves other channels/loops, and rejects frame collisions rather than dropping keys.

The window must have a Step and enough frames. Duration plus optional `offsetFrames` must fit;
the offset finishes the animation early and holds its result until the boundary. Layer locks and
channel applicability are checked before any scene change. Presets are limited to 64 per pack,
16 numeric controls per preset, 64 keys per channel, and 2 MiB of definitions. ZIP, license and
catalog size/path limits are shared with chart plugin bundles.

## Individual chart marks

Chart.js renderer 1.3.0+ accepts these same data-only presets through **Chart Properties →
Bars / slices animation**. In/Out choices have duration, start delay and per-mark stagger. They
animate bars, stacked segments and pie/doughnut/polar-area sectors, not the whole chart canvas.
Unrestricted presets are accepted; restricted presets must support `chart` or the mark kind
(`rectangle` for bars, `ellipse` for slices). Text-only presets are not compatible.

For mark-local curves, the on-air anchor is zero for x/y/rotation/blur/clip insets and one for
opacity/scale. Numeric parameters retain their normal validation. The complete staggered sequence
must fit its lifecycle window. In replaces the chart's built-in entrance; update morphs and
whole-layer motion remain separate. Saved sources pin definitions once; exports bake compact
numeric curves once per side rather than duplicating keys for every mark.

MCP uses `apply_animation_preset` with `target:"chart-marks"`, `durationFrames`, optional
`delayFrames`/`staggerFrames`, and the normal exact `reference`, `presetId`, `side` and `parameters`.
Finish offsets are only for whole-layer application. Reset chart marks using
`update_element.patch.markAnimations:{}`. Removing an in-use source pack remains blocked.

## Package and verify

The source example is in `plugins/broadcast-motion`. Build it with:

```sh
npm run plugin:package:animations
```

For another source directory containing all three files:

```sh
bun run scripts/buildAnimationPresetPlugin.mjs path/to/pack
```

The builder validates the definitions and writes the exact-version `.ogsplugin.zip` under
`release/plugins`. Test both sides, short durations, parameter extremes, grouped application,
undo, backward seeking and OGraf Preview. For MCP use, discover `sections:["plugins"]`, read
`include:["plugins"]`, and apply an existing composition pin with `apply_animation_preset`.
MCP cannot install a pack or grant trust. General runtime animation engines, per-letter plugin
effects, importers and other plugin kinds are not part of this API.

For source-catalog cleanup, `remove_animation_preset_plugin` accepts the exact unused reference.
Dry-run first; it refuses references from objects and saved components. It does not remove local
installations or change baked tracks. Local enable/disable controls Studio's choosers; MCP may
reapply validated definitions already retained in the source.
