# AXIS Market Explorer

An editable application interface authored entirely with OGraf Studio layers, linked components,
Rules, custom actions and native Data Connections. The `.ogs` is a one-template set with one
application lane, so live feed patches preserve navigation, comparison and alert state.

## Open and use

1. Open **AXIS Market Explorer.ogs** in the current Studio dev build.
2. Open **Preview & Export**, show its controls, and **Take Market Explorer**.
3. Close the controls popup and use the application's own navigation. Fullscreen is optional.

- **Overview:** six live asset cards and a signed 24-hour performance chart. Click a card to explore it.
- **Digital assets:** select an asset and inspect its latest price, actual 24-hour low/open/high and range chart.
- **FX reference:** six daily ECB currency references with their publication date.
- **Compare:** choose A and B independently; compare prices/ranges and the common percentage chart.
- **Alerts:** each asset has its own above/below threshold, Arm and Reset state. Thresholds adjust
  in 0.5 percentage point steps. Alerts keep watching while other views are open. Arming an
  already-met threshold fires immediately on fresh, available data.
- **Test notification:** previews the notification without changing live prices or real alarm state.
- **Reset All:** clears and disarms every alarm.

## Data and charts

**Data → Connections → AXIS / Live markets** uses the built-in public Coinbase/ECB provider.
No helper process or API key is needed. Coinbase quotes refresh at most every 15 seconds,
24-hour statistics every 60 seconds, and dated daily FX references are checked hourly.

Charts display observed 24-hour percentage changes or Low / Latest / High price levels. They are
not fabricated intraday histories. Saved defaults are labelled as a snapshot until a connection
supplies current status. Stale or unavailable observations cannot trigger a real alert.

## Edit the application

The timeline organizes the application shell, view groups and logic. The **Button** and **Market
card** component assets provide reusable visual controls. Their instance Rules reference shared
application state; feed bindings remain attached to the individual asset fields.

Private `ui*` fields hold navigation, selections and alarm settings. They are not exposed to OGraf
or mapped from the feed. They belong to the playback session; restarting the application restores
the saved defaults. Mouse interaction runs in real-time preview, while custom actions also provide
named commands for navigation and alerts.

The source includes its font, component definitions and pinned chart renderer. Exported OGraf
packages receive data from their playout controller; Studio's connection settings belong to `.ogs`.
