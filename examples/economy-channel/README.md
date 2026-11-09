# AXIS Markets

An editable 1920 × 1080, 50 fps economy-channel package for OGraf Studio.

Open **AXIS Markets.ogs**, then open **Preview & Export** or **Window → Playout Controls**.
Take each lane independently. The Market brief / alert lane offers two editorial templates.

| Lane                 | Graphic                                              |
| -------------------- | ---------------------------------------------------- |
| Identity & UTC       | Channel identity, UTC clock and feed status          |
| Digital assets crawl | Coinbase spot quotes with signed 24-hour changes     |
| FX reference crawl   | Six USD currency pairs with the ECB publication date |
| Market watch cards   | BTC, ETH and SOL prices and changes                  |
| Market brief / alert | Editable headline or amber market alert              |
| Market pulse board   | Six instruments ranked by their 24-hour change       |

Green ▲ means an increase, red ▼ a decrease, and • no change. The signed percentage remains
visible. The comparison is the provider's rolling 24-hour open. FX uses dated daily reference
rates and does not invent a live change percentage.

The quote cards reserve space above the main ticker. Taking the FX ticker first lifts the cards
and headline, then reveals the FX band. Out hides the FX band before returning that space.
Taking one lane out leaves the others running. Headline and alert replace each other in one lane.
The three Market watch cards have equal widths and consistent 16 px gaps. Vertical spacing stays
at 16 px as ticker combinations change, and the headline keeps that same clearance from the
Market pulse board. These arrangements are authored through transition logic, so each graphic
can be taken independently without overlapping its neighbors.
The AXIS identity box grows upward to span both ticker rows when FX is on. The Pulse board
keeps its top 16 px below the UTC clock and resizes its bottom to match the headline, maintaining
16 px clearance above the next visible band. Its footer follows the bottom edge. These changes
make room before a band enters and restore space after it leaves.

## Live data

Live data runs inside Studio. Open the saved set with an internet connection and take the desired
lanes; no helper launcher, local feed server or API key is required. The set includes five enabled
**AXIS · Coinbase + ECB** connections, one on each data-driven template. In **Data → Connections**
their source is **Public markets**, their target is **Editor and on-air templates**, refresh is
**5,000 ms**, and missing values use **Keep last**. The headline and alert remain editorial.

Connections continue running when the Data pane is closed and while preview is fullscreen.
Updates reach existing on-air templates after pending transitions finish or playback resumes;
they never retake a lane or change saved field defaults. Enter fullscreen, then right-click for
controls; **D** toggles the panel and Escape exits. Keep Studio's **Sync editor and preview**
disabled when operating independent playout lanes.

The five connections share one browser data cache. Coinbase quotes have a 15-second refresh,
their rolling 24-hour statistics a 60-second refresh, and ECB/Frankfurter references an hourly
refresh with their publication date shown. Connections read that cache every five seconds.
Saved defaults say **SAVED SNAPSHOT** until a successful native connection supplies current
status. Quote changes update visible ticker items at the next feed refresh; price, percentage,
icon and color change together while scrolling continues. A stale feed retains its last real
values and marks their status.

This demonstration carries digital assets and FX references. A Nasdaq/US-equity provider can
replace the feed adapter using the same fields and lane controls. See [live-data contracts and
sources](LIVE-DATA.md) for provider details and external-controller integration.

## Recreate from source

The authoring scripts use Studio MCP and preserve a recovery copy of the current project before
starting a new set. Use a fresh authoring session and keep Studio visible. They need the Studio
source checkout and its dependencies. Set `AXIS_ORIGINAL_PROMPT` to the verbatim user request
that should be saved with the templates before running the scripts.

```sh
npx tsx examples/economy-channel/build-set.mts
node examples/economy-channel/configure-playout.mjs
```

`OGRAF_MCP_URL` and `AXIS_BUILD_STATE` select the Studio endpoint and local authoring checkpoint.
`build-set.mts` uses the native public provider directly by default; optional `AXIS_FEED_URL`
selects an alternative compatible feed while authoring. The generated `.ogs` contains the font,
linked component sources, bindings, transition graph and native connection settings.

Exported `.ograf.zip` graphics receive ordinary GDD updates from their external playout controller;
the saved Studio connection does not become an automatic network task inside an exported graphic.
Optional relay and MCP bridge scripts remain in this repository for integration work. Disable
the corresponding native connections before using that bridge, so two data sources do not compete.
