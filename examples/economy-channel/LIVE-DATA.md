# Economy channel: market data

This example uses genuine public Coinbase Exchange observations and ECB daily currency reference
rates delivered by Frankfurter. No API key is required. It does not pretend to carry Nasdaq stock
quotes, a consolidated US equity feed, or streaming FX prices.

## Native Studio connections

Open **AXIS Markets.ogs** and use **Data → Connections** to inspect its saved connections. Five
data-driven templates already contain an enabled **AXIS · Coinbase + ECB** connection:

- Source: **Public markets** (`public-markets`)
- Target: **Editor and on-air templates** (`both`)
- Refresh: **5,000 ms**
- Missing values: **Keep last**

No local relay, helper launcher, Node installation or API key is needed to operate this set.
Studio fetches the public APIs directly in the browser, and connections with the same provider
configuration share a cached source. The native background service remains active when the Data
pane is closed and in fullscreen preview. It maps only the declared data fields and updates
templates that are already on air. Pending transitions finish before updates are applied; paused
output receives the latest values after it resumes. Data refresh uses ordinary updates without
retaking a lane or resetting its playback clock. Editorial headline text and saved field defaults
remain authored values; existing data-triggered Rules and text effects retain their normal behavior.

For a new template, add a connection, choose **Public markets**, select its target, and use
**Map matching field keys** to connect the fields listed below. The default products are
`BTC-USD`, `ETH-USD`, `SOL-USD`, `XRP-USD`, `LINK-USD` and `AVAX-USD`. Up to 16 Coinbase USD
product IDs can be configured. An unsupported product remains unavailable; no price is invented.

The `.ogs` stores these connection settings and mappings. Provider observations remain runtime
values. Saved fallback artwork is labelled **SAVED SNAPSHOT** until a current connection supplies
its source status. Provider errors, exchange trade timestamps and FX publication dates distinguish
fresh observations from retained data.

Connections read the shared browser cache every five seconds. Coinbase quotes refresh every
15 seconds, their rolling 24-hour comparison open every 60 seconds, and the daily FX source once
an hour. Requests are paced, have an 8-second timeout, and retry
with bounded exponential backoff. Last good values remain available through provider failures.
A crypto value is marked stale after 90 seconds without a fresh trade or successful refresh.
FX remains labelled **ECB REFERENCE** with its actual publication date: weekends and holidays do
not turn it into a live rate. Failed FX refreshes become stale after six hours; a reference older
than seven days is also stale.

## Studio bindings

The native source exposes the following paths. Data → Connections also supports JSON URLs with
dot-separated paths for other providers. Map a path to an ordinary data field in the relevant
template, then bind that field to the artwork.

| Path                                                       | Field type | Usage                                                       |
| ---------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| `cryptoItems`                                              | array      | Bind to the native ticker's complete `items` property       |
| `fxItems`                                                  | array      | Second ticker, same binding                                 |
| `cryptoStatus`, `fxStatus`                                 | string     | Visible source/freshness strips                             |
| `cryptoFresh`, `fxFresh`                                   | boolean    | Rules or operator health indicators                         |
| `btcPrice`, `btcChange`, `btcAsOf`                         | string     | Quote card; repeat with `eth`, `sol`, `xrp`, `link`, `avax` |
| `btcColor`                                                 | color      | Signed change color; same six prefixes                      |
| `btcStale`                                                 | boolean    | Quote stale indicator; same six prefixes                    |
| `mover1Symbol`, `mover1Price`, `mover1Change`              | string     | Ranked board rows 1 through 6                               |
| `mover1Color`                                              | color      | Ranked row color, rows 1 through 6                          |
| `usdeur`, `usdgbp`, `usdjpy`, `usdchf`, `usdtry`, `usdcad` | string     | Daily currency pairs                                        |
| `fxDate`, `source`, `asOf`                                 | string     | Attribution and source time                                 |

The first six quote fields use USD. Change percentages are calculated against the provider's
rolling 24-hour open, not the prior equity-market closing price. Ranked movers sort those same
six observed crypto instruments by 24-hour change; they are not Nasdaq movers.

Ticker items use complete native text elements, stable IDs (`crypto-btc`, `fx-eur`), fixed widths
and colored runs. This package deliberately uses **Immediately**: every received quote replaces
its visible symbol, price, percentage, direction icon and color together. Scrolling keeps its
phase and fixed item widths. Feed refresh is independent of scrolling; do not restart the ticker.
The font is Roboto Condensed with Arial Narrow and Arial fallbacks; the template packages its
chosen font. The three Market watch cards use equal widths and 16 px gaps. Transition logic
preserves 16 px vertical clearance between visible bands and between the headline and board as
independent lanes enter and leave.

