# Using OGraf Studio

[Back to overview](../README.md) · [AI authoring](AI_AUTHORING.md) · [Development](DEVELOPMENT.md)

## File types

| File                      | Purpose                             | How to open it                                                                                                  |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.ogs`                    | Editable OGraf Studio source        | **File → Open…**                                                                                                |
| Remote `.ogs` URL         | Public/CORS-enabled editable source | **File → Open from URL…**                                                                                       |
| `.ograf.zip`              | Certified playout package           | **File → Import OGraf package…** for best-effort editable conversion, or extract it for an OGraf player/devtool |
| Loose OGraf package files | Manifest, `main.js`, and resources  | Select them together with **File → Import OGraf package…**                                                      |
| SVG and raster images     | Reusable image assets               | **Add Image** at the top of **Layers**, or drop files onto the canvas                                           |
| Lottie `.json`            | Looping vector animation layer      | **Add Lottie JSON** at the top of **Layers**                                                                    |

An `.ogs` file is not an OGraf manifest and should not be opened directly in an OGraf playout
tool. A `.ograf.zip` is the deployable output, but arbitrary third-party JavaScript cannot always be
reconstructed as editable layers. The import report lists everything recovered, defaulted, or lost.

The Open dialog offers separate **OGS project files** (`*.ogs`), **JSON files** (`*.json`), and
**All files** (`*.*`) filters in browsers with native file picker support.
Opening remains backward-compatible with legacy `.ogeproj` and `.ogeproj.json` source files. New
browser downloads, picker saves, reference templates, and MCP saves use `.ogs` exclusively.

### Template thumbnails

**File → Save project…** (**Ctrl+S**) includes a thumbnail preview and frame selector. By default it uses the first
OGraf step of the main composition, or frame 0 when there are no steps. Enter another frame to
override it, or use the previous/next-frame buttons; the choice is stored in the `.ogs` file.
The preview keeps a fixed size while changing frames.

Save into a chosen folder to keep the source and thumbnail together: `Template Name.ogs` and
`<id>_thumb.png`, using the top-level project `id` from the saved JSON. Renaming the template does
not change its thumbnail filename. The PNG has a transparent canvas background, excludes editor guides,
and keeps the composition's proportions at up to 320 pixels on its longest edge (320 × 180 for 16:9).
Authored background
layers remain visible.

**Download ZIP** packages the same two files together. Browsers without folder access use this
option automatically; extract the archive before opening the `.ogs` source.

**Export .ograf.zip** opens a thumbnail preview and frame selector before exporting. Enter a frame,
use previous/next-frame buttons, or select **First OGraf step**. A successful export remembers the
choice for the template; cancelling leaves it unchanged. The ZIP includes `<id>_thumb.png` and
references it in the OGraf manifest's `thumbnails` list.

For DaVinci Resolve, choose the **Non-real-time** or **Dual** export profile: Resolve loads OGraf
graphics in non-real-time mode and cannot render a real-time-only package. Enable **Transparent
output** when the graphic should overlay video; an opaque composition background covers the full
frame. New compositions start transparent, shown as a checkerboard in the editor. Studio shows these
as non-blocking playout warnings because both configurations remain legal OGraf for other workflows.

### Remote project URLs

Use **File → Open from URL…** to download editable `.ogs` source from an absolute HTTP or HTTPS URL. OGraf
Studio sends no credentials, follows only HTTP(S) redirects, limits the response to 32 MiB, parses
and validates the source before loading, and asks before replacing the current project. The remote
server must allow browser CORS access.

A public GitHub repository is suitable storage. Use the raw-file URL, not the normal `/blob/` page:

```text
https://raw.githubusercontent.com/OWNER/REPOSITORY/main/path/project.ogs
```

Use a commit SHA instead of `main` when the URL must identify an immutable project revision. Public
repositories expose the complete `.ogs`, including embedded image/font data and field defaults;
do not store private content or credentials in them. Private GitHub raw URLs are not supported by
the credential-free browser loader, although a CORS-enabled time-limited signed URL can work.

### Adding and replacing images

Click **Add Image** at the top of **Layers** to choose files or pick a thumbnail from the template's
existing images. You can also drop image files directly onto the canvas. Each image becomes a
named layer at its original proportions; large images fit within 80% of the canvas and smaller
images retain their native size. Multiple files are added together with a slight offset.

Select an image layer to see its preview and **Replace image** near the top of Properties.
Replacement preserves the layer's size, position, animation, effects and bindings. Bound data can
still override the source during playback. **Source URL** remains available for linked images.
Resources → Images also offers **Add to canvas** on each expanded image.

Cancelling or failing an import leaves no empty layer. Undo restores the image and its resource
together. PNG, JPEG, WebP, GIF, AVIF and standalone SVG files are supported when the browser can
decode them; GIF timing retains the existing runtime behavior. SVGs with companion files use the
bundle workflow below.

### SVG and Photoshop exports

Use **Resources → Import Image/SVG Bundle** and select one SVG together with its companion CSS,
linked images, and local font files. OGraf Studio injects the CSS into the SVG, replaces selected
relative image/font URLs with data URIs, removes the external XML stylesheet reference, and
registers selected fonts as project font assets. Any unresolved relative URL is reported in the
Resources panel. The result remains one portable image asset; Photoshop's rasterized content and
arbitrary SVG structure are not decomposed into independently editable studio layers.

MCP clients can perform the same portable import through `ograf_import_svg_bundle`, or ingest one
workspace-confined file through `ograf_import_asset`. Both tools enforce file and aggregate payload
limits before committing one revision-checked asset transaction.

### Lottie animations

Use **Add Lottie JSON** at the top of **Layers**, or replace the JSON from a selected Lottie layer's
Properties. The first supported profile is intentionally deterministic and portable:

- the Bodymovin/Lottie JSON is embedded in the editable project and exported OGraf module;
- playback loops continuously, with an editable non-negative speed multiplier;
- editor scrubbing and non-realtime `goToTime()` derive the exact Lottie frame from composition
  time; realtime playback uses the same absolute-time frame calculation;
- `load()` predecodes embedded images and waits for fonts and the initial Canvas frame; failures
  return an error instead of allowing a blank graphic to pass as ready;
- a positive adapter-owned backing Canvas avoids zero-sized matte buffers and unsafe player resize
  calls. CSS reframes that backing when the layer box changes;
- nonzero source in-points are mapped to the player's relative frame API, and changed non-realtime
  seeks rebuild the player for byte-repeatable output;
- the self-hosted light canvas player is bundled into `main.js`, with no CDN dependency;
- expressions are disabled; external image/font paths, segmented documents, undecodable image
  payloads, and luma mattes are rejected. Export images inside the JSON as data URIs, use alpha
  mattes, or convert artwork to shapes/glyphs.

A small compatible animation is included at `examples/lottie/pulse.json`. Marker control, one-shot
playback, dynamic Lottie text/data binding and renderer selection are not supported. Test your
exported graphic in the intended playout environment.

### Chart.js charts

Choose **Add Chart** at the top of **Layers**, then select a type from the visual gallery that
opens there.
The gallery includes vertical, horizontal and stacked bars; line and area; pie and doughnut;
radar and polar-area charts. Resize the layer on the canvas. Set text color, legend and grid in
Properties, then edit series, rows, values and colors directly. **Advanced · edit JSON** handles
bulk edits or multiple series. Each dataset needs one numeric value per label and `#RRGGBB`
colors. **Add Data Binding** creates a text field containing this JSON so an
OGraf playout can replace chart values through ordinary data updates. Charts are rendered by
[Chart.js](https://www.chartjs.org/) in the editor and exported HTML renderer.

Use **Animation** in the chart's Properties to choose **Grow**, **Reveal**, **Fade** or **None**.
New charts use Grow. Set duration and start delay in frames; Grow's stagger delays consecutive items.
For example, a duration of 25 frames lasts one second in a 25 fps project. Choose easing to shape
the motion. **Replay on data update** replays the animation when playout sends changed chart data.
Timeline playback, scrubbing and OGraf preview use the same animation timing; native Studio
keyframes can also move or fade the whole layer.

### Procedural patterns

Choose **Resources → Patterns → Add pattern**, or the pattern tool at the top of **Layers**. Pick a
visual preset—Dots, Stripes, Chevrons, Diamonds, Checkerboard, or Monogram—and choose **Create
pattern**. Leave **Add to canvas** enabled to place it immediately, or disable it to keep a
reusable resource for later.

To start from your artwork, select rectangles, ellipses, or paths before opening the picker and
choose **Use selected shapes**. Their vector silhouettes become the repeating sequence; the
original objects remain unchanged. In the pattern editor, symbol previews let you replace a
shape, use a selected vector, or import an SVG silhouette. Text, images, and artwork with unsupported
SVG features need conversion to plain vector paths first. Source colors belong to the pattern
layer's fill, so imported symbols supply geometry rather than separate paints.

Adjust size, rows, spacing, row offset, and variation while watching the preview. **Shuffle**
changes the arrangement's seed. Enable **Animate**, choose a direction and loop duration in
seconds, and use **Play preview** to inspect motion without moving the main timeline. The
exported pattern moves while the graphic is on-air and keeps its seamless loop. Detailed SVG
source, per-row overrides, and shared lighting remain under **Advanced**.

Resources shows each pattern's preview and usage count. **Add to canvas** creates another linked
layer; **Duplicate** creates a separate resource. Editing shared symbols, layout, or motion updates
every linked instance. Each layer keeps its own fill, outline, transform, and effects. Choose
**Make independent** in a pattern layer's Properties to give it its own editable copy. Existing
patterns retain their original settings until you edit them or choose a preset.

### Blending effects

In **Properties → Effects stack**, new effects start in **Bypass**. Choose **Normal**, **Screen**,
**Add**, **Multiply**, **Overlay**, **Darken**, or **Lighten** to activate an effect. **Effect opacity**
sets how much its result contributes. Effects run top-to-bottom: each blends against the result
entering that effect, while the layer's blend mode still combines the completed layer with the
composition underneath. Glow and shadow blend only their generated contribution; blur and color
adjustments blend their processed image. Normal at 100% keeps the original effect behavior.

Select a complete persistent group to edit a **Group effects stack**. Entries added there are
shared by every group member, and edits, ordering, duplication, animation and removal stay
synchronized. Existing object-only effects remain independent and are hidden while the group stack
is being edited. The shared entries are materialized onto ordinary OGraf layers, so exported
packages do not require a proprietary group-effects runtime.

**Shader** adds a true WebGL 2 post-process pass. Its `iChannel0` is the layer result after every
preceding stack entry; the Shader output is blended by that entry's Blend and Effect opacity, then
passed to later effects. Expand the effect to edit or load its `mainImage` source and exposed
controls. The effect cannot attach a separate `inputImage`, because `iChannel0` is reserved for the
incoming stack image.

Bypass retains settings and animation. When all effects are bypassed, the object uses its ordinary
rendering path without effect passes. Existing projects keep their enabled effects and appearance.
Effect parameters remain animatable; blend mode and effect opacity are static settings.

### Sound Events

**Resources → Audio** contains imported MP3/WAV/OGG sound effects. Drag an audio file onto any
frame of the Timeline ruler to create a small speaker marker, or choose **Add at Playhead**. Use
**Play** beside an imported file to audition it; starting another preview stops the previous one.
Playback
crossing the marker plays the sound once. Drag the marker horizontally to retime it; select it to
edit the audio file, exact frame, volume, start offset and retrigger behavior. Multiple sounds may
share one frame and appear as stacked markers. Sound Events create neither canvas layers nor audio
tracks. A sound fires when playback enters its marker frame; leaving that Step with **Take Out**
does not replay it. Starting a new IN after OUT arms the Sound Events again.

For action-triggered audio, expand the imported file and choose **Create Playback Cue** instead of
**Add at Playhead**. The cue appears under Resources → Media with a Manual trigger. Expand it,
change **Trigger type** to **Custom Action**, and select the action ID. Preview & Export exposes a
button for each Custom Action so the audio can be tested directly.

### Media Cues

**Resources → Media** contains advanced audio/video playback cues and renderer-provided live
inputs. Choose **Create Cue at Keyframe** on an imported video, or **Create Playback Cue** on an
imported audio file. Video cues default to the active lifecycle keyframe; advanced audio cues start
as Manual so they remain distinct from timeline Sound Events. Expand a cue under Resources → Media
to change its source, trigger, trim and playback settings. Media Cues do not create
Audio/Video Timeline rows or canvas objects. For video, expand the cue and choose a paintable layer
under **Video target**; Cover,
Contain, Stretch and focal position remain visual-only settings on that target.

Every cue shares one transport editor: named clip/live sources, trigger type, trim in/out, loop,
speed, volume, mute and retrigger behavior. Source and trimmed durations appear in the editor.
Triggers can start at a Timeline frame, an OGraf
lifecycle state, a Custom Action, or manually during authoring. Custom Action payloads may select a
named source before triggering the cue.

Use **+ Live Cue** for renderer-owned sources such as `camera.program`. Source changes support Cut or
Crossfade, an audio transition policy, and Keep current, Use fallback, or Transparency/silence when
the incoming source fails. Clip-to-clip, clip-to-live and live-to-clip changes prepare an incoming
slot while the outgoing source remains active.

For local testing, set a Live tag on a Media fill or a live Media Cue and choose **Start webcam**
beside it. Studio asks for camera permission then uses the selected camera's muted video for that
tag on the canvas and in OGraf Preview. **Stop live webcam** releases the camera when no other
preview uses it. You can switch cameras after permission has been granted. Webcam selection and
footage are preview-only:
they are not saved in `.ogs` or exported. The exported graphic still requires its renderer to
provide the live tag. A fallback image remains available when no source is provided.

For a live video bed behind the graphic, choose **Webcam · local preview** in **Canvas Layout →
Presentation background**, then press **Start webcam**. This editor-only background appears on the
main canvas when **Transparent output** is enabled; it is not painted into OGraf Preview or export.
The background and a live Media source may share one local camera without stopping one another.
Changing the presentation background away from Webcam stops its use of the camera.

Media Cues are real-time-only in the initial profile. Disable **Non-real-time** and export with the
**Real-time** profile. Live output uses the `zd-ograf-media` version 1 renderer hook. Test target
codec support, browser autoplay policy, live-source readiness and audio routing on the intended
playout system.

### Automatic layout

Assign child layers to a parent with **Properties → Layout relationships → Parent**, then enable
**Auto layout** on the parent. Horizontal and Vertical flow arrange direct children in paint order
with an authored gap, four-sided padding, cross-axis alignment, optional stretching, and hidden-item
collapse. **Hug width** and **Hug height** resize the parent around its participating children;
minimum and maximum width clamp a text-following background. Auto-size text uses its measured
bound content, so a longer live name moves following siblings and grows the parent without scripting. The
same deterministic solver runs on the Studio canvas and in exported realtime and non-realtime
playback; nested Auto layout containers move with their descendants.

### Visual rules

Open the dockable **Rules** pane from the Window menu to edit ordered rules across the composition;
optionally filter to the selected object, which also lists rules on other objects that change it.
Its default undocked width is 800 px; a saved custom width is preserved. If the composition has no
Data fields, **+ Add Rule** creates a text condition field automatically; enter its value in the
Data pane or through playout data to activate the new rule.

**Conditions.** A data condition compares a field with a value or, through the **value** menu, with
another field — for example _Home score_ **Greater than** _Away score_. Operators cover equality,
numeric comparison (**Greater than**, **At least**, **Less than**, **At most**, **Between**), text
(**Contains**, **Starts with**, **Ends with**, **Is one of** a comma-separated list), emptiness, and
**Changed** / **Increased** / **Decreased**. Equality treats `5` and `"5"`, and `true` and `"true"`,
as the same value; **Aa** makes text comparisons ignore letter case. **+ and / or** adds more
conditions, combined with **and** or **or**. Inside a runtime collection prototype, a condition on
the collection's field reads that row's own item, so each row can colour itself.

**Triggers.** Beside **Data condition**, a rule can start from the pointer — **While hovered**,
**Clicked**, **Double-clicked**, **Mouse over**, **Mouse leave** — or from playout: **Played in**
(the first step is reached), **Step reached** (a chosen step or any step), **Taken out**, or
**Custom action ran**. On these triggers, **+ condition** adds an _only if_ guard, and **after N fr**
delays the actions.

**Actions.** A rule can show, hide or (on event triggers) toggle an object; set bindable visual,
effect or exposed shader properties; trigger a custom action or shader-animation action; play a
Sound Event; or start an audio/video/live Media Cue. Show/hide/toggle and property actions change
the rule's own object by default; choose another object in the target menu to build tabs,
reveal panels, or winner highlights. **fade N fr** fades visibility and **over N fr** animates
numeric and colour property values instead of switching them.

**State and events.** Data-condition and **While hovered** rules are states: their results hold
while the condition holds and revert when it stops, so a hover highlight needs one rule. Every other
trigger, and conditions that watch for a change, are events: their results stay until a later rule
replaces them. When a state rule starts matching, it takes back the properties and visibility an
earlier event set on the same object. Rules run after ordinary bindings, in authored order; when
two matching state rules set the same property on one object, the later one wins and the earlier
card shows **Overridden**. Hidden rule results participate in Auto layout's **Collapse hidden**
spacing.

**Trying rules.** Data-condition cards show **Matched** or **Not matched** for the current test
values. Event rule cards have **▶**, which applies their show/hide and property actions to the
editing canvas; **Reset test** clears those results. Pointer rules run in the OGraf Preview and
exported real-time HTML graphic, where click/tap uses the object's rectangular bounds and hover
applies to mouse or pen; Studio's editing canvas keeps clicks for selecting and editing. If both
click and double-click rules exist on the same object, a single-click action waits briefly so a
double-click fires only the double-click rule. Playout triggers, delays, and transitions also replay
exactly in non-real-time scheduled rendering; pointer events do not, so use a playout custom action
for a deterministic or remote trigger.

### Data connections

Use **Data → Connections** to preview a template from JSON or CSV without changing its OGraf
field contract. A connection can fetch an HTTP/HTTPS URL with optional polling or use pasted/imported
JSON/CSV. Map each Studio field to a dot-separated JSON path or CSV column, choose default, empty, or
keep-last handling for missing values, then select **Refresh now**. Status and failures stay visible
in the panel. Connections are editor-side preview configuration; exported packages continue to
receive ordinary GDD data from the playout system.

### Rankings and paged collections

**Data → Repeating lists** can identify items by a stable nested key, sort by a nested value ascending or
descending, and expose one zero-based page at a time. Set Page size to zero to use the authored
**Max items**. Bindings resolve back to the original array item after sorting, and stable keyed items
animate from their previous slot when rankings change. **Max items** still bounds generated DOM and is
mirrored to the array field's `maxItems`.

### Preserved design resizing

Convert a rectangle or ellipse with **Edit as path**, then enable **Preserve design** in its Path
properties. Fixed left, right, top, and bottom source regions render as a nine-slice grid: corners
retain both dimensions, edges stretch along one axis, and only the center stretches freely. This
keeps angled bar ends, borders, and corner treatments unchanged as the layer grows. The initial
profile supports solid path fills; complex paints continue to use ordinary scaling and produce a
validation warning.

### Designed data update transitions

Set the composition's **Data change fade** duration and **Data arrives mid-fade** policy, then choose
a per-layer style under **Properties → Advanced → Data change transition**. Bound layers can crossfade, slide in
one of four directions, inherit the composition duration, override it, or update instantly. Unbound
backgrounds remain on screen. **Finish current fade first** finishes each transition in order;
**Jump to newest data** cancels the older visual transition and applies the newest update. Exported action durations report
the longest authored layer update so playout can schedule accurately.

### Fit animation duration

Use the Timeline's **Length** controls to set **In**, **On air**, **Out**, or the **Whole graphic**
to an exact frame count, then choose **Set length**. Property keys inside the selected phase scale proportionally, preserving
stagger relationships. Later keys shift by the exact duration delta so untouched phases keep their
authored lengths. Layer-local loop clips use their own ruler and are not stretched.

### Motion paths

Select a layer, choose an editable Path under **Layout relationships → Motion path**, and set Path
progress from 0 to 1. The target follows the path's arc length, can rotate to the tangent, and keeps
independent X/Y offsets. Motion Path Progress appears as a normal animatable property. Choose **Add
ping-pong loop** for a ready-made 0→1→0 lifecycle loop, then edit its keys and duration normally.
Moving, scaling, or rotating the source path updates the attachment deterministically.

### Animate In / Out

Select one or more layers and open **Properties → Animate In / Out**. Choose Fade, Slide, Fly, or
Focus independently for entrance and exit; Slide and Fly offer four directions. Set the duration in
frames and a feel (Smooth, Gentle, Snappy, Overshoot, or Linear), then use ▶ to preview that side.
Focus requires the layer's built-in blur effect. The editor writes ordinary x/y, opacity, and blur
keys between Start and the first Step, or the last Step and End. These keys remain editable on the
Timeline; choosing another preset replaces only that side's motion. **None (cut)** holds the on-air
pose, while **Custom keys** warns that choosing a preset would replace hand-authored keys there.

### Animation graph editor

Select a numeric property track in Timeline to open its value-over-time graph. The curve samples the
same easing and custom Bézier data used by playback. Drag a graph key horizontally to change its
frame and vertically to change its value; Control/Command-click adds keys to the existing selection.
The selected incoming segment keeps the detailed Bézier-handle editor and numeric controls below.

### Mixed text styles and languages

Text properties provide Automatic, Left-to-right, and Right-to-left base direction plus a BCP 47
language tag for browser shaping and accessibility. **Enable mixed styles** divides authored text
into ordered editable runs; each run can override color, weight, italics, and font family while the
layer retains one transform, outline, animation, and data identity. A content binding preserves
styled runs while its value matches the authored text. New operator text replaces them with plain
text to avoid applying stale character ranges.

### Text animation presets

Select a text layer and open the separate **Animation** section below **Text** in Properties. Choose
**Typewriter**, **Fade in**, **Rise in**, **Pop in**, or **Word reveal**. Typewriter reveals letters or
words in steps and can draw a blinking bar or block cursor. Fade in changes each segment's opacity;
Rise in moves it upward while fading; Pop in grows it with a small overshoot; Word reveal slides each
word upward through its own mask. The first four presets can split by Unicode-safe Characters or
Words. Word reveal always splits by words.

Set a fixed frame duration for any preset. For Typewriter, **Typing speed** converts the current
sample text into a fixed duration. Timeline scrubbing and non-real-time OGraf seeking sample these
effects from the same frame clock. The full text stays measured while it animates, so auto-size and
wrapping do not jump between segments.

The first animation starts at frame 0. Keep its duration within the IN transition when the full text
must be visible at the first OGraf Step. **Replay on update** restarts it when `updateAction`
changes the field bound to Content. **Replay action** links an existing Data → Custom Action so a
playout can restart the effect without changing the lifecycle step.

### Shader fills

Choose **Shader** in an object's **Fill** selector to render a self-contained GLSL `mainImage`
pass in WebGL 2. Shapes, text, images, image sequences, Lottie, and tiled patterns support shader
fills. The shader follows the object's shape or source alpha, including animated silhouettes;
its output alpha preserves transparency. For a full-screen background or rain overlay, use a
rectangle sized to the composition. Existing shader layers open as rectangles with shader fills.

Edit the source and its declared controls in Properties. Shaders use composition time for
repeatable scrubbing and OGraf `goToTime()` seeking. For media, choose **Original pixels** to
remove the shader fill. Shader fills replace visible color; they do not filter source pixels.

Text also has an independent **Outline** paint selector. Choose **Shader** there and set **Stroke
Width** to animate its border separately from the fill. The object remains editable text: changes
to Content, font, sizing, or alignment update both paints. Solid and shader paints can be mixed.

**Resources → Shaders** lists saved project shaders. Shader paints already applied to object
fills and text outlines are edited on that object's **Properties** panel instead of appearing as
duplicate resources. **New Shader** opens a draft without adding a canvas object.
Choose **Save shader** to keep it in the project, then drag it onto Fill or Outline when needed;
**Cancel** discards the new draft. Unused project shaders are retained in editable `.ogs` files.
Each saved entry has a thumbnail, **Edit**, **Load**, and a remove icon. The editor has an
editable shader name and a larger animated preview. Changes stay in the window until **Save
shader**; **Cancel** discards them. **Preview shader** tests source changes in the preview, and
loading a file opens a draft. Entries are independent, even when their source is identical. Edits
preserve compatible parameter values and keep the current canvas selection.
Drag a shader entry from Resources onto an object's **Fill** or text **Outline** row to apply a
copy of its current source, settings, name, and controls. The destination highlights while dragging;
the original shader stays independent.
Removing a saved project shader keeps copies already applied to objects. To detach an applied
shader, choose Solid or Original pixels from the object's Fill or Outline control in Properties.
Text returns to its solid fill or outline color, shapes use the selected solid fill, and media shows
its original pixels. Use **Undo** to restore a change.

Mark literal global constants to create editable controls and OGraf data fields automatically:

```glsl
#pragma ograf intensity slider min(0) max(2) step(0.1)
const float intensity = 0.5;
#pragma ograf tint color
const vec3 tint = vec3(0.1, 0.3, 0.6);
#pragma ograf enabled toggle
const bool enabled = true;
#pragma ograf offset vector2 min(-1) max(1) step(0.01)
const vec2 offset = vec2(0.0);

void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord / iResolution.xy + offset;
  float wave = 0.5 + 0.5 * sin(uv.x * 8.0 - iTime);
  color = vec4(tint * intensity * wave, enabled ? 1.0 : 0.0);
}
```

`slider` supports `float` and `int`, `color` supports `vec3` and `vec4`, `toggle` supports `bool`,
and `vector2` supports `vec2`. Literal object-like `#define` constants are also accepted. The
optional `min(...)`, `max(...)`, and `step(...)` annotations set numeric control limits. Marked
symbols must be read-only; expressions, conditional declarations, and values needed as compile-time
constants are rejected when they cannot safely become uniforms.

Every marked symbol gets a normal field in **Data** and a `fill.parameters.NAME` binding. Colors use
hexadecimal RGB/RGBA strings in OGraf data; vectors use `{ "x": 0, "y": 0 }`. Control edits and
field defaults stay synchronized. Field keys and labels may be renamed; change the source pragma
to change a field's type, limits, or presence. Duplicated objects get independent shader fields.
Changing to Shader detaches incompatible whole-fill and gradient-stop bindings while keeping
their data fields and Brand Kit tokens available.
Text outline parameters use `strokePaint.parameters.NAME` and independent fields, so the same
parameter name can appear in both shaders without sharing its value.

Exposed shader controls can also own keyframes and local loops. Expand the object in **Timeline**,
enable **Auto-keyframe**, and use **+ Property → Fill shader** or **Outline shader** to choose a
control. Move the playhead and adjust the control in Properties, or edit a selected key's **Value**
in the Keyframe editor. With Auto-keyframe off, changing a keyed control offsets its existing keys.
Select a property and use its **Loop** section to set repeating values and preview the loop.

Float controls use the usual easing and curves. Integers and toggles hold their values until the
next key; vectors use X/Y tracks and colors use R/G/B/A tracks. Keys follow the limits declared in
the shader. Keyed channels take precedence over data-bound values while their tracks are active;
unkeyed channels remain data-driven. Removing the final key returns that channel to its authored/data value. The shader's
`iTime` clock continues independently. Animation belongs to the object, not a saved library shader.
Keep exposed names stable: removing declarations or shader paints removes their matching tracks.

The original source and values are saved in `.ogs` and compiled packages. Under **Rendering**, an
embedded PNG or JPEG can be assigned as a portable static **Image input**. Shadertoy Image code
samples it as `sampler2D iChannel0`; `iChannelResolution[0]` reports its pixel dimensions. Repeat or
Clamp wrapping and Linear or Nearest filtering are authored with the shader. The supported profile
also provides `iTime` and `iResolution`. Additional channels, video, buffer/feedback passes, audio
inputs, mouse inputs, and custom uniform declarations are unsupported. Shadertoy Image passes that
fit this profile can be adapted; check their individual licences. Export certification checks rendering
and repeated seeks, but the destination player must still support WebGL 2. Shader-filled objects
can use geometric masks, but cannot currently supply an alpha mask for another object.

## Editing and animation

Add layers with the buttons at the top of **Layers**: rectangle, ellipse, chart, text, image,
path, procedural pattern, image sequence, and Lottie. **+ Recipe…**, at the left of the bar under
the canvas, inserts a ready-made lower third, bug, ticker, scoreboard, or clock.

The bar under the canvas sets the zoom: **−** and **+**, a menu of presets, **Fit**
(**Shift+1**) to frame the whole composition again, and **100%** (**Shift+0**).

The camera button in that bar saves the current frame as a PNG at composition size: with alpha,
on a checkerboard, on black, or as a **Fill + Key** pair (the frame on black plus its alpha as
greyscale).

**K**, the button or the key, shows the key: the alpha channel as greyscale on black. It only
changes the view and is never saved.

**Properties** lists what most layers need first: Alignment, Transform, Animate In / Out, the
layer's content, Data Bindings, Effects, and a summary of its Visual rules with **Open Rules**. Brand
tokens, compositing and masks, layout relationships, data change transitions, and semantic intent
sit under **Advanced**; typing in **Filter properties…** still finds them. The built-in blur and
drop shadow stay out of the Effects list while they are off; **Show built-in…** lists them.

**Properties → Alignment** lines up the selection. **Align to** chooses the shared bounds of the
selected layers (**Selection**) or the whole composition (**Canvas**); a single layer always
aligns to the canvas, so the centre buttons put it in the middle of the screen. **Distribute**
spaces three or more layers evenly, **Order** moves them back or forward, and **Group** keeps them
together.

**Properties → Repeat** turns the selection into a row or column of copies, each with its own data
fields (Item 1, Item 2…) for playout. Set the total **Copies**, the **Direction**, and the **Gap**;
while the pointer is over the section, dashed outlines show where the copies will land. **Create
repeater** adds them as ordinary grouped layers.

**Properties → Animate In / Out** gives a selected layer an entrance and an exit without editing
keys. Choose **Fade**, **Slide** (a short move with a fade, 80 px by default), **Fly** (from or to
beyond the canvas edge), or **Focus** (a fade out of blur), pick a direction with the arrows, and
set the duration and feel (**Smooth**, **Gentle**, **Snappy**, **Overshoot**, **Linear**). The
entrance plays between Start and the first Step, and the exit between the last Step and End;
duration can't exceed that span, so lengthen it on the timeline if you need more. **▶** plays the
entrance or exit on the canvas. The choice applies to every selected unlocked layer and becomes
ordinary keys, so exports and other tools see plain animation. It replaces only this layer's x, y,
opacity, and blur keys inside that span; **Custom keys** marks a span with keys you made yourself,
and choosing a style replaces them. **None (cut)** keeps the layer at its on-air pose. Focus needs
the layer's built-in blur effect.

AI proposals appear on the main canvas. Review frames and compare the original, then use
**Accept changes** or **Reject** in **AI Assistant**. Acceptance creates one undoable history entry.

**Stop at Steps** is enabled by default in the timeline. Uncheck it for continuous playback.
With the timeline focused, **Space** toggles play/pause and **Left/Right Arrow** steps one frame.
Enable **Auto-keyframe** beside **Stop at Steps** to create timeline keys and steps, including
double-click inserts, property tracks, context-menu inserts, and loop keys. It is off by default
and resets when opening or creating a project. Existing keys can still be selected and edited.
When off, position, size, rotation, opacity, gradient-stop, stroke-width, and effect edits apply
across existing keys without inserting a key at the playhead. Static objects stay static; existing
motion is offset rather than replaced. Enable it to make frame-specific edits.

For vector points and handles, see the [path-editing guide](../skills/ograf-authoring/references/path-editing.md).
Clicking blank canvas keeps path editing active. Choose **Done** or press **Escape** to finish.
For recent changes, see the [release notes](releases/0.21.md).

To let playout change a text or image layer, turn on **Properties → Editable in playout**. Studio
creates a data field named after the layer, starting with its current text or image, and binds it,
so the graphic doesn't change until playout sends a value. Turning it off removes the binding and
the field, unless another layer or rule still uses it.

The **Data** pane has tabs: **Fields** (with Test Data), **Lists** (repeating lists), **Actions**
(custom actions), **Connections**, and **Schema** (what playout sees). Counts show what each holds.

Manage a selected layer's data links under **Properties → Data Bindings**. Binding indicators are
not drawn over the canvas artwork. **+ Add Binding** creates a new data field for the next unbound
property and binds it immediately, even when the project has no fields yet. The new field starts
with that property's current value, so adding the binding does not change the graphic. Choose a
different existing field in the binding's **Field** menu if you want to reuse one, or open **Data**
to rename and edit the new field.

Bound controls remain editable in Properties. Designer edits update the bound field's default
without removing its data link; a mapped control updates the active option's mapping instead.
Double-click text on the canvas to edit it directly, including nested and mapped bindings. These
edits are saved and undoable. An edited test-data leaf returns to its authored default while
unrelated preview values remain available. Playout can still override the values at runtime.

## Menus and shortcuts

**Edit** has Undo, Redo, Cut, Copy, Paste, Duplicate, Delete, Group or Ungroup, Select all, and
Deselect all, with the same shortcuts on the canvas (**Ctrl+X/C/V**, **Ctrl+G**,
**Ctrl+Shift+G**). Text fields keep their own copy, paste, and undo. **File** holds New project,
Open… (**Ctrl+O**), Open from URL…, Import OGraf package…, Save project… (**Ctrl+S**), and Preview
& Export… (**Ctrl+E**); on macOS use **Cmd**. Once a menu is open, pointing at another menu opens
it instead. **Window → Reset layout** puts docked panes back where Studio
first placed them. **Help** lists every keyboard shortcut, links to this guide, and shows the
version.

## Fullscreen preview

**Preview & Export** plays the exported graphic the way playout does: **Take In ▶** plays it in,
**Next ⏭** continues to the next Step (or out after the last one), **⏮ Back** returns one Step,
and **Take Out** plays it out. **Live** plays in real time; **Rendered** steps through time exactly,
like a video renderer. The raw OGraf call log and the scheduled-action tester are under
**Developer**; the log's heading shows **error** when a call fails.

In **Preview & Export**, choose **Fullscreen** to fill the current display with the graphic.
To use another monitor, first open the pane in a new window and move that window to the display.
The detached window's **Fullscreen** button opens the same presentation view.

Use **Space** or **Right Arrow** for the next OGraf step and **Left Arrow** for the previous step.
These keys also work when the preview image has keyboard focus. **Escape** exits fullscreen and
restores the controls without restarting the graphic. Fullscreen fits the composition to the
display while preserving its proportions, with black margins where needed.

## Compatibility notes

- Importing arbitrary third-party OGraf packages is best-effort; opaque JavaScript cannot always
  be recovered as editable layers.
- Package font assets when consistent typography across computers matters. Embedded project fonts stay active even when Resources is closed, and are included in captures, review images, contact sheets, and saved/exported thumbnails. Detached windows register their own copies.
- Refreshing a linked component replaces its local content/style edits. Use independent instances
  when those edits must be retained.
- Runtime collections have explicit capacity and truncate overflow. Validate representative data
  and test the exported package with your target player.
- Large embedded assets can exhaust browser storage. Save editable source regularly.
- Browser certification and visual captures require a responsive Studio window.
