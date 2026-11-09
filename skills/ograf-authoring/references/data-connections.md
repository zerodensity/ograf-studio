# Native live data connections

Discover `bindings.dataConnections` and read `ograf_get_project` with
`include:["dataConnections","dataFields"]` before editing. Connections belong to one composition
and persist in standalone and compact/compatible set `.ogs` files. They map JSON dot paths or CSV
columns to existing local field IDs. No arbitrary JavaScript transform is stored in a connection.

Use revision-checked `ograf_apply_operations` batches:

```json
{
  "type": "add_data_connection",
  "connection": {
    "name": "Market quotes",
    "source": "public-markets",
    "format": "json",
    "enabled": true,
    "target": "both",
    "refreshMs": 5000,
    "missing": "keep-last",
    "publicMarkets": { "symbols": ["BTC-USD", "ETH-USD", "SOL-USD"] },
    "mappings": [{ "fieldId": "<existing-field-id>", "sourcePath": "btcPrice" }]
  }
}
```

`update_data_connection` takes `connectionId` and `patch`; `remove_data_connection` takes
`connectionId`. Creation returns `connectionId`. Use actual field IDs from that composition;
foreign/duplicate targets and unsafe source paths are rejected. Normal field deletion protects
connection mappings; explicit forced deletion clears affected mappings. Dry-run destructive edits.
Removing generated shader controls also removes mappings to those deleted controls; Undo restores
them. Do not hide unrelated invalid mappings during cleanup.

Sources are `url`, `embedded`, and `public-markets`. URL sources accept HTTP/HTTPS and JSON or CSV;
embedded sources use `embeddedText`. `refreshMs:0` is manual refresh. Destinations are
`editor-preview`, `coordinated-preview`, and `both`; old connections without a target keep their
editor-only behavior. New public-market connections default to both. **Data → Connections** owns
configuration, enabled state, refresh and status; do not create an external helper merely because
the designer closes that pane.

One application service shares identical sources across consumers. It cancels unused requests,
avoids overlapping polls and does not rebuild mappings on every animation frame. Updates use editor
test values or an in-place patch to the existing combined-preview coordinator, never source defaults
or repeated Takes. A feed patch must not start the lane's authored update transition or rebuild its
mount. Ordinary data/change Rules and configured leaf text effects still run. Explicit authored
Update commands, standard OGraf `updateAction`, and `transition.take` retain transition semantics.

For **Current template** export, Studio starts on **Real-time playout** if a dual-mode template has
an enabled external feed. An OGraf controller supplies live values to the exported graphic. For
non-real-time output, provide recorded values as scheduled actions. Native ticker motion can be
sampled at the requested timestamp, so a ticker alone does not require a real-time-only export.
Paused/transitioning lanes retain the newest payload until safe to deliver. A settled coordinator
may retain its `incoming` selection: determine eligibility from current state, transition and
pending state, not from the mere presence of historical incoming/outgoing selections.
Multiple sources updating one lane must serialize and coalesce their field patches so an
asynchronous update cannot replace another source's newly received values.

