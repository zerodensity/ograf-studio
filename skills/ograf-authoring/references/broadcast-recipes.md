# Built-in broadcast recipes

Use **+ Recipe…** above the canvas or the matching `ograf_apply_operations` operation for an
editable starting graphic. Read `semantics`, `designSystem`, `elements`, `loops` and `bindings`
capabilities as needed before changing its advanced features.

| Starter       | Operation            | Primary features                                                                                 |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Lower Third   | `create_lower_third` | Headline/subheadline fields, Brand Kit styling, clipped reveal, editable lifecycle motion        |
| Bug / DOG     | `create_bug`         | Compact identity field, material styling and lifecycle motion                                    |
| Ticker        | `create_ticker`      | Native mixed-content feed, transparent edge fades, Next appearance updates, bidirectional travel |
| Scoreboard    | `create_scoreboard`  | Team/score fields, constrained scores and rolling text updates                                   |
| Clock / Timer | `create_clock`       | Live system clock, count up/down, automatic/manual source, formats and time zones                |
| Countdown     | `create_countdown`   | Timer controls and editable five-second/zero alarm Rules                                         |

Recipes require a pausable OGraf Step. Shared `motion` overrides use `wipe`, `stagger`, `slide` or
`none` with editable entrance/exit keys. Durations must fit their lifecycle windows. Material
styling, source components, fields, effect stacks and tracks remain ordinary editable Studio data;
no downloaded shader/animation pack or executable renderer plugin is needed to create these starters.

Within one revision-checked batch, later operations can target recipe-created layers by exact
`layerName` and recipe-created controls by `fieldKey`. Names must be unique; inspect the returned
layer and field mappings for later batches. If any selector or operation fails, the whole batch
remains unchanged.

Default placements reserve separate areas: scoreboard at the top left; bug, clock and countdown
down the right; lower third above the bottom ticker. Explicit placement overrides still win.
Clock/timer motion stays in its row by entering and leaving from the right; the lower third
leaves to the left, so its exit does not cross the ticker. Explicit motion overrides still win.
Recipe text retains its full authored boxes with native shrink-to-fit, so
center/right and vertical alignment remain meaningful. Do not add Max Text Width indiscriminately
to these boxes: it intentionally reduces their geometry to the glyph bounds. News/Sports label
defaults are 32 px at the reference layout; Brand Kit values remain editable.

Recipe hierarchy supplies clipping, not automatic transform inheritance. Their ordinary editable
tracks carry the panel translation into otherwise stationary descendants, including nested timer
digit windows. Review entrance and exit together: text must travel with its panel, while a wipe's
moving clipping edge must not pull its content along. Keep authored independent child motion,
Text FX, bindings, alarm Rules, easing and lifecycle timing intact.

New default panels use a native shader fill: News signal grid, Sports velocity diagonals,
Entertainment studio ribbons, or Documentary contour atlas. `ink` and `accent` follow their
validated Brand Kit color bindings; `strength` and `speed` remain editable. Applying a different
built-in kit swaps an untouched built-in motif, including linked component sources/instances,
while preserving overridden values and edited/custom shader sources. Custom gradient/media paints
and explicit recipe themes stay authoritative. These shaders appear in Resources → Shaders.
Generated ink/accent fields follow the same token defaults as the native paint. Preserve their
exposure choices and genuine Data overrides; keep inherited component/field baselines aligned
when changing kits, so a palette refresh does not become a false instance override.

The panel shader includes the travelling reflection; new accents use native gradients/glow, so
six starters do not double their WebGL context count. Existing saved/custom accent shaders remain
intact. Reserve post-process shaders for artwork that needs an input image; ordinary decoration
must not flatten/copy a shader effect through Canvas 2D every frame. Review continuous ticker
movement alongside the materials; a still PNG cannot reveal rendering stalls. Do not reduce
scrolling speed or authored transition durations to hide them.

## Linked assets and safe editing

News and Sports starters use **Roboto Condensed**, the embedded headline family from Signal Blue.
Headlines and display values use weight 900; secondary text and ticker copy use weight 600,
with compact line height and restrained tracking. The variable font (100–900) is an ordinary
licensed project asset, included before the component source is created. Repeated recipes reuse
one family resource; compact sets pool identical bytes and independent exports carry their font
and license. No installed system font or online font service is required for these defaults.
Existing custom Brand Kit families and user-provided normal Roboto Condensed faces remain in use.
Entertainment and Documentary retain their chosen typography. Check the resolved font when reviewing
captures so a fallback is not mistaken for the bundled face.

