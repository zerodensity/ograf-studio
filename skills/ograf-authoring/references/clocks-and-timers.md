# Clocks and timers

Create the text-based component with `add_layer` and `kind:"clock"`. It remains `element.type:"text"`
with normal typography, fill, outline and effects. Read `elements` capabilities for the current
`text.clock` contract. `create_clock` creates a styled live clock/timer, and `create_countdown`
adds a countdown starter with editable alarm Rules. Explicit legacy hour/minute content or field
keys still select the old two-field recipe. See [broadcast recipes](./broadcast-recipes.md).

Configure `element.clock` at creation or `update_element.patch.clock` afterward. Partial settings
merge with the existing configuration; `clock:null` returns to ordinary text. Do not change the
element type or bind Content/runs while a clock is enabled.

```json
{
  "type": "add_layer",
  "kind": "clock",
  "name": "Countdown",
  "transform": { "x": 100, "y": 100, "width": 300, "height": 70 },
  "element": {
    "fontSize": 56,
    "clock": {
      "mode": "count-down",
      "source": "automatic",
      "format": "mm:ss",
      "initialValueMs": 300000,
      "endBehavior": "stop",
      "autoStart": true,
      "pauseWhenOffAir": true
    }
  }
}
```

`mode` is `clock`, `count-up` or `count-down`. System clocks support `hourCycle:"12"|"24"`,
`timeZone:"local"|"UTC"|IANA zone`, `showAmPm` and `uppercaseAmPm`. Leading-zero switches are
`padHours`, `padMinutes`, `padSeconds`. Formats use `hh/h`, `mm/m`, `ss/s`, `dd/d`, `SSS` milliseconds,
`A/a` meridiem and `[literal text]`. Prefix/suffix are separate strings. Timer formats retain total
hours, minutes or seconds when higher units are omitted. Positive countdown seconds round up
until zero, avoiding an early zero display.

Timers use `initialValueMs`, optional count-up `limitMs`, and `endBehavior:"stop"|"continue"|"loop"`.
They use elapsed monotonic time in live playback. Clock mode reads system time; non-realtime
rendering uses persisted `referenceTimeMs` plus sampled time. Set this reference explicitly for
repeatable visual examples of a particular time.

## External data

Set `source:"manual"` and a `manualValue` fallback. Bind `clock.manualValue` with normal
`set_layer_bindings`; preserve existing bindings. Numeric or numeric-string values are
milliseconds. Clock strings may be `HH:mm[:ss[.SSS]]`, optionally AM/PM, or ISO date/time with an
explicit `Z`/offset. Timer strings may be signed `mm:ss` or `hh:mm:ss`, optionally fractional
seconds. Time-only clock values retain their wall time under the selected format/time zone.

Manual source displays each supplied value without starting a local timer. Invalid feed values
retain the authored fallback. Automatic source ignores this binding but preserves it for later
manual use. Bind numeric/text fields, not boolean or collection objects; use `sourcePath` for
supported nested scalar values.

Clock settings can also use ordinary layer bindings: `clock.timeZone`, `clock.hourCycle`
(`"12"|"24"`), `clock.showAmPm` (boolean or `"true"|"false"` text), and `clock.format`.
Timers additionally support `clock.initialValueMs` (milliseconds or `mm:ss`/`hh:mm:ss`) and
`clock.endBehavior` (`"stop"|"continue"|"loop"`). Invalid feed values retain the authored setting;
validation rejects an invalid field default after its value map. **+ Add Binding** seeds an
appropriate field for these targets.

During real-time playback, display/end-behavior updates preserve the timer's current value and
operator Start/Pause state. A new duration resets to that duration and rearms alarms while
retaining whether the timer was running or paused. Coordinated updates record their setting
changes at the shared playout timestamp. Scheduled duration/end-behavior updates are not yet
certified for standalone non-real-time rendering; use real-time output for these setting changes.
Existing manual-value and timer-command replay retain their separate contracts below.

## Controls and text FX

Generated public custom actions use `clock:<encodeURIComponent(layerId)>:start`, `:pause`, `:reset`
and `:restart`. Do not create duplicate custom action definitions. Reset restores the initial value
and pauses; Restart restores it and runs. IDs remain stable across source/mode changes. System
clocks ignore timer commands; manual Reset/Restart only rearm alarms. Copies and component instances remap
these references to their own layer IDs.

### Coordinated template sets

Coordinated output exposes the same generated commands through the standard OGraf
`template.action` custom action. First take the template containing the timer on air, then send:

```js
await graphic.customAction({
  id: 'template.action',
  payload: {
    slotId: 'your-lane-id',
    actionId: 'clock:' + encodeURIComponent('your-layer-id') + ':start',
  },
});
```