The public-market reader uses one persistent module Worker per shared source when supported;
fetching and normalization preserve the provider's cache and freshness timing there. Unsupported
or blocked startup falls back to the same provider. A running Worker failure stays visible and
retains last received output; it does not silently replace its cache. Disable/re-enable can retry.
For periodic UI stalls, follow the [live UI performance guidance](./ograf-invariants.md#live-data-and-application-ui-performance):
Workers do not eliminate redundant editor compilation, hidden drawing or growing chart replay.

For an external feed using MCP, inspect `ograf_get_playout` for the intended target and send
`ograf_control_playout` with `operation:{type:"update",slotId,stateId,data,mode:"in-place"}`.
The optional `stateId` guards the active state. Keep the same request ID when retrying an uncertain
response. Omitting `mode`, or sending `mode:"transition"`, preserves authored update transitions
for existing integrations. `target:"preview"` accepts Update only; graphics must already be taken
through Studio controls. Omitting `target` addresses the separate live/MCP session.

For coordinated OGraf exports, send standard `customAction` with `id:"transition.patch"` and
`payload:{slotId,stateId?,data:<field-patch>}`. It merges fields on an existing On or entering graphic;
Off or leaving targets reject. It does not change transition deadlines, activate a state, cancel a
prepared replacement, or restart a paused graphic. Scheduled patches retain their event times for
non-real-time replay. A patch loads a new image before applying it, so nothing blanks; a failed image
leaves the old one on air and the action returns an error. Continue using `transition.take` or
ordinary `updateAction` when a designed update transition is intended. A native ticker's
Immediately/Next appearance policy still decides when its item pixels change; in-place delivery does
not override that choice.

To make every same-state update on a lane apply in place, set `slot.updateMode:"in-place"` on that
lane (definition v6, Studio: When its content changes). `updateAction`, same-state `transition.take`
and Rule Updates then keep the mounted template, so unchanged layers stay at full alpha and no second
host or WebGL context is created. `requestId` stays the same across these updates: detect them by
comparing `data`. Changed layers use their own `updateTransition`, then the composition's update
length, then the lane's update recipe length. One data change, and any data Rules, happen when the
slowest changed layer has left. A plain image source is staged first. A video, Lottie, sequence,
audio, shader source or image with a fill falls back to the lane's normal Take.
Prepare the complete changed-image batch before applying it, including batches larger than eight
images; retain the previous picture on failure. On a layer with shader effects, animate the visible
effect output while keeping its capture input intact. Check interrupted updates in scheduled replay
as well as live playback: data, data Rules and manual clock values must commit at the same time,
including when seeking backwards.

Keep patch defaults empty. Never populate a live patch form with saved field defaults: submitting
one edited value must not overwrite unrelated live values. The maintained Devtool form integration
offers Include controls for absent optional fields and omits them from submission until selected.
Do not weaken exported field schemas or invent nullable values to silence host form errors.

The built-in public provider fetches Coinbase spot quotes and rolling 24-hour opening statistics,
plus daily ECB reference FX via Frankfurter. It uses browser CORS without keys or local services.
Configured USD product IDs are unique, uppercase, and limited to 16. Requests are paced; quote,
statistics and FX refreshes retain separate source timing. Never invent fresh quotes during errors.
Provider source timestamps, stale labels and daily reference dates remain visible.

Quote fields include `btcPrice`, `btcChange`, `btcColor` and corresponding configured symbol keys;
`cryptoItems` and `fxItems` contain complete native ticker items. `mover1Symbol/Price/Change/Color`
through mover6 provide the ranked board, and `cryptoStatus`, `fxStatus`, `asOf` identify freshness.
Direction triangles derive from the signed 24-hour comparison, not the previous polling sample.
For numeric Rules or charts, use the separate stable symbol fields `btcPriceValue`,
`btcChangeValue`, `btcHighValue`, `btcLowValue` and `btcOpenValue` (and the same suffixes for each
configured symbol). These are finite numbers; `ChangeValue` is a signed percentage such as
`1.25`, and `OpenValue` is the provider's rolling 24-hour comparison open. `btcAvailable` reports
whether a genuine observation has been received. Numeric values are omitted until then, rather
than filled with zero. Last real values remain available when stale; use `btcStale` and source
status to distinguish that state. Never coerce formatted price or triangle/percentage text into
numeric chart data. Ranked `movers` positions can change, so detail views should use symbol keys.

`changeChartData` is validated-shape JSON text for a chart's whole `data` binding: legacy
`{labels,datasets}` with one signed 24-hour return per configured symbol in configuration order,
plus the matching direction/stale colors. It is emitted only when every configured symbol has a
real quote. `btcRangeChartData` (and equivalent symbol keys) contains three categorical values,
`[24H low, Latest, 24H high]`, in that same chart format; it is omitted until that symbol is
available. These values describe the latest observations and are not historical price samples.
Bind these strings through `textarea` fields to chart target `data`; use morph updates for live
comparisons. Do not use canonical `counts` or `percentages` mode for signed market returns: those
modes describe non-negative distributions and impose different numeric constraints. A current
quote and its periodically refreshed 24-hour statistics can have different observation times.

Use **Immediately** when the operator requires visible quotes to change on receipt; price,
percentage, direction and color belong to one atomic ticker item. Keep scrolling phase and fixed
item widths. **Next appearance** remains available for deliberate deferred editorial changes.

Validate with the Data pane closed and in combined fullscreen: observe genuine updates in multiple
active lanes, disable a connection, pause/resume and take a lane out/in. Confirm unaffected editorial
fields and transitions, source round trips, and no helper process dependency. Exported OGraf modules
receive standard GDD updates from their playout controller; Studio's connection lifecycle does not
turn exported deterministic graphics into network polling applications.
