# Visual rules

`set_layer_visual_rules` replaces one layer's ordered rules. Each rule has a trigger, optional
conditions, and ordered actions.

In Studio, new rules receive template-wide numbered names (`Rule #1`, `Rule #2`, etc.). The
**Target** selector above **When** moves a rule to an object or group without changing its ID,
conditions or actions. Implicit self targets follow the new owner, expanding to every group
member; explicit action targets remain unchanged. Active,
Duplicate and Delete controls live in the rule list. Its divider resizes the list and settings
and saves the split as local UI preferences, outside the template document.

## Conditions

A data rule (default `trigger`) needs an existing `fieldId` or a virtual mouse operand in MCP. `sourcePath` is an optional
segment array into an object field. `operator` tests the value against `value` or, with
`compareFieldId`/`compareSourcePath`, against another field.

| Operator                                                         | Value                                          |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| `equals`, `not-equals`                                           | Any; numbers and booleans coerce (`5` = `"5"`) |
| `greater-than`, `greater-or-equal`, `less-than`, `less-or-equal` | Number                                         |
| `between`                                                        | `[min, max]`, inclusive                        |
| `contains`, `not-contains`, `starts-with`, `ends-with`           | Text; `contains` on an array tests membership  |
| `one-of`, `not-one-of`                                           | List, or comma-separated text                  |
| `empty`, `not-empty`                                             | None                                           |
| `changed`, `increased`, `decreased`                              | None; need previous data                       |

`ignoreCase: true` makes text comparisons ignore letter case. `between` and the list operators
compare with a literal, not another field.

`conditions[]` adds comparisons with the same keys, combined with the primary condition by `match`
(`all` by default, or `any`). On non-data triggers they are a guard that must hold when the event
fires. Inside a runtime collection prototype, a condition on the collection's field reads the
current row item, so each row can style itself.

`fieldId:"$mouse.x"` and `fieldId:"$mouse.y"` are **Mouse X** and **Mouse Y**, measured in
composition pixels from its top-left corner. Both also work in `conditions[]` and as
`compareFieldId`; use an empty `sourcePath`. They are private pointer inputs, never real data
fields or exported GDD controls, and cannot be set by `set-data` or editorial data. All mouse
comparisons are false until the pointer is known and after it leaves the composition. Mouse
`changed`/`increased`/`decreased` require both previous and current known positions. Input is
available in real-time preview and interactive exports; non-real-time schedules have no live
mouse. Use controller data or custom actions for deterministic/remote interaction.

For a group owner, set `hostGroupId` to the shared editor `groupId` and store the rule once on
an editable member via `set_layer_visual_rules`. Data/lifecycle rules execute once; pointer or
hover on any member is in scope. Export compiles the owner to `scopeLayerIds` and expands
implicit object actions to members. Component instancing and group duplication remap these
references; rules with no `hostGroupId` keep their original object scope.
Deleting a group rule's storage object moves it to a surviving member; deleting the whole group
removes the rule. Moving directly between members does not leave and re-enter the owning group.

## Triggers

