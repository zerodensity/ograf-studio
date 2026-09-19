# Using OGraf Studio

[Back to overview](../README.md) · [AI authoring](AI_AUTHORING.md) · [Development](DEVELOPMENT.md)

## File types

| File                      | Purpose                             | How to open it                                                                                  |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.ogs`                    | Editable OGraf Studio source        | **Open Project**                                                                                |
| Remote `.ogs` URL         | Public/CORS-enabled editable source | **Open URL**                                                                                    |
| `.ograf.zip`              | Certified playout package           | **Import OGraf** for best-effort editable conversion, or extract it for an OGraf player/devtool |
| Loose OGraf package files | Manifest, `main.js`, and resources  | Select them together with **Import OGraf**                                                      |
| SVG and raster images     | Reusable image assets               | **Add Image** above the canvas, or drop files onto the canvas                                   |
| Lottie `.json`            | Looping vector animation layer      | **+ Lottie JSON** above the canvas                                                              |

An `.ogs` file is not an OGraf manifest and should not be opened directly in an OGraf playout
tool. A `.ograf.zip` is the deployable output, but arbitrary third-party JavaScript cannot always be
reconstructed as editable layers. The import report lists everything recovered, defaulted, or lost.

The Open dialog offers separate **OGS project files** (`*.ogs`), **JSON files** (`*.json`), and
**All files** (`*.*`) filters in browsers with native file picker support.
Opening remains backward-compatible with legacy `.ogeproj` and `.ogeproj.json` source files. New
browser downloads, picker saves, reference templates, and MCP saves use `.ogs` exclusively.

### Template thumbnails

**Save Project** includes a thumbnail preview and frame selector. By default it uses the first
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

### Remote project URLs

Use **Open URL** to download editable `.ogs` source from an absolute HTTP or HTTPS URL. OGraf
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

Click **Add Image** above the canvas to choose files or pick a thumbnail from the template's
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

Use **+ Lottie JSON** above the canvas, or replace the JSON from a selected Lottie layer's
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

**Resources → Shaders** lists saved project shaders and the project's fill and outline shaders,
including saved component definitions. **New Shader** opens a draft without adding a canvas object.
Choose **Save shader** to keep it in the project, then drag it onto Fill or Outline when needed;
**Cancel** discards the new draft. Unused project shaders are retained in editable `.ogs` files.
Each entry has a thumbnail, **Edit**, **Load**, and a remove icon. The editor has an
editable shader name and a larger animated preview. Changes stay in the window until **Save
shader**; **Cancel** discards them. **Preview shader** tests source changes in the preview, and
loading a file opens a draft. Entries are independent, even when their source is identical. Edits
preserve compatible parameter values and keep the current canvas selection.
Drag a shader entry from Resources onto an object's **Fill** or text **Outline** row to apply a
copy of its current source, settings, name, and controls. The destination highlights while dragging;
the original shader stays independent.
Removing a saved project shader keeps copies already applied to objects. For an object usage,
the trash icon (**Remove shader**) detaches the selected usage without deleting its object. Text returns to its
solid fill or outline color, shapes use the default solid fill, and media shows its original pixels.
Only that usage's shader bindings and unused generated controls are removed. Use **Undo** to restore it.

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

The original source and values are saved in `.ogs` and compiled packages. The supported profile
provides `iTime` and `iResolution`; texture channels, buffer/feedback passes, audio inputs, mouse
inputs, and custom uniform declarations are unsupported. Shadertoy Image passes that fit this
profile can be adapted; check their individual licences. Export certification checks rendering
and repeated seeks, but the destination player must still support WebGL 2. Shader-filled objects
can use geometric masks, but cannot currently supply an alpha mask for another object.

## Editing and animation

AI proposals appear on the main canvas. Review frames and compare the original, then use
**Accept changes** or **Reject** in **AI Assistant**. Acceptance creates one undoable history entry.

**Pause at Steps** is enabled by default in the timeline. Uncheck it for continuous playback.
With the timeline focused, **Space** toggles play/pause and **Left/Right Arrow** steps one frame.
Enable **Auto-keyframe** beside **Pause at Steps** to create timeline keys and steps, including
double-click inserts, property tracks, context-menu inserts, and loop keys. It is off by default
and resets when opening or creating a project. Existing keys can still be selected and edited.
When off, position, size, rotation, opacity, gradient-stop, stroke-width, and effect edits apply
across existing keys without inserting a key at the playhead. Static objects stay static; existing
motion is offset rather than replaced. Enable it to make frame-specific edits.

For vector points and handles, see the [path-editing guide](../skills/ograf-authoring/references/path-editing.md).
Clicking blank canvas keeps path editing active. Choose **Done** or press **Escape** to finish.
For recent changes, see the [release notes](releases/0.21.md).

Manage a selected layer's data links under **Properties → Data Bindings**. Binding indicators are
not drawn over the canvas artwork.

## Fullscreen preview

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
- Package font assets when consistent typography across computers matters.
- Refreshing a linked component replaces its local content/style edits. Use independent instances
  when those edits must be retained.
- Runtime collections have explicit capacity and truncate overflow. Validate representative data
  and test the exported package with your target player.
- Large embedded assets can exhaust browser storage. Save editable source regularly.
- Browser certification and visual captures require a responsive Studio window.
