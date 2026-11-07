# Native mixed-content ticker

Use the native `ticker` element for a continuous feed containing text, images, image sequences,
Lottie, shapes, patterns or shaders. Discover `elementSchemas.ticker` in the running server's
`elements` capability section before authoring. `add_layer` with `kind:"ticker"` and the
`create_ticker` recipe create this native element. Existing saved text crawls remain unchanged;
see [broadcast recipes](./broadcast-recipes.md) for compatible field names and native recipe options.

## Authoring

In Studio, choose **Ticker** in the add-object toolbar and edit its items in Properties. The
ticker's layer transform defines its viewport. Its ordinary Start, Step and End animation moves
or resizes the whole viewport independently of continuous travel. The ticker may also occupy a
normal transition lane in a coordinated set.

Use one revision-checked `ograf_apply_operations` batch to add the layer, then inspect its returned
element before replacing items. `update_element.patch` edits ticker fields. Retain complete native
child element definitions and stable item IDs when updating the feed; do not fabricate partial
text, Lottie or shader definitions that omit required native settings.

| Field                   | Meaning                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `items`                 | Up to 128 ordered entries with unique IDs matching `[-A-Za-z0-9_]{1,100}`.                                             |
| `items[].width`         | Explicit composition-pixel width, greater than zero and at most 16384.                                                 |
| `items[].height`        | Optional height; defaults to the viewport height.                                                                      |
| `speedPixelsPerSecond`  | Fractional pixels per second, from 0 to 2000. Zero stops travel.                                                       |
| `gap`                   | Composition pixels between items, from 0 to 16384.                                                                     |
| `direction`             | Defaults to `left` (right-to-left travel); `right` means left-to-right travel. Explicit saved directions are retained. |
| `textDirection`         | `auto`, `ltr` or `rtl`; independent of travel direction.                                                               |
| `updatePolicy`          | `next-appearance` (default) or `immediate`; controls when prepared item edits become visible.                          |
| `entryFade`, `exitFade` | Independent stationary alpha-fade widths in composition pixels. Zero disables that edge's fade.                        |
| `fadeSoftness`          | From 0 to 1; changes the fade curve.                                                                                   |
| `background`            | Optional normal Paint behind content, outside the content edge mask.                                                   |

Explicit widths reserve prepared layout and prevent late font measurement or decoded image size
from changing the scroll period. Preserve fractional widths and gaps. Choose a width that fits
representative bound text, including Arabic/Hebrew shaping and mixed English/numbers; an explicit
item box does not automatically grow to fit a longer headline.

Child content uses the existing native renderer:

For market quotes, keep symbol, price and signed change in one rich-text item so a data update
replaces the quote atomically. Use the immediate policy when live prices must update while visible.
Static rich-text runs must share one inline
flow inside the vertical-alignment container; placing each run directly in a column flexbox
incorrectly stacks the quote into clipped rows. Review colored quotes at full output size.
Compare the ticker's text proportions in the editor and Preview at different canvas zooms: Studio
chrome font rules must not replace authored typography in rich-text or animated-text wrappers.

- Text retains fonts, gradients, shader fill/outline, bidirectional shaping and Text FX.
- Images and image sequences use normal `asset:<id>` references or embedded sources. Their alpha,
  fit and source crop remain intact. Sequence FPS is independent of the output frame rate.
- Lottie uses the existing self-contained animation profile; inspect its normal warnings and
  unsupported features. It is sampled from the same content clock, rather than starting an
  independent looping player.
- Shader, rectangle, ellipse, path and pattern items preserve their native definitions.
- Each item may carry the standard `effects` stack. Its optional `animation` is
  `{type:"none"|"fade"|"rise"|"scale",durationMs,delayMs}`, with times from 0 to 60000 ms.
  Item motion uses the ticker's shared content time; it does not restart on every viewport entry.

Nested tickers, charts and audio are not supported as ticker items. An existing scene object can
be copied into a ticker item where its element type is supported; the copied element and effects
remain editable, but a ticker item is not a linked component instance.

## Data and bindings

Bindings use stable IDs, not array positions:

- `items.headline.content`
- `items.logo.src`
- `items.headline.fill.parameters.gain`
- `items.headline.effects.EFFECT_ID.PARAMETER`

The usual child property semantics and field exposure controls apply. Numeric ticker settings
such as `speedPixelsPerSecond`, `gap`, `entryFade`, `exitFade` and `fadeSoftness`, plus `direction`
and `textDirection`, can also be bound. `items.ID.width` and `items.ID.height` edit the item box.
To bind an entire feed, use an `array` field with target property `items`; incoming values may be
an array of complete native item definitions or a JSON array string. Invalid IDs, duplicate IDs,
unsupported content or invalid widths are rejected. Reordering items must preserve their IDs and bindings.

## Safe updates while scrolling

**Apply updates → Next appearance** is the default, including older native ticker definitions
that omit `updatePolicy`. An admitted copy retains its content, width, height, effects and shaping
for that pass. The revised item is prepared offscreen and enters in the normal feed order.
Inserted items enter from the entry edge; removing an item prevents future entries while its
admitted copies finish leaving. Repeated copies are independent: a short feed can show an old
copy and a revised copy together without waiting for every copy to disappear simultaneously.

Use stable item IDs for editorial edits. Replacing an ID means removing one item and inserting
another. Repeated edits to an unadmitted item retain the latest requested revision. A copy already
admitted for its approaching pass keeps its reserved revision and geometry. Do not restart the
ticker or change its speed to apply a feed edit. Stopped scrolling can leave a revision pending
until travel resumes. A paused Studio authoring edit updates the stopped design immediately;
this does not flush queued data changes in an on-air or paused playout session.

