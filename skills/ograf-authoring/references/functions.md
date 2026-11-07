# Functions and state logic

Use **Window → Functions** for reusable calculations, interactions, state machines, and games that
need more than literal Rules actions. Keep the visible result as ordinary editable layers, text,
components, and runtime collections. Do not replace the composition with an opaque web page or
renderer plugin to implement gameplay.

Discover `bindings.functions` in capabilities before authoring. `set_logic_functions` replaces the
current composition's complete function list in one revision-checked transaction:

```json
{
  "type": "set_logic_functions",
  "compositionId": "existing-composition-id",
  "functions": [
    {
      "type": "javascript",
      "version": 1,
      "id": "counter",
      "name": "Counter",
      "enabled": true,
      "source": "({state,event}) => event.type === 'custom-action' ? {state:{count:state.count+1},data:{score:state.count+1}} : {}",
      "inputs": {},
      "outputs": { "score": "existing-score-field-id" },
      "actions": ["counter.increment"],
      "initialState": { "count": 0 },
      "timeoutMs": 250
    }
  ]
}
```

Create referenced fields, custom actions, and Media Cues first. Pass `functions: []` to remove all
functions. Rules can invoke the registered custom actions from clicks or keyboard events; use
paired key-down/key-up actions for held controls. A function is composition-owned rather than
owned by whichever object stores the input Rule.

## Explicit mappings

- `inputs` maps safe aliases to field IDs whose current values the function may read.
- `outputs` maps aliases to field IDs it may update. One function owns each output field; two
  aliases must not compete for the same output. A function may read and write the same field.
- `actions` lists existing public custom-action IDs delivered to the function.
- Optional `emits` maps aliases to existing custom-action IDs the function may request.
- Optional `media` maps aliases to existing Media Cue IDs the function may control.
- Optional `pointer: true` enables **Bindings → Mouse input** for this function. It adds
  `ctx.pointer`, not a data field or an exposed operator control.

Aliases are JavaScript identifiers; `__proto__`, `constructor`, and `prototype` are forbidden.
Remove or reconfigure a function before removing its referenced fields, actions, or cues. Input
reads and output writes appear in the field-usage audit. Functions and their configuration belong
to authoring metadata, not the operator's data form. Mark internal state and output fields with
`exposeToOgraf: false`; expose only intentional operator controls. Existing bindings and Rules
continue to receive the local data output.

## Execution contract

`source` is a synchronous function expression, or an IIFE returning one. It receives:

```ts
{
  state,                 // previous JSON state, initially initialState
  data,                  // values keyed by declared input aliases
  event: {
    type,                // load | play | out | data | blur | tick | custom-action; focus when Mouse input is enabled
    actionId?, payload?, changed?
  },
  nowMs                  // supplied runtime clock
  pointer?               // opted in only: {x,y} composition pixels, or null
}
```

Return only a JSON result object:

```ts
{
  state?,
  data?: { outputAlias: value },
  actions?: [{ name: emitAlias, payload? }],
  media?: [{
    name: mediaAlias,
    command: 'play' | 'restart' | 'pause' | 'resume' | 'stop' | 'controls',
    gain?, muted?
  }],
  wakeAt?: number | null
}
```

Omitted state retains prior state. `wakeAt` is an absolute time in the supplied clock: a number
requests a future tick, `null` cancels, and omission preserves the existing wake unless the current
tick consumed it. The host enforces a 16 ms minimum from the start of the invocation that explicitly
requests a new wake deadline, so worker execution time is included rather than added as another
delay. Unrelated events that omit `wakeAt` retain the existing deadline. Use explicit state and the supplied
clock instead of private timers, mutable globals, wall-clock guesses, or DOM reads. Worker-local
closures are not persistent state: a fresh isolated worker executes each invocation. For seeded
games, keep the generator state in returned JSON.

For continuous motion, return only **changed output aliases**. Omitted aliases keep their current
values; an emitted object or array alias must contain its complete new value. Keep static brick
layouts, labels, and other unchanged groups out of per-frame patches. Store compact change
signatures rather than copies of the entire rendered output in state, which also crosses the
worker boundary on every invocation. Measure function CPU, transport latency and visible rendering
separately; keep the preview foreground and unobscured for frame-cadence measurements.

Mouse input is off by default. When enabled, `ctx.pointer` samples the latest position inside the
graphic in authored composition pixels, including preview scaling and canvas crop offsets. It is
`null` outside, after blur, while off air, and after changing the output document. Functions without
the opt-in receive no pointer property. Pointer movement only updates this snapshot; it never
queues a separate invocation. Use a scheduled tick for continuous pointer-driven interaction, or
read the current position in a click-triggered custom action. The capture phase updates the
snapshot before click Rules execute. Operator controls and other browser areas do not supply
positions. Do not register global browser mouse listeners from function source.

Mouse-enabled Functions also receive a deduplicated `focus` event when the on-air window/surface
regains interaction. Editing input fields keeps the function blurred; off-air functions receive no
focus event. Use `blur` to cancel pointer-only idle ticks with `wakeAt: null`, then `focus` to resume
Ready/Serve pointer polling. Focus gain must not automatically unpause an active game or restart
music; retain that state until an explicit action. Functions without Mouse input retain their
existing event and tick behavior, so unrelated calculations are not globally paused.

