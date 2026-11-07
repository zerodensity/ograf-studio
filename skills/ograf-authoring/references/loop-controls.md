# Independent loop controls

Local property loops can share a transport without advancing or pausing the template, ticker,
clock, shaders, or other groups. Use Timeline → Local property loop → **Loop transport and hold
time**. Keep the existing local key ruler and group only clips that form one coordinated sequence.

## Data-controlled holds

Create a numeric seconds field, for example `holdSeconds` with default `4` and minimum `0`.
Use `set_layer_loop.timing` on every related clip:

```json
{
  "groupId": "Headlines",
  "holdFieldId": "<existing-numeric-field-id>",
  "holdRanges": [
    { "startFrame": 0, "endFrame": 100 },
    { "startFrame": 116, "endFrame": 216 },
    { "startFrame": 232, "endFrame": 332 }
  ]
}
```

For a 348-frame clip at 25 fps, each 100-frame hold lasts four seconds by default. Changing the
field to two seconds shortens each hold to 50 playback frames. The 16-frame retract/reveal changes
keep their authored duration, keys and easing. A zero-second hold runs changes back to back.
Changing the duration while on-air preserves the current authored position. Invalid or absent
runtime values retain the authored hold duration.

Group clips must share activation, duration, phase offset, hold field and ordered disjoint ranges.
Ranges use local clip frames. They must stay inside `0..durationFrames`. The component source owns
the field; component instances receive remapped fields and independent transport identities.
Removing the field is blocked until its hold timing is unlinked. `timing:null` removes the link.
Clips without timing keep their previous behavior.

## Operator commands

Preview & Export discovers active loop groups and offers Pause, Resume and Next controls.
The coordinator snapshot exposes `loops` as `{slotId,groupId,name,paused}` records.
MCP uses the same coordinator command path as Studio.

Portable OGraf custom actions:

```js
await graphic.customAction({
  id: 'loop.pause', // or 'loop.resume', 'loop.next'
  payload: { slotId: 'alert', groupId: '<group-id-from-the-playout-snapshot>' },
});
```

A single-template graphic omits `slotId`. Pause freezes this group's phase; Resume continues from
that phase. Next ends the current hold and runs the existing change. If paused, Next parks at the
next hold after the full change. Repeated Next during a change is ignored so masked headlines
never overlap or skip through an unfinished retract/reveal. Data remains intact.

These commands use the graphic clock and replay as scheduled `customAction` records. Non-realtime
backward and repeated seeks rebuild the transport from the load snapshot and action schedule.
Taking the lane Out or clearing it ends activation; a later Take starts a fresh transport.

## Continuous tickers

New `create_ticker` recipes use the [native mixed-content ticker](./native-ticker.md). Existing
text crawls remain supported. For an existing text layer, use
`update_element.patch.crawl`:

```json
{ "speedPixelsPerSecond": 140, "gap": 72, "direction": "left" }
```

Speed accepts 0–2000 composition pixels per second; gap accepts 0–8192 pixels between the measured
end of one copy and the next; direction is `left` or `right`. `crawl:null` restores ordinary text.
The runtime measures the current bound glyphs, repeats enough copies to fill the text box, and
samples the graphic clock for deterministic playback and offline seeks. Data and loaded-font
changes update the repeat width. This is separate from `Layer.loop` and grouped Pause/Resume/Next.

Keep a ticker's authored text box as its viewport, with fixed text sizing. When migrating an older
single-copy crawl, inspect its existing x-track/loop before removing only the travel that the new
crawl replaces; preserve masks, layout offsets and lifecycle entrance/exit motion. Capture a
repeat boundary with both short and long text, not just the initial leftward movement.