Studio connections can target the editor, on-air templates, or both. Their settings persist in
editable `.ogs` files, but exported `.ograf.zip` packages receive controller-fed GDD values;
they do not automatically fetch Studio's configured providers. An external OGraf controller
should fetch normalized market data and use the coordinated package's **Update on-air data in place**
action (`transition.patch`) with the lane, optional current-state guard and changed data fields.
It patches the existing on-air instance without a dissolve or a new ticker mount. Native Studio
connections use this same path. Explicit `transition.take` and standard `updateAction` retain
authored transition behavior for deliberate editorial updates.
Do not send `playAction` for a quote update. A controller should compare relevant data fields and
send only changed values; `generatedAt` alone is not a reason to restart animation.

For MCP use `ograf_control_playout` with `operation:{type:"update",mode:"in-place",slotId,
stateId,data}` and the current session revision. An omitted mode keeps the earlier animated
Update behavior. The optional bridge below selects `in-place` explicitly.

## Optional repository integrations

The relay and MCP bridge scripts remain available for external-controller integration work.
They are not required by the saved AXIS set, and its previous live-data launchers have been
removed. **Disable the matching native Studio connections before starting the optional bridge**
to prevent competing writes.

From the source checkout, with Node 22 or newer, start the optional relay:

```sh
node examples/economy-channel/market-feed.mjs
```

It binds to the local computer. `ECONOMY_FEED_PORT` overrides port 5250.

- `http://127.0.0.1:5250/market.json` — normalized market snapshot
- `http://127.0.0.1:5250/health` — 200 when current; 503 while connecting or degraded
- `http://127.0.0.1:5250/events` — server-sent snapshots for a local controller

The snapshot endpoint returns 200 while degraded so a controller can display status alongside
the last received value. The relay starts without invented prices and retains only real provider
observations in memory. To feed Studio through MCP instead of its native connections, pass the
actual set ID from `ograf_get_template_set`:

```sh
node examples/economy-channel/studio-bridge.mjs --studio http://127.0.0.1:5242/mcp --set SET_ID
```

It updates only settled, already on-air lanes named `identity`, `crypto`, `fx`, `strip` and `board`.
The default `--target preview` controls the visible combined Preview & Export output. Use
`--target live` only for the separate live/MCP session. Both inspection and update calls use the
same target so one session can never accidentally receive another session's revision or data.
It uses declared data keys, checks the set ID, guards the current state and revision, and skips
identical values. It never changes authoring defaults, loads a set or takes a graphic in/out.
Pending transitions and paused output are left alone until they finish/resume. Uncertain requests
reuse their original idempotency key. Opening another set or modifying the loaded source stops
feed writes until the expected set is loaded again. This bridge also avoids depending on whether
Studio's Data → Connections tab is currently mounted. The headline remains fully editorial.
If the relay stops while Studio stays connected, the bridge marks its last received data as
disconnected/stale on screen without inventing new prices. Reconnecting resumes observed values.

## Licensed US equities

For Nasdaq-listed equities, connect the channel's licensed provider through a normalized JSON
endpoint or external playout controller, preserving the same ticker/quote interface. Keep provider
API keys on the provider integration server and out of
`.ogs`, `.ograf.zip` and browser URLs. Use the provider's actual exchange timestamps, market-session
status, delay and attribution; label delayed or end-of-day quotes visibly.

Twelve Data is one possible adapter: its documented default real-time US equities feed represents
a subset of total US trading activity. Its redistribution add-on and relevant display rights
must be arranged for external distribution. A paid data subscription alone must not be assumed
to grant television redistribution rights. The present example makes no requests to Twelve Data
and contains no untested key-dependent adapter.

## Source documentation

- [Coinbase last-trade snapshot](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker)
- [Coinbase rolling 24-hour statistics](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-stats)
- [Coinbase public request limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits)
- [Frankfurter rates, provider selection and daily frequency](https://frankfurter.dev/)
- [Twelve Data US equities coverage and external distribution](https://support.twelvedata.com/en/articles/9935903-us-equities-market-data)

Read the provider's applicable data-use terms before broadcasting publicly. Public unauthenticated
access is not itself a statement that all downstream redistribution is unrestricted.

Recreating the set with `build-set.mts` uses the native public provider by default. Set optional
`AXIS_FEED_URL` only when a different compatible source is required for that authoring run.

Focused native normalization/freshness checks:

```sh
npx vitest run apps/editor/src/data/publicMarkets.test.ts
```

Optional integration-script checks:

```sh
node --test examples/economy-channel/market-feed.test.mjs
node --test examples/economy-channel/studio-bridge.test.mjs
```