Use `pause`, `reset` or `restart` in place of `start`. Start resumes accumulated time; Pause freezes
the value; Reset restores the authored initial value and pauses; Restart restores it and runs.
Read the generated action IDs from the template descriptor or packaged operator guide rather than
guessing a layer ID. The action dropdown contains labeled timer commands alongside authored actions,
with a valid lane/action default. A conditional-aware host filters this list when the lane changes.
The list combines that lane's templates, so the chosen command must belong to its active template.
Unknown or inactive targets are rejected; issuing a timer command does not take a template on air
or change transition timing and dependencies. System clocks ignore timer commands. Manual values
remain externally controlled: Start/Pause do not advance the feed, while Reset/Restart rearm its
alarms without replacing the supplied value.

Coordinated timers use the shared playout clock. Non-real-time scheduled commands and replayed
seeks use the same event times, including backward/repeated `goToTime` sampling; do not drive
offline timer values with wall time. Existing formatting, bindings, paints and update Text FX stay
on the normal text renderer. Standard OGraf `customActions`/GDD describe the controls; conditional
dropdown filtering is a controller UI capability, not an additional graphic runtime requirement.

## Multiple timer/counter alarms

Alarms are ordinary Rules. Use `set_layer_visual_rules` with `trigger:"timer-alarm"` and
`timerAlarm:{sourceLayerId,thresholdMs,direction:"down"|"up"}`. The source is a same-composition,
non-guide text clock layer. Thresholds are finite, nonnegative milliseconds; display formatting
does not drive comparisons. Count-up/down modes run alarms; time-of-day mode retains the rules
without firing them. Numeric Count up/down Text FX is a separate text animation.

Read existing Rules and preserve them when replacing the array. Create one stable Rule ID per
alarm; do not create custom actions to simulate timer ticks. The rule owner may differ from its
timer source, and ordinary action targets, conditions, delays and transition frames still apply.
For a seven-second countdown, a five-second warning and a zero-time ending can be authored as:

```json
[
  {
    "id": "five-second-warning",
    "name": "Five seconds remaining",
    "enabled": true,
    "trigger": "timer-alarm",
    "timerAlarm": { "sourceLayerId": "timer-id", "thresholdMs": 5000, "direction": "down" },
    "actions": [{ "type": "visibility", "targetLayerId": "warning-id", "visible": true }]
  },
  {
    "id": "time-up",
    "name": "Time up",
    "enabled": true,
    "trigger": "timer-alarm",
    "timerAlarm": { "sourceLayerId": "timer-id", "thresholdMs": 0, "direction": "down" },
    "actions": [
      { "type": "visibility", "targetLayerId": "warning-id", "visible": false },
      { "type": "visibility", "targetLayerId": "ending-id", "visible": true }
    ]
  }
]
```

Replace the example IDs with the actual timer and target IDs. Keep warning/ending artwork hidden
in its initial authored pose. Properties → Clock / Timer → Alarms creates these same Rule records;
Edit rule selects the linked record in the unified Rules pane. Its checkbox is the Rule's Active
state, and a draft with no actions remains editable but is omitted from executable output.

Crossings fire once per run, including values skipped by a dropped frame or manual update.
Reset/Restart rearm; Pause/Resume retain fired state. Reset alone does not run the timer or replay
its alarms. Alarm actions keep the normal Rules persistence; add Reset/Restart custom-action
Rules to restore warning/ending artwork when required. Each runtime instance has independent latches. Live playback coalesces obsolete
warnings when a jump has already reached the final zero alarm; deterministic rendering rebuilds
visual results at their actual scheduled times. Scrubbing must not send live operator commands.

Test five seconds and zero, delayed/large updates, reset and restart, manual `clock.manualValue`
feeds, independent component instances, and forward/backward/repeated offline seeks. Review actual
standalone and coordinated export pixels; an alarm declaration alone does not prove its action ran.

Use existing `element.textAnimation`, with a non-`none` type and `replayOnUpdate:true`, to animate
displayed-value changes. `flip` rotates segments around the horizontal axis; `blur` fades from
blurred to sharp; `rotate` turns segments in from a quarter rotation; `stretch` expands them
horizontally. These use the same `split:grapheme|word` and `durationFrames` options as `fade`,
`rise` and `pop`. Choose a duration shorter than the display update interval; avoid long reveal
animations on millisecond displays. No per-second property keys are needed. The editing canvas,
Preview & Export and exported runtime share the same formatted value and text rendering.

For odometer-style clock updates, use `roll-up` or `roll-down` with `replayOnUpdate:true` and a
duration shorter than the displayed tick interval. Changed digits roll between old and new values;
unchanged digits and separators remain steady. Full `hh:mm:ss` formats are supported. Numeric text
counter presets (`count-up`/`count-down`) can combine their value animation with `countRoll:up|down`.