Recipes become linked component assets with a placed instance by default. Returned semantic blocks
include `componentId` and `instanceId` when linked, plus stable `layers`, `fields`, `groupId` and
`timelineGroupId` mappings. Edit the component source to update all its instances; instance edits
remain overrides. Use `asComponent:false` to keep an independent grouped starter.

Treat returned layer IDs as opaque. Query roles/tags with `ograf_query_scene` rather than relying
on a fixed layer count or display name. Keep source `.ogs` files for editing; compiled coordinated
packages do not reconstruct component sources.

## Native ticker

`create_ticker` retains `content.label`, `content.text`, `fieldKeys.label` and `fieldKeys.text`.
`result.layers.crawl` remains an ID alias for the native ticker layer. The headline binding is
`items.headline.content`; it is no longer a `text.crawl` binding.

Configure native `items`, `speedPixelsPerSecond`, `gap`, `direction`, `textDirection`,
`updatePolicy`, `entryFade`, `exitFade` and `fadeSoftness`. `direction:"left"` means right-to-left
travel and is the default; RTL text layout is separate. Explicitly saved directions are retained.
**Next appearance** is the default: existing
visible passes finish with their original content and dimensions, while edits and inserted/removed
items are admitted safely offscreen. Pending indicators reflect this queue. Choose `immediate`
explicitly for immediate feed replacement. See [native ticker](./native-ticker.md) for item paints,
shaders, media preparation, whole-feed data updates and export behavior.

Supplying `items` or `fieldKeys.feed` creates a whole-feed array field bound to `items`, with no
conflicting per-headline binding. The separate category-label field remains editable. The default
headline starter exposes only label/text controls, avoiding a structural feed control until requested.

## Clock, timer and alarm Rules

`create_clock` defaults to a live system clock. Configure `mode:"clock"|"count-up"|"count-down"`,
`source:"automatic"|"manual"`, `format`, `timeZone`, `hourCycle:"12"|"24"` and `durationSeconds`.
Use `fieldKeys.value` for the manual-value field. Explicit `content.hours`/`content.minutes` or
`fieldKeys.hours`/`fieldKeys.minutes` preserves the legacy static two-field recipe.

`create_countdown` defaults to a countdown with `alarms:true`; `alarms:false` omits its starter
alarm Rules. Alarm Rules are ordinary editable Rules targeting the timer. Change their actions
there; do not invent a second alarm execution mechanism. Start/Pause/Reset/Restart use the existing
generated clock custom actions, and Reset/Restart rearm alarm crossings. Manual data stays externally
controlled. Read [clocks and timers](./clocks-and-timers.md) for exact units, crossing semantics and
coordinated `template.action` routing.

## Template-set transitions and exports

Recipes create scene content; they do not silently add lanes, conflicts or make-room dependencies
to a template set. Configure those deliberately in **Transitions**, and operate playback from
**Preview & Export** or **Playout Controls**. Native ticker travel and clock elapsed time are separate
from the editable entrance/exit tracks. Preserve that separation when restyling or reusing a starter.

Expose only intended operator fields in **Data → Operator controls**. Validate and certify the edited source
before single or coordinated export; selected features must be supported by the current exporter.

## Designing for air

Place readable text and logos inside title safe (5% per axis), and keep edge-anchored bars inside
action safe (3.5%). Keep the center available for the picture. Over unpredictable video, use a
backing, outline or shadow and verify contrast with realistic footage. Align sibling edges and
padding, use a clear headline/subheadline hierarchy, and test realistic long data values.

At 25 fps, 8–12-frame entrances, 6–10-frame exits and 2–4-frame staggers are useful starting
points; scale timing for the output frame rate and the brief. Ease out when arriving and in when
leaving. Sequence the panel, primary text and supporting text. Keep ambient motion subtle and
seamless, without drifting text that needs to remain readable. Tickers are intentionally moving
content and need their own legibility and smoothness review.

<!-- Tested authoring examples -->

### Premium lower third

A recipe lower third, made on-air ready: operator fields with limits, a name that slides when it
changes, and a glint every five seconds.

```json
[
  { "type": "apply_style_pack", "stylePack": "news" },
  {
    "type": "create_lower_third",
    "stylePack": "news",
    "name": "Guest",
    "theme": { "background": "#071523" },
    "content": { "headline": "Maria Okafor", "subheadline": "Chief Economist, Central Bank" },
    "fieldKeys": { "headline": "guest_name", "subheadline": "guest_title" }
  }
]
```

