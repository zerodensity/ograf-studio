# OGraf frame playback

Studio preview and exported graphics use the same frame player and compiled scene sampler. Animation tracks and easing remain part of the scene model; the player advances the composition position and applies the sampled pose to the DOM.

## Time units

- `FramePlayer.frame()`, `durationFrames()`, `seek()` and `animateTo()` use composition frames. Positions may be fractional.
- `animateTo()` accepts an optional `durationMs`. Without it, duration is the distance between the current and target frames divided by the composition frame rate.
- Public OGraf `goToTime` and scheduled-action timestamps remain milliseconds. Convert at the runtime boundary.
- Realtime playback samples elapsed timestamps. Display refresh rate does not change the template's animation speed.

## Player API

```ts
const player = buildRuntimeTimeline(descriptor, layerElements, () => currentData);

player.on('update', () => updatePlayhead(player.frame()));
player.seek(12.5);
player.play();
player.pause();
player.render();

const transition = player.animateTo(stepFrame, {
  durationMs: 600,
  onComplete: finishAction,
  onInterrupt: finishAction,
});
transition.cancel();
player.dispose();
```

`seek(frame, true)` suppresses transport callbacks and still renders the complete scene. It interrupts the current transport. Use `render()` to reassert the current pose while leaving playback active, for example when restoring editor overlays. Rendering samples every participating layer before applying layout, motion paths, visual properties, clipping and masks. Seeking backward uses the same sampler as forward playback.

Transitions have cancellable handles. Completion and interruption release pending lifecycle actions, including transitions with zero duration. Call `dispose()` when replacing a composition or removing its graphic.

## Lifecycle and content clocks

A Step hold stops the composition playhead. Independent shader, media, pattern and local-loop clocks can continue on air. Pause and Stop controls retain their existing content-clock behavior.

The shared realtime ticker uses `requestAnimationFrame`. Studio's detached-window integration calls `tickFramePlayers()` from a visible popup when the main document is hidden, sampling the main runtime clock.

Replacing an unfinished data update commits its pending values, data Rules and manual clock values
at the replacement time. Scheduled replay uses that same boundary, including after backward seeks.
In-place coordinated updates prepare the complete changed-image batch before applying it; shader
effect layers animate their visible output while retaining the capture input.

Existing `.ogs` and `.ogp` documents retain their animation representation. Rebuilding an exported package embeds the frame player in its self-contained runtime bundle.

## Prepared instances and GPU completion

Realtime coordinated playback keeps one bounded pool of unused prepared template instances and
shared resource probes: at most four entries and an estimated 64 MiB. Idle preparation can warm likely alternatives while all their
clocks and events remain dormant. Taking a matching instance consumes it once; previously on-air
mutable instances are not returned to the pool. Unactivated shared probes may return after readiness;
canonical on-air shared renderers keep their separate lifecycle. Cache misses use ordinary preparation. Load,
disposal and owner-document changes invalidate the pool. The estimate limits retained resources;
it is not a measurement or guarantee of browser GPU memory use.

`getPreparationCacheSnapshot()` is an optional runtime diagnostic for counts, estimated bytes,
hits, misses, evictions, limits and preparation activity. It is not part of the OGraf lifecycle
interface and does not change operator selections.

Preparation does not put a lane On, satisfy admission, reserve layout space, fire Rules or alarms,
or skip authored transition/dependency timing. Scheduled non-realtime rendering uses fresh replay
and does not depend on this pool.

Ordinary shader draws submit GPU work without `gl.finish()` or a synchronous error query for every
draw. Explicit content readiness, OGraf `goToTime` and browser capture wait for the requested frame
through asynchronous GPU fences. Compilation and initialization errors still surface, and context
loss, disposal, failed waits or timeout reject unfinished work. Await these operations before
reading exact pixels; a faster submission is not permission to capture an incomplete frame.

## Fullscreen playback and visual checks

The Templates pane normally refreshes thumbnails after committed edits. During Preview & Export
fullscreen, Studio defers PNG rendering in Templates and Transitions until fullscreen exits and then uses the latest
project. This also applies to detached preview windows and does not change authored timing.

While nobody can see the Preview & Export graphic, because another tab is selected, its section is
collapsed or it is scrolled out of the panel, Studio keeps it loaded but stops drawing it. Playout
Controls, keyboard playout, data updates and edits still reach it, and the current picture returns
when it is shown. A preview that is fullscreen or in its own window keeps drawing.

For the six modifier examples, check Grid Arrange, Radial Arrange, Justify, Look At, Spline Path
and Responsive Text in the editor, fullscreen preview and the exported coordinated package.
Switch in both directions, take examples out and back in, and update the exposed sponsor/headline
fields with short, long, empty and restored values. Verify children remain attached, text stays
inside its cards, and fitting, hiding and following geometry recompute after each update.

Wait for Take, Update and Out to complete before recording a settled preview. Coordinated switches
may play the old template's Out before the new template's In. Use the source's frame rate and
durations to distinguish this authored sequence from a rendering pause. Capture moving output as
well as settled frames; a deterministic PNG or strip does not measure real-time smoothness.
Run the external renderer's lifecycle checks on the same exported package and restore test data
afterward. See the [modifier review reference](../skills/ograf-authoring/references/modifiers.md#modifier-example-playback-review)
for the complete data and switching cases.