Mouse-enabled ticks follow the output document's rendering cadence. If the browser stops painting
normally, their work is suspended, owned media is paused, and incomplete results/effects are
discarded. Recovery uses the last committed state in a fresh sandbox after healthy visible frames;
it delivers blur, any deferred Out/Play, the latest coalesced input changes, then focus. Handle blur
and Out by rebasing your clock **before** physics or elapsed-time simulation, and keep active games
paused until an explicit resume action. This avoids a catch-up jump after occlusion. Ordinary
Functions without Mouse input keep their own scheduling. Execution deadlines remain enforced.

For data-driven motion, bind ordinary numeric output fields to `layer.x`, `layer.y`, `layer.width`,
`layer.height`, or `layer.rotation` using `set_layer_bindings`. Nested object `sourcePath` values and
runtime-collection item paths are supported. These replace the sampled pose before Rules, layout,
modifiers, and clipping; they are actual geometry, not an extra CSS offset. Bind `layer.opacity` to
a **0–1 factor**: it multiplies authored animated opacity, so Take/Out still fade correctly. Width
and height must be finite and nonnegative, positions/rotation finite, and source fields numeric
(or explicitly mapped to numeric values). Invalid live values keep the authored sampled fallback.
Keep lifecycle alpha animation on the layer and use data opacity only for gameplay visibility.
Dragging or editing a bound absolute geometry property updates its numeric field default or the
active value-map entry while retaining the binding and other nested values. It does not create
invisible geometry keys; collection prototype edits affect the first item. Opacity remains an
independent authored animation channel multiplied by the data factor.

Only declared output/action/media aliases are accepted. No play/restart or emitted action should
run while loading or off air; stop/pause/control requests may release or silence resources.
Stop or pause loops on Out, blur, fault, and disposal as appropriate. Use existing embedded audio
assets and Media Cues rather than fetching sound during play. Browser audio may require the
operator's first actual playback gesture.

## Isolation and limits

Source never evaluates on the Studio or renderer main thread. It runs in a worker created by an
opaque-origin sandbox frame with restrictive CSP; it cannot access the project, DOM, or network.
The host controls declared data and media effects, execution deadlines, and worker termination.
Do not add `eval`/`Function` calls to the main thread as a fallback when workers are unavailable.
Configuration validation does not execute or prove the source; verify it in real playback.

The runtime keeps at most one unused prepared worker alongside an active invocation. Preparation
compiles the wrapper without evaluating user source; the readiness probe and actual invocation
run only in their isolated workers. Every executed realm is terminated rather than reused.
Immutable script bytes may be cached. Native parsing has a separate two-second startup limit;
it does not evaluate user source. Browser descheduling during unused preparation is not charged
to the later authored execution deadline. That deadline still covers the user expression,
function call and result serialization. An expired unused worker is discarded without a retry
loop; a consumed stale preparation may be replaced once, before user code starts and within the
original request startup deadline. Prepared workers, script URLs and listeners are released on
fault or disposal. Do not replace this with persistent user globals or relax origin/CSP isolation,
JSON bounds or user-code execution watchdogs for speed.

A trusted worker supervisor owns the user workers and talks to the parent through a private
MessagePort. The hidden frame only bootstraps it; user workers never receive the parent port.
The frame transfers its private ports to its actual owner window, authenticated by frame identity
and token. This works when Studio code manages a preview in another document; it must not depend
on a message being sent from the same JavaScript realm as the preview's window.
The supervisor terminates a child before forwarding its result, so queued Promise jobs and timers
cannot survive an accepted invocation. If the parent's event loop is delayed, a completion check
retrieves the already-terminated worker's verified result or aborts unfinished execution; it never
re-runs user code or increases its execution budget. Disposal acknowledges only after terminating
both active and unused child workers. Transport delays must not be mistaken for source computation.

- At most eight functions, with unique IDs and names.
- Source: 128 KiB UTF-8; initial state: 256 KiB finite JSON.
- Inputs/outputs: at most 128 aliases each; emits/media: 64 each.
- Execution timeout: 16–1000 ms, default 250 ms.
- Promise/async results, accessors, cycles, sparse arrays, reserved object keys, and non-JSON values
  are not valid state/results. Keep updates compact and publish changed values only.

## Saving, capture, and export

Function definitions save with the `.ogs` source. Static authoring captures and thumbnails render
authored field defaults and tracks without executing Functions; they are not gameplay tests.
These captures sample native layers directly without instantiating the interactive runtime; the
editable source and real export retain Functions. Keep useful initial field defaults so these
stills communicate the design.

Version 1 supports **standalone realtime playback only**. Installing functions selects the realtime
project profile. Non-realtime and coordinated exports reject Functions explicitly; do not strip
them from exported packages to obtain a misleading pass. Standard custom actions remain the
external OGraf control interface. Test startup, input, state/data changes, pause/restart, blur, Out,
fault cleanup and audio in Studio and the actual realtime exported runtime before delivery.
Include embedded, fullscreen and detached Preview & Export: load a template while already detached,
then detach/dock back and reopen, checking actions and retained state in the current output window.
Also close the detached browser window while a Function is running. Owner-document shutdown must
invalidate pending work and pause owned media before its sandbox is disposed; returning the pane
to the editor resumes from committed state through blur, without treating disposal as a source
failure or automatically resuming gameplay. Genuine source errors must remain failed.
Inspect visible preview error messages as well as console logs; handled playback failures may
appear only in the pane while the last rendered game frame remains visible.
A supervisor connection error occurs during runtime startup, before the template function executes.
Diagnose the window handshake; do not weaken origin checks, increase execution limits or rewrite
the template to hide this fault.