```json
[
  {
    "type": "update_data_field",
    "fieldKey": "guest_name",
    "label": "Guest name",
    "description": "Name as it should appear on air.",
    "constraints": { "maxLength": 32 }
  },
  {
    "type": "update_data_field",
    "fieldKey": "guest_title",
    "label": "Guest title",
    "description": "Role and organisation, one line.",
    "constraints": { "maxLength": 48 }
  },
  {
    "type": "set_layer_layout",
    "layerName": "Guest · Headline",
    "updateTransition": { "style": "slide-up", "durationFrames": 8, "distance": 24 }
  },
  {
    "type": "add_layer",
    "kind": "rectangle",
    "name": "Guest · Sheen",
    "transform": { "x": 154, "y": 799, "width": 1190, "height": 173 },
    "element": {
      "fill": {
        "type": "linear",
        "angle": 100,
        "stops": [
          { "offset": 0, "color": "#FFFFFF", "opacity": 0 },
          { "offset": 0, "color": "#FFFFFF", "opacity": 0 },
          { "offset": 0, "color": "#FFFFFF", "opacity": 0.5 },
          { "offset": 0, "color": "#FFFFFF", "opacity": 0 },
          { "offset": 1, "color": "#FFFFFF", "opacity": 0 }
        ]
      }
    }
  },
  { "type": "set_layer_flags", "layerName": "Guest · Sheen", "blendMode": "screen" },
  {
    "type": "set_layer_semantics",
    "layerName": "Guest · Sheen",
    "patch": {
      "role": "decorative",
      "tags": ["lower-third", "sheen"],
      "description": "Periodic glint across the panel while on air."
    }
  },
  {
    "type": "set_layer_mask",
    "layerName": "Guest · Sheen",
    "sourceLayerName": "Guest · Panel",
    "mode": "path",
    "hideSource": false
  },
  {
    "type": "set_layer_loop",
    "layerName": "Guest · Sheen",
    "activation": { "type": "lifecycle" },
    "durationFrames": 125,
    "repeatCount": null
  },
  {
    "type": "set_loop_property_track",
    "layerName": "Guest · Sheen",
    "property": "fill.stops[1].offset",
    "keys": [
      { "frame": 0, "value": 0 },
      { "frame": 30, "value": 1 },
      { "frame": 124, "value": 1 },
      { "frame": 125, "value": 0 }
    ]
  },
  {
    "type": "set_loop_property_track",
    "layerName": "Guest · Sheen",
    "property": "fill.stops[2].offset",
    "keys": [
      { "frame": 0, "value": 0 },
      { "frame": 27, "value": 1 },
      { "frame": 124, "value": 1 },
      { "frame": 125, "value": 0 }
    ]
  },
  {
    "type": "set_loop_property_track",
    "layerName": "Guest · Sheen",
    "property": "fill.stops[3].offset",
    "keys": [
      { "frame": 0, "value": 0 },
      { "frame": 24, "value": 1 },
      { "frame": 124, "value": 1 },
      { "frame": 125, "value": 0 }
    ]
  }
]
```

Why it works:

- The recipe already reveals the panel with a `clipChildren` wipe (cubic-out in, cubic-in out), so
  the text never fades on its own. Refine the generated layers rather than rebuilding them.
- The sheen is one gradient layer masked by the panel's geometry (`mode: "path"`), so it follows
  the panel's wipe in and out without its own lifecycle keys.
- Its three moving stops start and end collapsed at the edges, where the glint is invisible. The
  leading stop arrives first (frame 24) and the trailing one last (frame 30), which gives the glint
  its width. All three jump back to 0 on the final loop frame, so the seam matches and the glint
  repeats every 5 seconds.
- `maxLength` and descriptions make the playout form safe; the name slides up when it changes on
  air instead of snapping.

### Breaking strap

A built-from-scratch strap: native motion presets with staggered offsets, a fixed label and a bound
headline that shrinks to fit.