Properties and the existing preview/playout controls show **pending** updates. The count describes
changed, added or removed feed items, not every repeated render copy; its detail also reports
resource preparation or an error requiring attention. Prepared content must pass the normal
font/image/shader readiness gate before admission. A late resource result from a replaced revision
must not clear the current pending state or change an admitted copy.

For MCP inspection, read `ograf_get_playout.tickerUpdates`. Each mounted ticker reports its
policy, pending/changed/added/removed counts, preparation count and any current resource error.
Inspect the active output's status rather than counting repeated DOM copies or assuming that a
successful data write means the visible revision has already changed.

Choose **Immediately** for a deliberate on-screen correction; it applies ready content without
the Next appearance guarantee. Feed visual deferral must not defer bound data or Rules events:
Rules receive the update at their normal authored time, including any existing update-transition
timing, and item deferral adds no extra Rules delay. Non-realtime
exports replay feed changes at their scheduled millisecond timestamps before sampling the target
frame, including backward and repeated seeks.

## Shader paints and portable resources

Ticker background, child fill/outline and item shader-effect usages appear in
**Resources → Shaders** and open the normal shader editor. Paints move with their prepared item;
the edge mask remains fixed to the viewport. A shader effect's `iChannel0` is its incoming stack
image, following the existing effect contract. Shader alpha and the child's own masks combine
with the outer edge fade; do not replace child alpha with a full rectangle.

Single and coordinated exports recursively package child images, frames, shader image inputs,
media fallbacks, fonts and copied shader notices. Do not leave authoring `asset:` references or
local file paths in generated output. Bound image defaults and value maps require the same
resource packaging as directly authored image sources.

## Clock, preparation and performance

Position is derived from elapsed milliseconds and pixels per second. Fractional frame rates and
subpixel positions must remain precise: do not round speed or convert it into an integer number
of pixels per output frame. Browser compositor animation carries eligible realtime travel between
samples. Explicit timeline sampling and non-realtime OGraf seeking use the same absolute-time
position, independent of earlier seeks.

Ordinary forward samples retain the same compositor animation even after a delayed callback.
Explicit paused/backward seeks still resample the requested pose. Prepared cell positions derive
from fixed pass geometry so floating-point cancellation cannot rewrite their CSS position every
frame. A busy shader/effect stack can still stall presentation: use native shader fills for
generative decoration and profile the complete graphic, not only an isolated ticker.

Upcoming items and both repeat seam windows are prepared before they become visible. Fonts,
images, Lottie and shader resources follow the normal readiness gate. Prepared instances are
bounded at 2048, including repeated copies; excessively dense feeds fail with an actionable error
instead of silently omitting items. Increase item widths or the gap for an extreme tiny-item feed.
Do not bypass readiness or reduce authored transition timing to improve a performance score.

All image-sequence frames are decoded before admission, sharing one preparation per unique URL
across repeated copies. Removed frame sources are released from that feed's preparation cache.
When replacing content, only the current preparation generation may reveal its item or report
its failure; a late failure from a replaced image must not poison the corrected feed. A failed
replacement retains the previous visible pixels and their animation clock. Corrected content is
prepared atomically: Next appearance admits it on a later pass; Immediately can swap it when ready.
Retired renderers are then disposed. Ordinary image items retain normal
image loading; require cross-origin pixel access only when the actual paint/effect needs it.

Prepared shader text must retain layout and visible glyph alpha while its replacement is staged.
Use non-inherited content opacity to suppress presentation during preparation; inherited
`visibility:hidden` can bake an empty glyph mask and leave the ready shader text invisible.
The shader/effect mask capture must ignore that temporary presentation opacity. Verify actual
rendered text, not just the ticker's bounds, movement or readiness status.

Realtime speed edits retain the live pose where possible. Next appearance preserves admitted
item geometry across content, width, insertion and removal edits; deterministic seeks must still
reproduce the requested timestamp and its feed-event history.

Compositor travel reduces main-thread sensitivity, but heavy shaders, effects, decoder work and
display/output cadence can still cause dropped or repeated frames. Do not promise zero stutter
on arbitrary hardware, every browser, or mismatched monitor refresh rates.

## Required playback review

For a ticker deliverable, verify Studio's canvas, Preview & Export and fullscreen output, plus
the actual exported package in an OGraf renderer. Keep the measurement page visible; background
tab throttling invalidates smoothness measurements.

1. Save/reopen `.ogs` and check item IDs, image resources, RTL text, shaders, effects and bindings.
2. Compare speed at the supported output frame rates, including fractional rates. At a shared
   timestamp the position should agree; adjacent output frames should travel `speed / FPS` pixels
   apart, allowing modulo-equivalent positions at the repeat seam.
3. Review both travel directions, mixed-script text, the repeat seam, alpha on light/dark/checker
   mattes, independent background opacity, and entry/exit fades during viewport resizing.
4. Exercise pause/resume, restart, visible text/image and width updates, insertion/removal and a
   live speed change. Under Next appearance, inspect old and new repeated copies separately and
   confirm pending clears after the correct entry/exit. Check that unrelated transition lanes
   and their Rules continue normally and that an empty feed lets its last visible items finish.
5. Test standalone and coordinated exports, including backward/repeated non-realtime seeks,
   animated child frames and shader time. Repeated timestamps must reproduce the same output.
6. Review visible movement and frame-drop counters separately. RAF intervals and sampled CSS
   positions are timing evidence, not proof that every physical display frame was presented.

Use the existing final certification and exact-artifact export workflow. A valid manifest alone
does not establish visual smoothness, correct alpha, or live-update continuity.
