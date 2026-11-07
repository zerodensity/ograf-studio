# Animate In / Out

## Studio keyframe authoring

New UI-created objects use independent property animation and a static base pose at frame zero.
Global OGraf lifecycle markers remain playout cues; they do not preauthor matching property keys
that delay motion or return the object to its original pose. Existing legacy/authored tracks keep
their representation. The authoring-only `animationTrackMode:"independent"` is not an OGraf runtime
extension; compilation resolves static channels into ordinary constant tracks.

Properties has diamonds for X/Y/Width/Height/Rotation/Alpha. An explicit key always works with
Auto-keyframe off. **Edit → At playhead** records changes to enabled tracks at that frame; static
properties stay static unless Auto-keyframe starts their animation. **Whole animation** explicitly
offsets existing values without moving their times. Removing the final transform key freezes its
sampled value; reveal-only scale/clip tracks retain their neutral-value deletion behavior.

Timeline's editable **Current time** accepts seconds, milliseconds, frames and timecode. Plain
key selection seeks; modifier selection remains available. **Keys** and **Graph** are exclusive
views: selecting an animated channel replaces the keyframe rows with its **Graph**. **Keys** returns
to keyframe editing; **Graph** also opens the curve manually. Both views keep the shared ruler,
zoom, horizontal scroll, left channel navigator and right Keyframe editor. The graph shares Timeline's
frame origin, pixels per frame and beginning/end markers; it must not independently fit the time
axis. Graph drags use frozen SVG coordinates/bounds and commit one time/value edit on release.
With a numeric channel selected, right-click empty graph space for **Add keyframe here**. Click X
rounds to a whole frame within the timeline; click Y supplies the value with normal property limits.
Insertion selects the new key, keeps the playhead and is one undoable change. Locked objects and
frames already containing a key disable insertion; existing keys are never overwritten.
Right-click a graph point or nearby curve, or focus a key and press **Shift+F10** or the context-menu
key, then choose **Delete keyframe**. When no nearby point is found, a curve right-click targets a
single visible selected key; without a single valid target, Delete is disabled. The action does not
seek. Channel selection and **Graph**
remain active after deletion, including the last key; returning to **Keys** is explicit.
Authoring Play is continuous by default; **Stop at Steps** is optional playout
rehearsal and never changes OGraf lifecycle behavior.

These are editor interactions. MCP mutations keep their explicit contracts: use
`update_transform scope:"frame"` or `set_property_track` to author motion, and preserve deliberate
existing keys. Do not infer an MCP mutation's scope from Auto-keyframe or the browser's Edit scope.
Graph's last-key deletion is an editor interaction; MCP `remove_property_key` keeps its existing
minimum-one-key contract.

## Reset one animated channel

`reset_property_animation` clears only one property's main and local-loop tracks, freezing its
authored value sampled at the explicit frame. Other channels, loop settings/tracks, bindings,
Rules and layout modifiers are retained. It is one revision-checked, undoable operation:

```json
{ "type": "reset_property_animation", "layerName": "Rectangle", "property": "opacity", "frame": 50 }
```

The optional `loopElapsedFrames` supplies a held/custom-action loop phase; otherwise composition
lifecycle/Step activation determines the active phase. Virtual scale/wipe channels return to
neutral because they have no static layer field. Locked layers and resets of shared-lighting-owned
channels reject without mutation; unlink shared lighting first. Generated shader defaults follow
the frozen authored parameter, while ordinary data bindings and Rules keep their own ownership.

Studio samples an active editor loop's displayed phase, guarded against replaced source and
stale seeks; resetting one loop channel preserves the other channels' preview clock.
Studio exposes **Reset [channel] animation** in the selected channel editor, channel-name and
track/key context menus, and the Properties diamond menu (right-click or Shift+F10). Sampling uses
the current playhead, not the frame under a context click. Undo restores all affected channel keys.

## Entrance and exit presets

Use `set_layer_motion` for Studio's entrance/exit presets: Fade, Slide, Fly, Focus, Wipe, Scale,
Pop, Grow, Spin, and Drop. The operation bakes ordinary keys; the exported OGraf graphic needs no
preset runtime. Besides x/y/opacity/blur, styles write `scale` (Scale, Pop), the `clipLeft`,
`clipRight`, `clipTop` and `clipBottom` wipe insets (0–1, Wipe), width/height (Grow), or rotation
(Spin). Scale and the insets are track-only properties that exist once a layer has keys for them. At least
one Step is required. `side: "in"` writes between Start and the first Step; `side: "out"` writes
between the last Step and End. `durationFrames` must fit that window. The first/last Step's on-air
pose is retained. Reapplying replaces the selected side's keys; inspect for hand-authored motion
before doing so. `spec: null` clears that side to a cut/hold.

```json
{
  "type": "set_layer_motion",
  "layerName": "Headline",
  "side": "in",
  "spec": {
    "style": "slide",
    "direction": "left",
    "distance": 80,
    "durationFrames": 12,
    "easing": "cubic-out"
  }
}
```

`direction` is left/right/up/down for Slide and Fly, plus `center` for Wipe and Grow; Spin turns
`right` (clockwise, the default) or `left`. Fade, Focus, Scale, Pop and Drop take no direction.
`distance` is pixels for Slide. Focus needs the layer's built-in blur effect; Grow is not for text
because it would reflow. Incoming easing applies to the end key for In; outgoing easing applies to
the End key for Out. Defaults are cubic, except Pop (back-out/back-in) and Drop in (bounce-out).
The editor's feels are Smooth, Gentle, Snappy, Overshoot, Bounce, Elastic, and Linear; MCP accepts
the corresponding easing preset directly.

To stagger a group, give each layer its own `offsetFrames`: the motion finishes that many frames
before the first Step (In) or before End (Out), and the layer holds its pose for the rest of the
span. `durationFrames + offsetFrames` must fit the window. For a left-to-right cascade of three
layers with a 3-frame stagger, use 6, 3 and 0 from left to right. Use
`ograf_get_capabilities sections:["easing"]` for the current catalog and
`ograf_get_timeline`/`ograf_render_strip` to review the baked keys and motion.