`timer-alarm` observes the raw count-up/down value of `timerAlarm.sourceLayerId` at
`timerAlarm.thresholdMs`, crossing in `timerAlarm.direction` (`up` or `down`). Multiple alarm
Rules can share one timer, with independent enabled states, guards and actions. The source is
explicit and remains unchanged when the Rule owner moves. See
[timer alarms](./clocks-and-timers.md#multiple-timercounter-alarms) for creation, reset/restart,
external data, instance isolation and export verification.

- `data` and `hover` are **states**: show/hide and property results hold while the conditions (or
  the pointer) hold and revert afterwards. One `hover` rule makes a hover highlight.
- `pointer-enter`, `pointer-leave`, `pointer-down`, `pointer-up`, `click` and `double-click` are
  pointer **events** on the owning object or group (mouse enters, leaves, primary button pressed, released,
  clicked, double-clicked). `pointer-up` fires only for a press that started on the layer, even if
  the release happens off it. Use `hover` for a change that should undo itself, and the events for
  one-off actions. They run only in interactive real-time HTML, not on the Studio editing canvas or
  in non-real-time replay.
- `play` fires when the first step is reached, `step` when a step keyframe is reached (`eventId` is
  the step keyframe id; omit it for any step), `stop` when the graphic starts leaving, and
  `custom-action` when the custom action whose public `actionId` is in `eventId` runs.
- Data rules that use `changed`, `increased`, or `decreased` are events too.

### Keyboard interaction

Choose **When → Keyboard → Key pressed** (`key-down`) or **Key released** (`key-up`). Enter a
key or use **Record**, then choose Ctrl, Alt, Shift or Meta when needed. Modifiers match exactly;
letters ignore case. Space/Spacebar/literal space and Esc/Escape are aliases. Recording handles
only its focused button, keeps the release out of playback, and Escape cancels recording.

MCP rules use `keyboard:{key:"Enter",ctrl:true}` alongside the ordinary conditions and actions.
For example, `trigger:"key-down", keyboard:{key:"k"}` can invoke a custom action, change a data
field or run a lane Take. A permanent on-air controller graphic can own keys for other lanes.
Existing object/group targets, guards, `delayFrames` and transition timing still apply.

Key pressed runs once per physical press by default. Set `repeat:true` (Studio's **Repeat while
held**) for operating-system repeats. Key released ignores repeat. Every enabled matching rule
on the active on-air output can run; avoid unintended duplicate shortcuts across templates.

Focus the real-time preview to use keys. Typing, text composition, native form controls, modal
dialogs and the shortcut recorder never trigger graphic Rules. Matching authored keys take
priority over Studio's Space/Left/Right/D navigation, including when a guard prevents the action
or repeat is disabled. Escape remains Studio's preview exit; use another key for an in-Studio
pause command. Sync editor/preview keeps its editor Timeline controls.

Standalone and coordinated exports listen on their focused graphic host. Click or Tab into the
graphic first; they do not install global browser hotkeys or intercept another graphic's input.
Only keys delivered by the browser can be used. Keyboard input is real-time interaction; for
remote or deterministic playout, expose the same behavior through an ordinary custom action.

Event results persist until a later rule replaces them. When a state rule starts matching, it takes
back the properties and visibility an earlier event set on the same targets. `delayFrames` delays
an event rule's actions. Playout triggers, delays and transitions replay deterministically in
non-real-time schedules; use a custom action for a remote or deterministic trigger instead of
pointer or keyboard input.

## Actions

- `visibility` (`visible`), `toggle-visibility` (events only), and `property` (`targetProperty`,
  `value`) change the owning layer, or `targetLayerId`. A target inside the same collection
  prototype resolves to the same row; a target that is a prototype layer, set from outside the
  collection, drives every row. `targetGroupId` instead drives every layer of an editor group
  (Edit > Group, the layers' shared `groupId`). `transitionFrames` fades visibility, or animates
  numeric and colour property values; other values switch.
- `property` also takes layer offsets that compose with the layer's animation: `layer.offsetX` and
  `layer.offsetY` (px), `layer.rotation` (degrees added), `layer.scale` and `layer.opacity`
  (multipliers; opacity 0–1). A hover rule with `layer.scale` `1.1` makes a grow-on-hover button.
  Shapes also take `strokeWidth`, and rectangles `cornerRadius` (all corners).
- `property` with `layer.x`, `layer.y`, `layer.width` or `layer.height` sets an absolute pose channel
  in composition pixels. Studio labels these **Position X**, **Position Y**, **Width** and
  **Height**. Bare `x`, `y`, `width` and `height` in older rules are aliases, with the same
  last-rule-wins ordering. Coordinates must be finite; dimensions must also be nonnegative. These
  are real geometry changes, so a resized backing, bracket, mask or clipping container uses the new
  bounds. Existing offsets remain additive. Active rule geometry replaces the sampled animation
  channel before ordinary layout, modifiers, masks and crops; explicit coordinated shared-element
  pins still have priority. A data/hover state releases its channels when it stops matching;
  event results persist until replaced.
- `set-data` changes a data field inside the graphic, so bindings and data rules react: `fieldId`,
  `mode` `set` (`value`, stored as the field's type), `toggle`, or `increase`/`decrease` (`value` is
  the step, default 1). A later update from the controller replaces it. Use it for click counters,
  selected-tab state and similar interactive state.
- `custom-action`, `shader-animation`, `play-sound`, and `take-media` trigger a custom action,
  shader animation, Sound Event, or Media Cue. A clock/timer text layer also accepts the built-in
  custom actions `clock:<url-encoded layer id>:start|pause|reset|restart`, both as actions and as
  `custom-action` trigger `eventId`s. A custom action or data change started by a rule can fire rules
  again, up to a fixed depth.

Rules run after ordinary bindings, in layer order then rule order; when two matching state rules
set the same property on one target, the later one wins. Removing a layer, field, custom action,
media cue or step prunes the rule parts that referenced it; `remove_data_field` treats rules that
read the field as consumers and needs `force`.

## Coordinated playout actions

Group rules authored on a shared component asset run once on the retained shared instance.
Template-local group rules that include retained shared objects must be authored on that asset;
coordinated compilation reports unsupported local overrides rather than dropping their rules.

Rules **Then → Playout** offers Take, Update, Out and Clear. Lane/template selection uses stable
`transitionLogic.slots[].id` and `states[].id` from `ograf_get_template_set`. Author lanes,
transitions, make-room timing and dependencies in **Transitions**; Rules only sends commands
through that same coordinator. Preview & Export remains the playback surface.

| Action shape                                                | Meaning                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `{type:"playout",operation:"take",slotId,stateId,data?}`    | Take that state in its lane; `stateId` is required.                                                               |
| `{type:"playout",operation:"update",slotId,stateId?,data?}` | Update the on-air state; optional `stateId` guards against a different active state. It never switches templates. |
| `{type:"playout",operation:"out",slotId}`                   | Animate the lane and active descendants out through their own configured routes.                                  |
| `{type:"playout",operation:"clear",slotId}`                 | Immediately clear that lane and descendants.                                                                      |

Take with no `data` retains the target state's editorial values or defaults. Update with no
`data` copies effective data from the triggering template, using known field keys. Explicit
`data:{}` applies no patch; explicit values merge with retained target data. Literal data uses
runtime field keys, not field IDs, and must be JSON-safe, at most 64 KiB, 4096 values and 16 nested
levels. Out/Clear accept neither `stateId` nor `data`; every Rules command requires `slotId`.
Out/Clear reset dependent activation intent while preserving editorial data. Parent Take does
not revive dependent lanes.

A matching data-state or hover rule sends its playout command once on entry, not every frame,
and does not reverse it when the condition stops. Use a separate rule to leave. Event-rule
`delayFrames` can delay a command. Planner readiness, pending-request policy and existing
transition durations still apply; action numbering does not create an asynchronous sequence.

Enabled playout rules require a coordinated template set; standalone composition output rejects
them rather than dropping commands. The set validator and coordinated compiler resolve lane/state
references; composition validation checks action shape only. Local layer/field/media pruning
preserves these set-level references.

Coordinated output supports data/change events, pointer and once-per-entry hover, `play`, the
first-step `step`, `stop` and authored `custom-action` triggers, including delayed event rules.
Local `set-data` writes, custom-action chains, animated Rule properties and custom-action Text FX
run on the shared frame clock. To run an authored template action, send `template.action` with
`{slotId,actionId,data?}`; `actionId` is the public ID and the lane must have an active template.
Preview controls list these actions under their active lane. Data writes remain scoped to that
template; playout actions still use the coordinator and its dependencies. Pointer input requires
interactive real-time playback. Shader/media side effects and later-step behavior remain
unsupported in coordinated output and fail compilation with details. Standalone visual rules
retain their ordinary supported feature set; use a coordinated export for Rules playout commands.

For example, attach a data rule to an editable object in the lower-third template after reading
the real field, slot and state IDs:

```json
{
  "id": "ticker-on-request",
  "name": "Show ticker when requested",
  "enabled": true,
  "trigger": "data",
  "fieldId": "<show ticker boolean field id>",
  "sourcePath": [],
  "operator": "equals",
  "value": true,
  "actions": [
    {
      "type": "playout",
      "operation": "take",
      "slotId": "<ticker lane id>",
      "stateId": "<ticker state id>"
    }
  ]
}
```

Add a separate false-condition rule with `operation:"out"` and the same lane to hide it. The
ticker's existing layout phase still shrinks the lower third before entry and restores it after
exit; do not duplicate that timing in Rules.

## Example: tabs

```json
{
  "type": "set_layer_visual_rules",
  "layerName": "Tab A",
  "rules": [
    {
      "id": "tab-a-open",
      "name": "Open panel A",
      "enabled": true,
      "trigger": "click",
      "actions": [
        {
          "type": "visibility",
          "visible": true,
          "targetLayerId": "<Panel A id>",
          "transitionFrames": 8
        },
        { "type": "visibility", "visible": false, "targetLayerId": "<Panel B id>" }
      ]
    }
  ]
}
```

## Example: winner highlight

```json
{
  "id": "home-leads",
  "name": "Home leads",
  "enabled": true,
  "trigger": "data",
  "fieldId": "<home score field id>",
  "sourcePath": [],
  "operator": "greater-than",
  "compareFieldId": "<away score field id>",
  "actions": [
    { "type": "property", "targetProperty": "fill", "value": "#f5c542", "transitionFrames": 12 }
  ]
}
```
