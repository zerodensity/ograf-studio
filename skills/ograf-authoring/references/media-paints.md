# Media Cues

## Sound Events

Audio authoring uses simple composition-level Sound Events. Import MP3/WAV/OGG under Resources →
Audio, audition files with **Play**, then drag the chosen asset onto any Timeline ruler frame or
choose **Add at Playhead**. Starting another resource preview stops the previous one. The editor
shows a small speaker marker, not an audio layer or track. Drag to retime; the compact editor exposes
only file, frame, volume, start offset and retrigger behavior. Internally these compile through the
real-time media transport. Choose **Create Playback Cue** on an audio resource when Custom Action,
manual triggering, named sources, or transition controls are required instead.
They are edge-triggered one-shots: entering a marker plays once, Take Out never replays the current
Step's sound, and a new IN after OUT rearms all markers.

## Advanced audio, video and live Media Cues

Media Cue is the composition-level playback contract for audio/video clips and renderer-provided
live sources. It is not a canvas object or Audio/Video Timeline row. Audio stays nonvisual. A video/live cue
may select one paintable target layer; compilation materializes the active cue source as that
layer's moving-image fill while keeping playback controls on the cue.

Create a cue with `add_media_cue`, edit it with `update_media_cue`, and delete it with
`remove_media_cue`. Import audio/video files once with `ograf_import_asset` and reference them as
`asset:<id>` clip sources.

```json
{
  "name": "Match Media",
  "sources": [
    {
      "id": "intro",
      "name": "Intro",
      "kind": "clip",
      "mediaType": "video",
      "src": "asset:clip-id"
    },
    {
      "id": "program",
      "name": "Program Live",
      "kind": "live",
      "tag": "camera.program",
      "fallback": "asset:poster-id"
    }
  ],
  "activeSourceId": "intro",
  "trigger": { "type": "customAction", "actionId": "match-media.take" },
  "trimStartMs": 0,
  "trimEndMs": null,
  "durationFrames": null,
  "loop": true,
  "speed": 1,
  "volume": 1,
  "muted": false,
  "retrigger": "restart",
  "transition": {
    "type": "crossfade",
    "durationFrames": 12,
    "audio": "follow-picture",
    "onFailure": "keep-current"
  },
  "visual": {
    "targetLayerId": "video-rectangle-id",
    "fit": "cover",
    "positionX": 0.5,
    "positionY": 0.5
  }
}
```

Triggers are `timeline`, `lifecycle`, `customAction`, or `manual`. A Custom Action payload may
select a source by stable id or authored name before playback:

```json
{ "source": "program" }
```

Media Cues are edited under Resources → Media. Video/live cues created in Studio default to the
active lifecycle keyframe. **Create Playback Cue** on an audio resource creates a Manual cue so it
does not become a timeline Sound Event; change its trigger to Custom Action and select the action.
Imported media records decoded
source duration; trim in/out and speed derive automatic playback length, while `durationFrames`
overrides it. No thumbnail or waveform is required.

Source transitions support cut and crossfade. Crossfade double-buffers clip audio/video and fades a
captured outgoing video frame after the incoming source is ready. Failure policy is keep-current,
fallback, or transparency/silence. Retrigger policy is restart, resume, or ignore while playing.

Resources → Media combines MP4/WebM and advanced MP3/WAV/OGG cues. **Create Cue at Keyframe** on
video and **Create Playback Cue** on audio create cues without Timeline rows or canvas geometry.
**+ Live Cue** creates a renderer source. Live inputs use the `zd-ograf-media`
version 1 hook; manifests declare `ZeroDensityHTML >= 1.0`. Remote URLs require public internet/CORS.
Media Cues are real-time-only in the initial profile, so use realtime certification/export.

Verify audio in embedded, fullscreen and detached previews, including clips first triggered after
detaching and clips moved back into the editor. Check advancing `currentTime`, volume/mute,
pause/resume, one-shot completion and resource release on Out. Keep browser autoplay restrictions
and explicit playback gestures intact. Runtime-owned audio/video players must retain their type
through document adoption; do not use another window's DOM constructor as the only type check.

Studio can supply muted webcam video for a live tag on the canvas and in OGraf Preview. Start it
explicitly beside the tag in Media fill or Media Cue controls; permission, device choice, settings
and frames stay local and never enter `.ogs` or exported packages. Canvas Layout also offers an editor-only
Webcam presentation background behind transparent artwork. Both previews can share one camera but
stop independently. Exported live tags still depend on the target renderer's source hook.

Camera Settings is beside Start webcam in both locations. Opening settings never starts capture
or requests permission. Save settings before Start retains requested resolution/FPS in session memory;
Start webcam remains the explicit capture/permission action. During capture, Apply constrains the
existing shared track, so live tags and the presentation background change together. Report actual
track resolution/FPS separately from requested values; camera/browser negotiation may differ.
A shared or busy camera may prevent switching to a larger capture format. Keep requested capture
values as preferences and display the delivered actual values; do not restart capture automatically
or claim the requested resolution was reached without readback.

Native Apply serializes resolution/FPS constraints first and image-control constraints second on
the same track. Keep both phases in one settings transaction; do not replace them with one mixed
constraint request. Read actual output with `getSettings()` after the phases; `getConstraints()`
describes requests and does not prove capture dimensions, FPS or image-control results. If a later
phase fails, attempt to restore the prior capture and image settings, keep the existing stream,
and report the final actual values plus any rollback failure. Guard each phase against a stopped
or switched track so old requests cannot affect the current camera session.

Only advertise image controls actually reported by the camera/browser, with their native ranges
and modes. Exposure time, focus distance and color temperature require the matching manual mode
when its mode control is available. With no capability API, retain basic resolution/FPS preferences
and actual readback without inventing image controls. A rejected change must keep the active stream,
last accepted preferences and visible actual values, with a useful error. Stop/device switches
invalidate stale results. Reset clears requested resolution/FPS and restores readable image values
captured at the current stream's start; it is not a factory reset. Camera switches keep resolution/FPS
preferences and clear camera-specific image preferences.

Use `ograf_get_capabilities` with `sections:["elements"]` for Live tag camera guidance, or
`sections:["editor"]` for presentation-background guidance. These describe Studio UI support, not
the connected camera's capabilities. No MCP tool activates or configures cameras. Do not put camera
preferences, device IDs or captured frames into project operations, saved `.ogs` files, export
manifests or packages; local webcam settings do not replace the renderer's live source integration.

There is intentionally no conversion from the unreleased experimental Audio element or Media-paint
prototype into Media Cues.