```json
[
  { "type": "apply_style_pack", "stylePack": "news" },
  {
    "type": "add_data_field",
    "key": "headline",
    "label": "Headline",
    "fieldType": "text",
    "defaultValue": "Flood warning issued for the river valley",
    "description": "One-line breaking headline.",
    "constraints": { "maxLength": 60 }
  },
  {
    "type": "add_layer",
    "kind": "rectangle",
    "name": "Strap · Bar",
    "transform": { "x": 96, "y": 850, "width": 1728, "height": 116 },
    "element": { "fill": "#B3121F" }
  },
  {
    "type": "add_layer",
    "kind": "rectangle",
    "name": "Strap · Label",
    "transform": { "x": 96, "y": 850, "width": 300, "height": 116 },
    "element": { "fill": "#FFD400" }
  },
  {
    "type": "add_layer",
    "kind": "text",
    "name": "Strap · Label Text",
    "transform": { "x": 96, "y": 850, "width": 300, "height": 116 },
    "element": {
      "content": "BREAKING",
      "color": "#111111",
      "fontSize": 46,
      "fontWeight": 900,
      "textAlign": "center",
      "verticalAlign": "middle",
      "autoFit": "fixed",
      "letterSpacing": 1
    }
  },
  {
    "type": "add_layer",
    "kind": "text",
    "name": "Strap · Headline",
    "transform": { "x": 432, "y": 850, "width": 1360, "height": 116 },
    "element": {
      "content": "Flood warning issued for the river valley",
      "color": "#FFFFFF",
      "fontSize": 56,
      "fontWeight": 700,
      "verticalAlign": "middle",
      "autoFit": "shrink-to-fit",
      "minFontSize": 40
    }
  },
  {
    "type": "set_layer_bindings",
    "layerName": "Strap · Headline",
    "bindings": [{ "fieldKey": "headline", "targetProperty": "content" }]
  },
  {
    "type": "set_layer_semantics",
    "layerName": "Strap · Bar",
    "patch": { "role": "container", "tags": ["strap"] }
  },
  {
    "type": "set_layer_semantics",
    "layerName": "Strap · Label",
    "patch": { "role": "accent", "tags": ["strap", "label"] }
  },
  {
    "type": "set_layer_semantics",
    "layerName": "Strap · Label Text",
    "patch": { "role": "label", "tags": ["strap", "qa:static-text"] }
  },
  {
    "type": "set_layer_semantics",
    "layerName": "Strap · Headline",
    "patch": { "role": "headline", "tags": ["strap", "editable"] }
  },
  {
    "type": "set_layer_motion",
    "layerName": "Strap · Bar",
    "side": "in",
    "spec": {
      "style": "wipe",
      "direction": "left",
      "durationFrames": 10,
      "offsetFrames": 2,
      "easing": "cubic-out"
    }
  },
  {
    "type": "set_layer_motion",
    "layerName": "Strap · Label",
    "side": "in",
    "spec": { "style": "pop", "durationFrames": 8 }
  },
  {
    "type": "set_layer_motion",
    "layerName": "Strap · Label Text",
    "side": "in",
    "spec": { "style": "pop", "durationFrames": 8 }
  },
  {
    "type": "set_layer_motion",
    "layerName": "Strap · Headline",
    "side": "in",
    "spec": {
      "style": "slide",
      "direction": "left",
      "distance": 40,
      "durationFrames": 8,
      "easing": "cubic-out"
    }
  },
  {
    "type": "set_layer_motion",
    "layerName": "Strap · Headline",
    "side": "out",
    "spec": { "style": "fade", "durationFrames": 5, "offsetFrames": 4, "easing": "cubic-in" }
  },
  {
    "type": "set_layer_motion",
    "layerName": "Strap · Label Text",
    "side": "out",
    "spec": { "style": "fade", "durationFrames": 5, "offsetFrames": 4, "easing": "cubic-in" }
  },
  {
    "type": "set_layer_motion",
    "layerName": "Strap · Label",
    "side": "out",
    "spec": {
      "style": "wipe",
      "direction": "left",
      "durationFrames": 7,
      "offsetFrames": 1,
      "easing": "cubic-in"
    }
  },
  {
    "type": "set_layer_motion",
    "layerName": "Strap · Bar",
    "side": "out",
    "spec": { "style": "wipe", "direction": "left", "durationFrames": 8, "easing": "cubic-in" }
  },
  {
    "type": "set_layer_loop",
    "layerName": "Strap · Label",
    "activation": { "type": "lifecycle" },
    "durationFrames": 50,
    "repeatCount": null
  },
  {
    "type": "set_loop_property_track",
    "layerName": "Strap · Label",
    "property": "opacity",
    "keys": [
      { "frame": 0, "value": 1 },
      { "frame": 25, "value": 0.8, "easing": "sine-in-out" },
      { "frame": 50, "value": 1, "easing": "sine-in-out" }
    ]
  }
]
```

Why it works:

- The reveal is a sequence, not a fade: the bar wipes in from the left over frames 0–10, the label
  pops (back-out overshoot) over 4–12 and the headline slides 40 px into place over 4–12.
  `offsetFrames` finishes the bar two frames early so it is settled before the text lands.
- The exit is faster and reversed: text fades out first (frames 15–20), then the label and bar wipe
  away to the left, clear by End.
- Everything sits inside title safe (x 96–1824, bottom 966), the headline has an opaque backing,
  and `shrink-to-fit` with `minFontSize` 40 keeps a 60-character headline on one line.
- A Wipe or Slide `direction` names the side the layer enters from (In) or leaves towards (Out).
- The label's slow opacity breathing is the only on-air motion; the headline never moves while it
  is being read.

### Live scoreboard

A recipe scoreboard extended with designed data changes, a leader highlight and an operator-fired
goal flash.
Only layers whose bound value changed transition. A count or roll with `replayOnUpdate` replaces the
composition crossfade unless the layer sets its own `updateTransition` style or duration.

```json
[
  {
    "type": "create_scoreboard",
    "stylePack": "sports",
    "asComponent": false,
    "name": "Score",
    "content": { "homeName": "ARS", "homeScore": 1, "awayScore": 0, "awayName": "CHE" }
  },
  { "type": "update_element", "layerName": "Score · Panel", "patch": { "fill": "#071523" } },
  {
    "type": "add_custom_action",
    "actionId": "goal",
    "name": "Goal",
    "description": "Flash the scoreboard after a goal."
  },
  {
    "type": "add_layer",
    "kind": "rectangle",
    "name": "Score · Goal Flash",
    "transform": { "x": 557, "y": 59, "width": 806, "height": 130 },
    "element": { "fill": "#FFFFFF", "borderRadius": 6 }
  },
  {
    "type": "set_property_track",
    "layerName": "Score · Goal Flash",
    "property": "opacity",
    "keys": [{ "frame": 0, "value": 0 }]
  },
  { "type": "set_layer_flags", "layerName": "Score · Goal Flash", "blendMode": "screen" },
  {
    "type": "set_layer_semantics",
    "layerName": "Score · Goal Flash",
    "patch": { "role": "decorative", "tags": ["scoreboard", "goal-flash"] }
  }
]
```

```json
[
  {
    "type": "set_layer_layout",
    "layerName": "Score · Home Score",
    "updateTransition": { "style": "slide-up", "durationFrames": 6, "distance": 30 }
  },
  {
    "type": "set_layer_layout",
    "layerName": "Score · Away Score",
    "updateTransition": { "style": "slide-up", "durationFrames": 6, "distance": 30 }
  },
  {
    "type": "set_layer_loop",
    "layerName": "Score · Goal Flash",
    "activation": { "type": "customAction", "customActionId": "goal" },
    "durationFrames": 12,
    "repeatCount": 3
  },
  {
    "type": "set_loop_property_track",
    "layerName": "Score · Goal Flash",
    "property": "opacity",
    "keys": [
      { "frame": 0, "value": 0 },
      { "frame": 3, "value": 0.7, "easing": "cubic-out" },
      { "frame": 12, "value": 0, "easing": "cubic-in" }
    ]
  },
  {
    "type": "set_layer_visual_rules",
    "layerName": "Score · Home Score",
    "rules": [
      {
        "id": "home-leads",
        "name": "Home leads",
        "enabled": true,
        "trigger": "data",
        "fieldId": "<field id: home_score>",
        "sourcePath": [],
        "operator": "greater-than",
        "compareFieldId": "<field id: away_score>",
        "actions": [
          {
            "type": "property",
            "targetProperty": "color",
            "value": "#FFD400",
            "transitionFrames": 8
          }
        ]
      }
    ]
  },
  {
    "type": "set_layer_visual_rules",
    "layerName": "Score · Away Score",
    "rules": [
      {
        "id": "away-leads",
        "name": "Away leads",
        "enabled": true,
        "trigger": "data",
        "fieldId": "<field id: away_score>",
        "sourcePath": [],
        "operator": "greater-than",
        "compareFieldId": "<field id: home_score>",
        "actions": [
          {
            "type": "property",
            "targetProperty": "color",
            "value": "#FFD400",
            "transitionFrames": 8
          }
        ]
      }
    ]
  }
]
```

Why it works:

- The sports pack gives condensed type, outlined score digits for legibility over the pitch, and
  fast expo-out motion; the recipe places the board top-centre inside title safe.
- A new score slides up instead of snapping, and the leading side turns gold through a data rule
  that compares the two score fields, so the operator only types numbers.
- The `goal` custom action (`customActionId` is the public `actionId`) fires a short three-pulse
  flash in screen blend over the board. It is a finite loop, so it never advances the graphic.
- To verify, capture with `dataOverrides` for a home lead, an away lead and a draw, then trigger
  `goal` in the preview.
