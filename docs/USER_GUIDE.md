# Using OGraf Studio

[Back to overview](../README.md) · [AI authoring](AI_AUTHORING.md) · [Development](DEVELOPMENT.md)

## Creating templates and sets

**File → New…** opens the setup window for canvas size, frame rate and a blank template or
recipe. To add a second template, open the Templates pane and choose **New template…** or
**Add existing template…**. Studio creates a template set while retaining the first template's
artwork. In a set, **New Template Before/After** opens the window with the set's output defaults,
which can be overridden for the new template. **Cancel** keeps the current document and
selection; replacing an existing document is confirmed when you create the new one.

**File → Open Recent** lists up to ten recently opened templates and template sets, newest first.
It shares the welcome screen's history and includes local files and documents opened from a URL.
Reopening reads the latest source and confirms replacement of the current document. Cancelling,
denied access or a failed read keeps the current document. History belongs to this browser profile
and Studio address; if the browser no longer permits access to a file, choose **Open…** again.

Composition presets offer 1920 × 1080 and 3840 × 2160, each at 50 or 59.94 fps.
Use **Custom** for other dimensions, including portrait canvases, or frame rates. Saved templates
keep their existing dimensions and timing when opened.
Select **Don’t show on startup** to skip the welcome screen on future launches. You can turn it
back on under **File → Preferences → OGraf Studio → Workspace & windows**. Saved recovery work
continues to open normally, and **File → New…** still shows its setup.

## Broadcast recipes

Choose **+ Recipe…** above the canvas for a ready-to-edit graphic. Each starter creates a reusable
component asset and a linked scene instance. Edit the asset to update its instances, or keep an
instance change as an override. Colors and materials use the template's Brand Kit; text, effect
stacks and entrance/exit tracks remain editable.

| Recipe        | What it includes                                                                      |
| ------------- | ------------------------------------------------------------------------------------- |
| Lower Third   | Headline and subheadline controls, clipped reveal and coordinated lifecycle motion    |
| Bug / DOG     | Channel identity control, material panel and compact entrance/exit                    |
| Ticker        | Native mixed-content ticker, transparent edge fades and safe Next appearance updates  |
| Scoreboard    | Team names and constrained score controls with rolling text updates                   |
| Clock / Timer | Live system clock, formats, time zones, 12/24-hour display and automatic/manual input |
| Countdown     | Native timer with editable five-second and zero alarm Rules                           |

News and Sports starters use the **Roboto Condensed** font seen in Signal Blue, with heavier
headlines and cleaner numbers. The variable font and its license are embedded in the project,
so the same typography travels with component assets and exported graphics. Existing custom
Brand Kit fonts remain authoritative; change the family and weights in the Brand Kit to restyle them.

Default recipes occupy separate areas: scoreboard at the top left, bug and clocks down the right,
lower third above the bottom ticker. Labels and scores stay aligned inside their full text boxes,
and text, accents and digit windows travel with their panels. Placement and motion overrides remain
available for your own layouts.

Each built-in Brand Kit supplies its own animated panel shader: News uses a signal grid, Sports
uses velocity diagonals, Entertainment uses studio ribbons, and Documentary uses contour lines.
The surface and accent follow the kit's colors; strength and speed remain editable. New starters
combine one native background shader with gradient/glow accents. Explicit custom paints and
edited shader sources remain yours when switching kits.

**Ticker** travels right to left by default. Text layout and travel direction can be changed
independently. Edit native items in Properties to use images, animations or shaders. **Next
appearance** preserves each visible item's content and width until it leaves the window; pending
indicators show queued edits, insertions and removals.

**Clock / Timer** uses the system clock by default. Switch its mode/source in Properties for a timer
or an external data feed. **Countdown** includes normal Rules for five seconds and zero; edit their
actions in Rules. Start, Pause, Reset and Restart use the same timer controls as other clock layers.

Recipes require a pausable Step. They create content in the current template. Use **Transitions**
to add template-set lanes, conflicts or make-room behavior; playback stays in **Preview & Export**
and **Playout Controls**. Use **Data → Operator controls** to choose the controls sent to OGraf playout.

When a recipe is the first content in a fresh template, its Out begins at the Step and uses the
Brand Kit's exit duration. The graphic stays on air at the Step until the operator advances it.
Adding a recipe to an existing or customized template keeps that template's timing; previously
created graphics, including lower thirds, are not retimed automatically.

## Plugins

Open **Plugins** from the menu. Its dockable pane starts immediately to the right of the **Timeline** tab. Choose
**Animation**, **Charts** or **Shaders** on the left. The selected category's plugins appear in
the upper-right area; select a plugin to display its templates below. Click the gear inside its card
for plugin settings (right-click **Manage plugin…** also works); click the card name to return to templates. The active
version selector is inside the selected plugin card and applies to both views. Drag, float, detach, resize or close it like any other pane;
**Plugins** in the menu or **Window → Plugins** brings it back.

All plugin types share the same template cards. Animation presets show their timing and parameter
controls in **Animation Settings** on the right; shader presets show a single **Shader Preview**
there. Template browsing and the right-hand controls scroll independently.
Drag their vertical divider to change the gallery/detail widths. Arrow keys adjust a focused
divider; double-click it to restore the default width.
**Find template…**, above the current template gallery, filters charts, animations and shaders
as you type. Search uses template names, IDs and descriptions; every entered word must match.

Select a plugin card and its exact version, then choose a chart template to create a chart, an animation preset to
apply motion, or a shader to paint the selected objects. Chart creation uses the selected exact
provider, not another default.

Click the gear on the selected plugin's card to manage it. Each chart card separates the
underlying library (for example Chart.js, with its own version, publisher and license) from the
Studio adapter (integration code, with a separate version, publisher and license). These are
declared metadata, not verified publisher identity or legal permission.

**Add plugin…** imports a local `.ogsplugin.zip`. **Update…** checks the same plugin ID and kind
and compares versions and contents before review. Chart JavaScript requires explicit trust;
animation packs contain validated JSON, not executable code. Shader packs contain GLSL GPU code
and also require review before preview/application. Updated
versions install alongside old versions. Version selection, Enable, Details, and removal controls apply to the selected bundle.
Existing charts retain their exact renderer version. Preview & Export can offer an explicit update
to an installed, trusted compatible build, showing affected objects and shared component instances.
The previous bundle stays saved and the update is undoable; check the result because renderer
versions can look different. Individual charts can also change provider in Properties. Templates
carry their renderer code, but Studio requires approval before executing an unfamiliar plugin.
Opening a template or template set checks the chart renderers used by every template, including
inactive ones. A prominent **Plugin mismatch — charts unavailable** dialog identifies missing,
disabled or untrusted builds, shows the saved version/build and offers compatible installed
renderers where available. Dismissing it leaves a **Charts cannot render** warning bar with
**Review plugins…** until the problem is resolved. Healthy older renderers do not trigger this
blocking warning merely because an update exists. Renderer replacement is explicit and undoable;
save the `.ogs` document to keep changed references.
See [Renderer plugins](RENDERER_PLUGINS.md) for installation, portability, and the provider API.
Disabled versions remain manageable, but unavailable versions cannot preview or apply templates.

Bundles use the `.ogsplugin.zip` suffix. Chart rendering is plugin-only; there is no integrated
fallback. If no chart plugin is installed and enabled, use **Plugins → Add plugin…** to install one. Older
unconfigured charts can still be edited, but need a renderer selection before preview/export.

Chart bundles contain both adapter and library code. They cannot be swapped independently;
an application update needs a new compatible bundle. Separately supplied commercial libraries
(BYOL) are not supported yet. Shared sources and exports contain pinned renderer code, so check
the applicable licenses before distribution.

### Animation preset packs

Install an animation `.ogsplugin.zip`, select one or more objects, then open **Plugins**, choose
**Animation** and select the pack's card. **Plugins…** beside **Animate In** or **Animate Out** also opens the preset chooser. Choose the exact pack
version, a preset, duration in frames, and its numeric controls; click **Apply**. Browsing the
gallery does not change the project. A group application is one undo step.

Presets create editable keys in the Start-to-first-Step or last-Step-to-End window. Applying one
replaces keys on its declared channels in that window; other tracks and loops remain unchanged.
Short durations that collapse separate keys onto the same frame are rejected. Existing clips,
shaders, gradients and text stay editable. This is whole-layer motion, not a new per-letter text
animation engine.

The bundled-source example **Broadcast Motion** offers **Slide & Settle**, **Pulse Pop**, and
**Curtain Reveal**, with both In and Out variants. Build it with `npm run plugin:package:animations`.
Source retains its exact definitions and last-applied settings, but OGraf playback uses ordinary
tracks: disabling/removing a pack does not stop an already applied animation. Updating a pack
never changes existing keys automatically. See [Animation plugins](ANIMATION_PLUGINS.md) for
the data-only SDK and packaging format.

### Shader packs

Install a shader `.ogsplugin.zip` through the Plugins pane, then choose **Shader** and select the pack's card and version.
Choose a shader and **Fill**, **Outline** (text only), or **Effect**, according to its declared
compatibility. **Apply** creates independent editable source and controls and saves a reusable
copy in **Resources → Shaders**. Identical resources are reused. **Add to Resources** saves without
applying, including effect-only shaders whose `iChannel0` comes from the layer's effect stack.

Alternatively, drag a shader card onto a canvas object and choose **Fill**, **Outline**, or
**Effect** from the popup. Empty canvas space uses the current selection. Incompatible choices
are disabled; Outline requires text. Effect appends an enabled shader with **Normal** blending at
**100%**. Applying and saving share one undo step. Drag directly onto **Resources → Shaders** to
save without changing any object; its collapsed header accepts drops too.

The gallery shows shader cards with names and lightweight illustrative icons beside a shared live preview. Clicking a card automatically previews
just that shader; changing selection, opening management, or hiding the pane disposes the old preview. GLSL can impose high GPU load, so start small. Preview
and installation do not modify your template. Removing/updating a pack never changes shaders
already copied into objects, effects or Resources. Source and exports preserve copied notices.

The source example **ZD News Shaders** contains 20 numbered CC0 presets, including backgrounds,
text finishes, transparent overlays, and the effect-only **Signal Glitch**. Build it with
`npm run plugin:package:shaders`. See [Shader plugins](SHADER_PLUGINS.md) for the format and SDK.

## File types

| File                       | Purpose                                          | How to open it                                                                                         |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `.ogs`                     | Editable document with one or multiple templates | **File → Open…**                                                                                       |
| `.ogp`                     | Legacy editable template-set archive             | **File → Open…**                                                                                       |
| Remote `.ogs` / `.ogp` URL | Public/CORS-enabled editable document            | **File → Open from URL…**                                                                              |
| `.ograf.zip`               | Certified playout package                        | **File → Import OGraf** for best-effort editable conversion, or extract it for an OGraf player/devtool |
| `.ograf-set.zip`           | Bundle of certified template outputs             | In **File → Export…**, choose **Template set** for a set without Transition Logic                      |
| Loose OGraf package files  | Manifest, `main.js`, and resources               | Select them together with **File → Import OGraf**                                                      |
| SVG and raster images      | Reusable image assets                            | **Add Image** above the canvas, or drop files onto the canvas                                          |
| Lottie `.json`             | Looping vector animation layer                   | **+ Lottie JSON** above the canvas                                                                     |

An `.ogs` file is not an OGraf manifest and should not be opened directly in an OGraf playout
tool. A `.ograf.zip` is the deployable output, but arbitrary third-party JavaScript cannot always be
reconstructed as editable layers. The import report lists everything recovered, defaulted, or lost.

The Open dialog offers **OGraf Studio documents** (`*.ogs`, `*.ogp`, `*.ogeproj`), **JSON files** (`*.json`), and
**All files** (`*.*`) filters in browsers with native file picker support.
Opening remains backward-compatible with legacy `.ogp`, `.ogeproj` and `.ogeproj.json` files.
Standalone templates retain JSON source; template sets use a ZIP container with the same `.ogs`
extension. Studio detects contents automatically, preserving every member of a multi-template file.

### Template sets

Add a second template in the Templates pane to create a set from the open project. **New template…**
creates one using the setup window; **Add existing template…** opens an editable source. In a set,
**Add .ogs Template…** adds another source. **Save Template Set…** writes one portable `.ogs` containing template
sources, shared controls and dependencies. Compact saves store identical font/resource bytes and set
component sources once. Opening restores complete editable templates with the same IDs, bindings,
animation and overrides. Extracted compact member files require the set's shared data; use **Save
Template** for a standalone editable document or choose **Current template** in **File → Export…**
for a standalone playout export.
Saving shows template/resource/compression progress and runs archive generation in a worker, so
the editor and its bridge can keep responding. Edits made during saving remain in the open document.

A new set starts as **Untitled Template Set**. Double-click its root in Scene Outliner, or select it
and press **F2**, to rename the set. Saving the set `.ogs` under a different filename updates the set
name and the archive's root. Saving a child `.ogs` updates that template's name; the container keeps
its own name. Scene Outliner labels roots as **Template Set** or **Template** to show the document type.

Studio saves sets using compact archive schema 6. Earlier versions that read schema 5 require a
compatible archive, which can be created through MCP; that copy retains the older archive layout
and can be larger. Newer features are not down-converted. Current Studio still
opens older schema 1–5 sets and legacy `.ogp` sets. Older Studio versions that expect JSON `.ogs`
cannot read any multi-template `.ogs` archive. **Add .ogs Template…** accepts a single template only;
open a multi-template document as a set to retain all members.

The **Templates** pane switches the canvas between set members. Drag a thumbnail above or below another
to reorder templates; the insertion line shows the drop position. The active template and its edits
are preserved when reordering.

Double-click a thumbnail or its caption to rename that template. Press **Enter** or click away to
save the name; **Escape** cancels. Names must be unique within the set, ignoring case and surrounding
spaces.

**Scene Outliner** is a separate dockable explorer pane. Use **Window → Scene Outliner** to show it, drag
its tab to dock or float it, or use the pane's window button to open it in a separate window.
Search filters the hierarchy while preserving parent nodes; arrow keys navigate and expand branches.
The explorer follows the active template and selected layer, and works with standalone templates too.
It shows
the set's templates, compositions, layer hierarchy, data fields, media cues, asset definitions, and
asset instances. Selecting an asset instance navigates to its owning layer when applicable.
The first column shows **Z-order**, starting at 1; higher numbers appear in front. The eye column
shows or hides an object. Component instance eyes control all their layers, and source-layer eyes
edit the parent component, propagating to instances that inherit visibility. These changes support Undo.

Expand **Shared controls and asset slots** in Scene Outliner to define parent controls and shared
assets. You can also manage shared components and asset slots from **Resources → Template Set**;
**Resources → Template** shows the current template's resources. The set view shows per-template
usage and whether each link is shared or uses a local override. Add a shared control from a template
data field, then link compatible fields in other templates. Add an asset slot from a template asset,
then link the corresponding template assets. The **Inherit** checkbox applies the set value to
that template; clearing it keeps the template's local value or asset as its fallback. Image URL
controls can reference a shared asset slot.

Before applying a new shared asset source or replacing its file, review the affected slots and
template links. A file replacement can update every slot using that shared source, or use a separate
source for the selected slot. Cancel leaves the set unchanged. Shared components keep their existing
source/instance and override behavior. A previously exported or on-air package remains a snapshot;
export and deploy it again to use later changes.

For a set without Transition Logic, choose **Template set** in **File → Export…**. Studio
certifies each resolved template and saves the standalone `.ograf.zip` files inside one
`.ograf-set.zip`. If any template fails certification, the bundle is not saved. Each
`.ograf.zip` remains a regular OGraf playout package.

### Cropping

Select any visual layer, including rectangles, shaders, patterns, text, and images, then choose
**Properties → Crop → Crop** or right-click it and choose **Crop**. Select a group or several layers
to crop them with one rectangle. Crop handles appear directly on the canvas: drag an edge or corner
to resize the retained region, or drag inside it to move it. **C** starts cropping the selection, or
the canvas when nothing is selected. The crop toolbar shows the retained dimensions. Press **Enter**
or choose **Apply** to save; **Escape** or **Cancel** discards the adjustment. Arrow keys move the crop
by one pixel; hold **Shift** for ten pixels. A focused handle resizes its edge with the same keys.
The layer remains at its original position and size; only the visible area is trimmed.
**Reset Crop** in Properties or the context menu restores the complete layer. Crops follow the
layer's transforms and remain independent of Animate In / Out wipes.

For an image, image sequence, or Media paint, **Crop Source** shows the full source on the canvas
with adjustable crop handles. Video cues also offer this control under **Video target**. Apply or
cancel from the same crop toolbar; **Reset crop** in Properties restores the complete source.
The original asset is preserved, and the crop stays on that layer or media instance. **Contain**,
**Cover**, and **Stretch** determine how the cropped region fits into the layer's existing frame.
When cropping a component's source paint, the component editor temporarily hides and returns after
applying or cancelling the crop.

With no layer selected, use **Properties → Composition → Crop Canvas** to adjust the output region
directly on the canvas. The authoring canvas and animation coordinates stay unchanged; the shaded
area is excluded from output. Preview, thumbnails, and OGraf export use the cropped dimensions.
Choose **Reset** and **Apply** in the crop toolbar to restore the full canvas. Crop changes are
undoable and stored in `.ogs` documents and legacy `.ogp` sets.

### Settings & Preferences

One **Settings & Preferences** window contains **OGraf Studio**, **Template Set** and **Template**
scopes. Search the category list by name or setting keywords, then choose a matching page. The
scope heading identifies whether you are changing this user's Studio setup, the open set or the
active template.

| Scope            | Open it from                                                         | Changes and storage                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OGraf Studio** | **File → Preferences**                                               | Workspace startup, preset and detached-window reopening preferences save immediately in this user's profile. They are independent of `.ogs` documents.                                          |
| **Template Set** | The gear in the **Templates** pane                                   | Output, data transitions, canvas/snapping and inheritance defaults are staged. **Apply** updates the open set; **OK** applies and closes. Save the set `.ogs` to keep them on disk.             |
| **Template**     | **Template Settings…** in a template's context menu or in Properties | Output/timing, background, canvas and guides use the same controls as composition Properties. Changes apply immediately and are undoable. Save the template or set `.ogs` to keep them on disk. |

Studio preferences and Template edits do not wait for Apply. Closing the window does not undo
those immediate changes; use Undo for template authoring edits. Unapplied Template Set changes
remain a draft while switching scopes and are discarded when the window is closed. Opening
Preferences does not create a template set.

**OGraf Studio → Plugins** manages installed versions, enabled state, trust and the default chart
provider. Shader Packs 1 and 2, Broadcast Motion and Chart.js are included offline and enabled on
fresh installations. Included versions can be disabled and remain installed. The **Plugins** pane
browses their templates; its Add and management buttons open this same preferences page.
**Template Set → Plugins** and **Template → Plugins** list exact saved requirements and usage.
Installing a new version never automatically changes existing template pins or object options.

Starting a canvas or source crop temporarily hides Settings so you can adjust the crop on the
canvas. **Apply** or **Cancel** restores the window and retains any pending Template Set draft.

Template Set defaults cover canvas size, frame rate, background, render modes, data-change fades,
safe-area displays, rulers, snapping, grid spacing and canvas bounds. They affect every inheriting
template's main composition and new or inserted templates. Resolution changes respect layer
constraints and preserve animation frames and easing. Media and audio templates retain their
required real-time profile.

Under **Template Set → Template inheritance**, uncheck a template to keep custom settings or
choose **Enable inheritance for all templates**. Properties also offers **Use template set defaults** when editing a composition.
Inherited fields remain editable. Their **Inherited** badge identifies the Template Set source;
editing a field creates an **Overridden** value for that property only. Click **Inherited** to pin
the current value without changing it, or **Reset** to follow the set again. Other properties keep
inheriting. Whole-template opt-out remains available.
Each template keeps its own guides and timeline folders. Defaults and inheritance choices are saved
in set `.ogs` documents, legacy `.ogp` files and autosaves.

Coordinated exports require all states to use the same effective output width/height and frame
rate, including any canvas crop. Template overrides remain editable; resolve incompatible output
settings before exporting a coordinated package. Standalone template saves and exports include
their resolved settings and resources.

### Master Brand Kit

Open **Brand Kit**, then choose **Use this Brand Kit for set** to adopt the active template's tokens
as the set-wide master. **Template Set** scope edits shared palettes, font-family/size/weight tokens,
other design tokens, and canvas background. All members receive the shared tokens; compatible token
keys map onto shared identities during adoption. Unrelated local tokens are retained.

In **This template** scope, editing a shared token's value creates a template override. A linked
object property also remains editable: changing it creates an object override, leaving other objects
linked. Origin badges show the source; **Reset** restores its inherited value. Master token names,
keys and types are edited in Template Set scope. Bind object properties through **Brand tokens** in
Properties; adding a token alone does not restyle every object.

Import custom font files in **Resources → Fonts** before assigning font-family tokens. Used fonts
and their license notices travel with the set and resolved child exports. The generated master CSS
view exposes safe custom properties; it is not an external stylesheet or arbitrary executable CSS.
Standalone OGraf output contains resolved values and assets, without requiring the set at playout.
Canvas backgrounds are output paints, distinct from Studio's editor-only presentation backdrop.

Under **Typography styles**, add **Headline**, **Body**, or **Caption**, then edit the combined font
family, size, weight, line height, tracking, alignment and case settings. Select text and choose
**Apply to selected text**, or select the preset at the top of the Text properties section. Editing
an object property overrides only that property; its reset arrow restores the preset. Content,
mixed text runs, palette links, layout and animation are preserved. Template-level preset overrides
and object-level property overrides remain independent.

Under **Background styles**, add a style and use the familiar paint controls for solid colors,
linear/radial/conic gradients, shaders, or Media. **Edit shader** opens its GLSL controls. In
Template Set scope, choose **Default background** or **Use as default background**; inheriting main
compositions follow it. In This template scope, apply a style or edit its output paint under Canvas
Properties. **Reset** restores the inherited paint/selection. Backgrounds are not selectable objects
and always render beneath artwork.

Media backgrounds are muted and real-time-only. Imported clips and live tags use the same playback
and renderer requirements as object Media paints. Webcam preview starts only when explicitly
requested; device selection, camera settings and camera frames never enter saved source. Shared
clip/font bytes are stored once in set `.ogs` archives and restored on opening; save/export individual templates through Studio to
get resolved self-contained assets. The generated CSS view includes typography and static paints;
GLSL/video/live backgrounds use the OGraf paint renderer, not CSS URLs or an external stylesheet.

### Template thumbnails

The Templates pane updates the active template's preview 300 ms after the last committed edit,
using the latest editor state. It uses the chosen thumbnail frame, normally the first Step, rather
than following timeline playback. Choose **Refresh thumbnail** beside a template to regenerate it.
The previous preview stays visible while the new one renders.
While Preview & Export is fullscreen, Templates and Transitions thumbnail rendering pauses. It resumes with the
latest changes when you exit fullscreen, including when the preview is in a detached window.

Right-click a thumbnail for **Duplicate**, **Cut**, **Copy**, **Paste**, **Rename**, **Remove**, and
insertion before or after that template. **New Template** creates a blank template; **Insert Template**
opens an `.ogs` file. Copies inside a set retain inherited controls and shared asset links. Pasting
into another set keeps the resolved content and assets as local values. New names are made unique.
Use the trash icon on a thumbnail to remove it, or **Undo Remove Template** to restore the last
removal. Removing the last template leaves the set open and empty, ready for a new or inserted template.
When a thumbnail has focus, Ctrl/Cmd+C, X, V, and D copy,
cut, paste, and duplicate; Delete removes it and F2 renames it.

**File → Save Template** includes a thumbnail preview and frame selector. By default it uses the first
OGraf step of the main composition, or frame 0 when there are no steps. Enter another frame to
override it, or use the previous/next-frame buttons; the choice is stored in the `.ogs` file.
The preview keeps a fixed size while changing frames.

**Save .ogs…** opens a file save dialog where you choose the filename and location for the editable
source. Browsers without a file save dialog offer **Download .ogs** instead.
Changing the filename in the save dialog also updates the template name after saving succeeds.
**Download ZIP** saves `Template Name.ogs` together with
`<id>_thumb.png`, using the top-level project `id` from the saved JSON. Renaming the template does
not change its thumbnail filename. The PNG has a transparent canvas background, excludes editor guides,
and keeps the composition's proportions at up to 320 pixels on its longest edge (320 × 180 for 16:9).
Authored background
layers remain visible.

Extract the ZIP before opening the `.ogs` source.

**File → Export…** opens Preview & Export, expands its Export section, and brings the export options
into view even if the pane was hidden or the section was collapsed.

**Export .ograf.zip** opens a thumbnail preview and frame selector before exporting. Enter a frame,
use previous/next-frame buttons, or select **First OGraf step**. A successful export remembers the
choice for the template; cancelling leaves it unchanged. The ZIP includes `<id>_thumb.png` and
references it in the OGraf manifest's `thumbnails` list.

When you export a template set from **File → Export…**, Studio opens a progress window before
preparing the output. Choose **Cancel** or press **Esc** during preparation to stop the export.
Once the files pass certification, the window offers **Save…** or **Download**. Save verifies the
written bytes. Download requests browser delivery. A failed build or certification creates no
destination file. **Save Certified Export…** in the **Preview & Export** pane's **Export** section
reuses the prepared bytes without compiling again.

For **Current template**, Studio starts with the template's authored render modes. A dual-mode
template with an enabled external data connection starts on **Real-time playout**. Choose **Dual**
or **Non-real-time render** when you need frame-by-frame output with scheduled input. If only the
repeat-frame canvas check fails, the export window offers an explicit switch to real-time so you
can certify and export that version for live playout.

In **File → Export…**, choose **Standalone HTML** to export one browser-ready `.html` file.
The default choices are **Template set** and **Both files**. Change them in **File → Preferences →
OGraf Studio → Export**. Studio saves the HTML and ZIP separately. A single open template uses
**Current template**. An independent set exports as a ZIP when selected as a whole. Select its
member and choose **Current template** to export that member as HTML.

Open the HTML file directly in a browser. It contains the graphic, assets, manifest and saved
authoring prompt metadata. Expand **Authoring prompts** in the playout controls to read the saved
prompts for each template. The preview provides playback,
data and declared custom-action controls; coordinated graphics also provide lane controls. Each lane
immediately shows only the selected template's exposed fields. Select another template to edit its
fields. Changes to the selected **Next** template are staged
until Take; untouched fields retain their state presets.
The preview starts with its controls hidden. Right-click the graphic or press **D** to open them.
Dock the controls to the left or right and the graphic fits the remaining space. Entering fullscreen
hides the controls for an unobstructed output.
The exported controls use Studio's compact Playout Controls styling, typography, transport and
lane/data sections, with a separate scrolling body. Left/right docking remains available in
**View settings**.
Presentation controls select a solid color, checkerboard, local image/video or webcam background,
and toggle EBU R95 action-safe and title-safe guides. Backgrounds and guides affect this preview
only; they do not change the exported graphic. **Fullscreen** and **Escape** enter and leave fullscreen.
The normal OGraf manifest, graphic module and packaged assets remain available for playout.
**Show FPS overlay** is on by default in **View settings** and is visible while the controls are
open. **Preview FPS** measures the browser's
animation-frame cadence, not the authored frame rate or GPU throughput. A non-real-time preview
also shows **Render FPS** for successful completed render samples. Hidden pages and offscreen
previews reset sampling; disabling the overlay releases its monitor. The badge is preview-only
and never becomes part of the graphic or its thumbnail.
Studio suggests a filename based on the template or set name and replaces unsafe filename characters.

OGraf exports include the Studio playback runtime's AGPL-3.0 license at
`licenses/OGRAF-STUDIO-AGPL-3.0.txt`. Standalone HTML displays the same license in its controls.
Packaged assets and third-party components can have their own license notices.

The preview runs executable graphic code, so open only packages you trust. Browser capabilities and
permissions still apply: WebGL, audio, webcam, external data and other network resources may require
browser support, a user gesture, permission, or a network connection. An offline page does not turn
an external live feed into offline data. Test the extracted page in the intended browser.

### Load an exported graphic in Nodos

Export a Real-time or Dual `.ograf.zip`, extract it, and set an existing ElectroNode's **URL** to
the exported `<template name>.html` page. Preset registration and a running Studio connection are
optional for this workflow. In ElectroNode, the page plays the graphic on a transparent background
without browser preview controls; opening the same HTML in a browser keeps its normal controls.

Add input pins to the ElectroNode and give them the exact expected names, including letter case.
Public data-field keys declare those names, and their chosen Nodos types declare the expected pin
types. A live fill's **Input** declares a `nos.sys.vulkan.Texture` input; for example,
`TextureInput1` matches a pin labelled `TextureInput1`, while `textureinput1` is a different name.
Several objects can use the same texture input. Coordinated exports declare their root `slots`
control as `nos.Dict` and include live textures from their templates and shared scene.

ElectroNode matches existing pins and reports missing names, duplicates and unavailable types.
An expected type change can disconnect incompatible existing wires. Re-export and reload the page
after changing its expected inputs; previously exported files are snapshots.

### Nodos presets

**File → Preferences → OGraf Studio → Nodos** keeps chosen templates of the open document set as presets in a
Nodos engine. Turn on **Keep Nodos up to date**, enter the engine's address (`localhost:11003` by
default, the Editor API port of Nodos 1.4.0.b5023 and later; earlier builds use `localhost:50052`)
and the node menu category (`|` separates sub-categories), and tick the templates to send.
Studio remembers these choices in this browser. A template must support real-time playback: the
Nodos page plays it in real time.

Studio's server connects to Nodos as an editor and sets each ticked template as a node preset. The
preset uses a stable identifier based on the template's ID, so equally named templates remain
distinct. Renaming a template or unticking and choosing it again keeps its node class; the menu
entry shows the current template name. Existing unique preset names are retained. Older conflicting
names are separated; recreate nodes whose former class was shared by multiple templates.
Picking the preset in the Nodos node menu creates an ElectroNode that shows
the template at the composition's output size. The preset supplies URL and Resolution settings.
A canvas crop sets the output dimensions; it does not change the authored composition or discard the
crop's position.

Studio sends a ticked template again whenever its edits pause, and every ticked template when it
connects to Nodos. Nodes made from a template take the new version and restart their ElectroNodes;
pin values set in Nodos stay. The page shows the result of each template's last update. Unticking a
template stops its updates and keeps its preset in Nodos. Shared controls and asset-slot changes
also update chosen inactive templates. Disabling sync, unticking a template, switching documents
or changing the destination cancels preparation that has not been sent. A registration already
sent to Nodos may still finish.

Studio's server serves what the ElectroNode loads below its `/nodos/<preset name>/` route:
the exact certified OGraf package and `nodos.html`, a page that loads the graphic in real time
with its public data defaults, then plays its first step, on a transparent page background. Studio
uses an immutable URL for each update. A rejected update leaves accepted files intact. Connection
timeouts permit a new connection on the next update. Studio
keeps these files in memory and sends them again when its editor reconnects, so keep it running while Nodos
plays the template. Studio's server listens only on `127.0.0.1`, so Nodos must run on the same
machine. In development, run `npm run start:all` so that Studio's server runs beside the editor.

The server retains the current and previous accepted versions for each engine and preset. Older and uncertain registrations
remain fetchable for a 60-second grace period. Storage is bounded to 256 MiB total, 64 MiB per
package, 4,096 files per package and 128 versions, with at most eight pending updates. When full, it refuses a new update
instead of removing protected graphics; wait for old staged versions to expire or reduce package size.

Create an ElectroNode and add reusable input slots such as `TextureInput1`, `TextureInput2` and
`DataInput1`. Give each slot that visible name in Nodos. When its URL loads, ElectroNode matches
the design's declarations to existing slots by name and applies their declared Nodos types.
A type change preserves the pin identity and disconnects its old wires; an already matching type
preserves its current value and connections. Missing slots and duplicate names appear in the
ElectroNode preview. Missing slots are not created automatically; add them in Nodos before using
the page. URL changes retain the graph's input slots.

Use **Data → Operator controls** to choose the fields the page declares. Field keys supply the
reusable slot names. Internal fields remain available to bindings, animations and Rules and stay
outside the public declarations and initial data. Object and array defaults also omit internal
descendants. Changing a matched value updates the graphic through `updateAction` and its configured
data transition.

A live-media source's tag supplies a texture slot name, such as `TextureInput1`. The Nodos page
connects matching GPU textures to the graphic's live-media renderer. Several objects can consume
the same tag. The generated page lists its requirements in a `nodos-inputs` JSON element; preset
definitions contain URL and Resolution settings.

| Data field                                           | Nodos pin type                   |
| ---------------------------------------------------- | -------------------------------- |
| Text, text area, color, image URL, file path, select | `string`                         |
| Number, percentage                                   | `double`                         |
| Integer, duration                                    | `int`                            |
| Boolean                                              | `bool`                           |
| Object, gradient                                     | `nos.Dict`                       |
| Select multiple                                      | `[string]`                       |
| Array                                                | `[T]` of its items' pin type     |
| A field of a Nodos type                              | that type, such as `nos.fb.vec4` |

Nodos has no arrays of arrays, so an array of arrays becomes `[nos.Dict]`, each Dict holding one
inner array as `items`; the page unwraps them before the graphic sees them.

While Studio is connected to Nodos, a field's **Type** list also offers the engine's own types under
**Nodos types**: its structs, tables and enums whose values a template can hold. Choosing one gives
the field that type's structure, an object of the type's fields or a select of the enum's values, and
declares that type for the matching input slot. The structure stays as the type has it; choose
another type to edit the field again.

Saved fields keep their chosen structure even while the engine is disconnected. If the engine's
definition changes, choose the type again to update that structure. Switching engines or disabling
the connection clears the discovered type list without changing saved fields. Unsupported resources,
recursive shapes and oversized arrays are excluded. Integer defaults must fit their native range;
64-bit integers are limited to JavaScript's safe range. Invalid values are rejected instead of
being rounded or wrapped.

Studio uses the Nodos Editor SDK's generated protocol and type serializers, with its own request
timeouts and cancellation handling. This preserves connection recovery and the distinction between
an explicit engine rejection and an update whose outcome is unknown.

An exposed data field or live-media tag cannot be named `URL`, `Resolution`, `ShowPreview`,
`Output` or `Audio`: ElectroNode reserves those names. This workflow needs the companion
ElectroNode host support for reading page declarations and matching their names/types to existing
slots, together with the typed `window.nodos.onData` data bridge and `nodos-input` texture bridge.
Process SDK 21.5 supports typed data forwarding, but an SDK version alone does not guarantee
the complete page-declaration, slot-matching and texture contract.

Presets set the cropped output size through ElectroNode's `Resolution` (`nos.fb.vec2u`) pin.
Rendering follows the frame rate of the Nodos thread that pulls the node; presets do not set a
`FrameRate` pin. ElectroNode 0.2.0.b49 or later provides this Resolution pin contract; that baseline
alone does not guarantee reusable-slot support.

Sending a preset needs a Nodos engine whose Editor API takes node presets (Editor API 5.1).
Verify initial playback, matched data changes and live textures in your installed Nodos version;
OGraf certification does not test the Nodos host or its data/texture bridges.

This wraps one template. Whole-set coordinated OGraf export and Studio's multi-template
preview remain separate features. It does not replace `.ogs` saving or add a coordinated Nodos
controller.

For DaVinci Resolve, choose the **Non-real-time** or **Dual** export profile: Resolve loads OGraf
graphics in non-real-time mode and cannot render a real-time-only package. Enable **Transparent
output** when the graphic should overlay video; an opaque composition background covers the full
frame. New compositions start transparent, shown as a checkerboard in the editor. Studio shows these
as non-blocking playout warnings because both configurations remain legal OGraf for other workflows.

### Remote project URLs

Use **File → Open from URL…** to download editable `.ogs` documents or legacy `.ogp` sets from an absolute HTTP or HTTPS URL. OGraf
Studio sends no credentials, follows only HTTP(S) redirects, limits the response to 32 MiB, parses
and validates the source before loading, and asks before replacing the current document. Archives
retain the whole set and use the local reader's integrity checks. The remote
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

### Charts

Open **Plugins**, choose **Charts**, then select a plugin card, its version and a chart type from its gallery.
The gallery includes vertical, horizontal and stacked bars; line and area; pie and doughnut;
radar and polar-area charts. Resize the layer on the canvas. Set text color, legend and grid in
Properties, then edit series, rows, values and colors directly. **Advanced · edit JSON** handles
bulk edits or multiple series. Each dataset needs one numeric value per label and `#RRGGBB`
colors. **Add Data Binding** creates a text field containing this JSON so an
OGraf playout can replace chart values through ordinary data updates. The standalone
[Chart.js](https://www.chartjs.org/) plugin provides these chart types; other compatible providers
can be installed separately. The exact selected renderer is embedded in exported HTML graphics.

Use **Animation** in the chart's Properties to choose **Grow**, **Reveal**, **Fade** or **None**.
New charts use Grow. Set duration and start delay in frames; Grow's stagger delays consecutive items.
For example, a duration of 25 frames lasts one second in a 25 fps project. Choose easing to shape
the motion. **Replay on data update** replays the animation when playout sends changed chart data.
Timeline playback, scrubbing and OGraf preview use the same animation timing; native Studio
keyframes can also move or fade the whole layer.

For plugin motion on individual bars or slices, select **Chart.js renderer 1.3.1** (or a provider
declaring `mark-animation-v1`), then expand **Bars / slices animation** in the chart's Properties.
Choose an installed animation pack preset separately for **In** and **Out**. Set **Duration**,
**Delay** and **Stagger** in frames, adjust its numeric controls, then press **Apply**. **Clear**
removes only that side. Duration plus delay and the full staggered sequence must fit the
template's In or Out window; lengthen that window in Timeline if needed.

Each vertical/horizontal bar, stacked segment, pie/doughnut slice or polar-area sector moves
independently. Stagger runs through each dataset in order. Value labels follow their marks;
axes, category labels, grid and legend remain stationary. Gradients, shaders and media fills keep
following the moving mark shapes. An In preset replaces the chart's built-in entrance; normal
data-update animation remains available without restarting the mark entrance. **Animate In / Out**
still controls the whole chart separately. Line, area and radar marks do not support these presets.
Projects retain exact animation definitions; exports bake numeric curves, so playout needs no
installed animation pack. Existing charts keep their pinned renderer until you explicitly change it.

Renderer **1.3.1** keeps chart axes, labels and painted marks aligned when the editor is zoomed
or the preview is fitted to a different size. Install the updated plugin, then select it in the
chart's **Renderer** control; installing alone does not change existing chart pins.

### Procedural patterns

Choose **Resources → Patterns → Add pattern**, or the pattern tool above the canvas. Pick a
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

### Fill transparency

Choose **None** in a shape's **Fill** selector to keep its geometry, outline and effects with a
transparent fill. Gradient stops have independent **Alpha %** controls: **100%** is opaque and
**0%** is transparent. **Fade to transparent** creates a two-stop gradient from the first stop's
color and alpha to a fully transparent endpoint, keeping the gradient type and direction.

### Blending effects

In **Properties → Effects stack**, new effects start in **Bypass**. Choose **Normal**, **Screen**,
**Add**, **Multiply**, **Overlay**, **Darken**, or **Lighten** to activate an effect. **Effect opacity**
sets how much its result contributes. Foreground effects run top-to-bottom: each blends against the result
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
passed to later effects. Exposed controls stay in Properties; **Edit shader** opens its source
editor in Resources. The effect cannot attach a separate `inputImage`, because `iChannel0` is reserved for the
incoming stack image.

For **Normal** effects on pictures, transparent generative shaders such as **Light Leaks** blend
over the incoming artwork, so the picture stays visible at 100%. Shaders that read `iChannel0` or
`iChannelResolution` remain complete post-processing passes; their intentional transparency can
still hide or reveal the image. Shader **Fill** painting is separate and still replaces its colours.

**Backdrop blur** creates frosted glass on rectangles and ellipses by softening earlier layers in
the same composition, clipped to the object's bounds and corner radii. Use **Fill → None** for clear
glass or a gradient with partial alpha for tint. Choose **Normal**, set **Radius**, and adjust the
amount: **0%** gives no blur; **100%** uses the full radius. The amount scales the radius, and the
radius can be animated. Shader fills are supported; an active Shader effect and active Backdrop
blur cannot share the same object. Backdrop-blurred objects can provide geometric path masks,
but cannot provide alpha masks. SVG diagnostic previews omit the backdrop blur. Check its
appearance in the actual browser view; PNG capture parity is not yet verified.

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

### Live inputs on objects

Select a rectangle or another paintable object, open **Resources → Media**, choose an **Input**,
and press **Use input here**. The status shows the input and destination object. Use **Other input…**
to enter a different name, matching the Nodos pin's letter case. The object owns this source directly;
there is no separate cue or video-target assignment. The same controls are available from the
object's **Fill → Live input** setting.

To preview a camera on that object, press **Start webcam** or **Use webcam here** in the same card.
This applies the selected input to the object before starting or redirecting the camera. The webcam
is a local preview of that input; the exported page receives the named texture input from Nodos.
Fit, crop and focal-position controls stay with the object's fill.

### Media Cues

**Resources → Media → Playback cues (advanced)** contains scheduled audio/video playback cues.
Choose **Create Cue at Keyframe** on an imported video, or **Create Playback Cue** on an
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

Use **+ Live playback cue** for scheduled renderer-owned sources such as `camera.program`. Source changes support Cut or
Crossfade, an audio transition policy, and Keep current, Use fallback, or Transparency/silence when
the incoming source fails. Clip-to-clip, clip-to-live and live-to-clip changes prepare an incoming
slot while the outgoing source remains active.

For local testing, choose an **Input** on the selected object and press **Start webcam** in the same
card. Advanced live Media Cues retain their **Live tag** field and webcam controls. Studio asks for
camera permission then uses the selected camera's muted video for that
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

**Camera Settings** is beside **Start webcam** in both locations. You can open it before starting
the camera and choose a requested resolution and frame rate without granting permission. Press
**Save settings**, then **Start webcam** to use those preferences. Browsers and cameras may negotiate
different values; check **Actual** in the settings window for the resolution and FPS the camera
is delivering after capture starts or settings are applied. A shared or busy camera may be unable
to switch to a larger capture format while it is in use.

While the camera is running, supported image controls appear with the ranges and modes reported
by the device. Available controls may include brightness, contrast, saturation, sharpness,
exposure, focus and white balance. Exposure time, focus distance and color temperature require
the corresponding manual mode when that mode is offered. Unsupported controls remain hidden.
Changing these settings affects the same camera stream used by both the live tag and presentation
background. **Apply** changes the active track without restarting capture. If a setting is rejected,
Studio keeps the active preview, reports the error and displays the actual values.

**Reset** clears requested resolution/FPS and restores the readable image-control values from when
the current camera stream started; it does not reset the camera's factory settings. Switching
cameras keeps resolution/FPS preferences and clears image settings specific to the old device.
All camera choices, preferences and footage remain local to the current session and are excluded
from `.ogs` files and exports. The camera must still be started explicitly from Studio.

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

<a id="modifiers"></a>

### Smart layout (modifiers)

Open **Window → Smart layout**. The compact pane docks beside Properties and can also float or open
in a separate window. Select one object, choose **+ Add Modifier**, then select a behavior:

- **Max Text Width** caps a text object's measured width. **Squeeze** compresses horizontally
  without changing letter height; **Shrink** scales proportionally, respecting Minimum Font Size.
- **Auto Size** fits an object to a referenced object or group. Choose Width, Height or Both,
  padding, optional size limits and the anchor that stays in place.
- **Auto Follow** attaches an object to a referenced edge or anchor. Right, Left, Above, Below and
  Center presets provide useful starting points; offsets control the remaining spacing.
- **Hide on Empty** reads text/image content or a data field and hides the owner or a chosen
  object/group. Whitespace handling and inversion are explicit. Numeric zero and false are not empty.
- **Grid Arrange** places the selected object's child objects (parent them in the Scene Outliner) in
  rows and columns. Set Columns, Rows (0 = as many as needed), Spread X/Y (distance between
  neighbouring cells), the start corner and whether to fill across rows or down columns. Children
  beyond Columns × Rows are hidden. Each child's own children move with it.
- **Radial Arrange** places the child objects around the object's center. Count (0 = all), Inner
  Radius, Start/End Angle (0° = right, 90° = down; a full 360° spaces them evenly, an open arc runs
  end to end) and **Point outward** with a Base Rotation. Advanced adds rings between Inner and
  Outer Radius, an Equal or Radiate (spokes) arrangement and Start from outer. Animate Start and End
  Angle together to spin a carousel.
- **Justify** aligns the combined bounds of the visible children to the object's box: Left,
  Center or Right and Top, Center or Bottom, with offsets. Place it below Grid or Radial Arrange
  so the arrangement re-centers when a child is hidden.
- **Look At** rotates the object around its transform origin so its right side (X axis) or bottom
  side (Y axis) faces another object or group; Flip and Rotation Offset adjust the result.
- **Spline Path** moves the object along a path layer. It is the same link as Properties → Motion
  path: animate Progress (◇ opens it in the Timeline), choose Follow path direction and set a Base
  Orientation that is added to the path direction, plus X/Y offsets.

To build a row like a team line-up, draw a background, parent the cards to it, add Grid Arrange
with one row and the card pitch as Spread X, then Justify → Center. Hiding a card (hide its label
too, because visibility is not inherited) closes the gap and keeps the row centered.

For a smart lower-third, cap the title's width, size its backing to the title, and attach the logo
to the backing with Auto Follow. Add Hide on Empty to hide an optional subtitle and its backing
together when the subtitle is cleared. Manual text and bound-data edits both update the result.

Each card can be bypassed, reset, duplicated, moved or removed. Duplicates start disabled to avoid
two behaviors driving the same size/position. Numeric controls have **Timeline** and **Data**
shortcuts. Reordering retains their stable animation/binding paths. Properties indicates when a
modifier drives the rendered result; authored base values remain editable, and bypass restores them.
On a bound numeric parameter, runtime data takes precedence over its animation keys.

The same dependency-ordered evaluator is included in exported playback. Cycles, missing references,
guide references and conflicting geometry drivers are rejected. Auto Size/Follow cannot also own
geometry driven by a Motion Path or Auto Layout in this first version; Max Text Width can take
part in a flow. Group references and hide targets are supported. Grid/Radial Arrange and Justify
cannot be combined with the same object's Auto Layout, and an arranged child cannot also follow a
Motion Path or another position modifier. Look At cannot be combined with an oriented Motion Path.
Radial Arrange and Look At work in the 2D canvas plane; there is no 3D depth or camera.

### Visual rules

Open the dockable **Rules** pane from the Window menu to edit ordered rules across the composition;
optionally filter to the selected object, which also lists rules on other objects that change it.
The left sidebar lists object rules with search, summaries and status. Select a rule to edit it
on the right. Rules have **Trigger (WHEN)**, **Conditions (IF)** and **Actions (THEN)** sections,
preserving the **When → Condition → Then → Action → Target** order. **Options** and **Timing**
stay collapsed until needed. Each rule has an editable name; **Active / Paused**, Duplicate and
Delete live in the rule list. Less-used commands remain in the overflow menu.

Choose **+ New rule** to create and open a rule immediately on the selected editable object, or
the first editable scene object when none is selected. Edit **When**, **Only if** and **Then** in
the main editor. New rules start with a data condition; if no data field exists, one is created
with the rule. New rules are named **Rule #1**, **Rule #2**, and so on across the template.
Use **Target** above **When** to move a rule to another editable object or group. The selector
uses the same object/group list as action targets. Conditions and actions are preserved;
implicit self actions follow the owner, applying to every member when the owner is a group.
Explicit action targets stay unchanged. A group rule runs once for data/playout events, and
pointer events on any member can trigger it. Each action's **Target** still chooses what that
action changes. Undo restores the previous owner or removes a newly created rule.

The rule list holds each rule's **Active** checkbox, **Duplicate** and **Delete** controls.
Drag the divider between the list and settings to resize them; the split is saved locally with
the UI layout. The divider also supports arrow keys, Home/End and double-click to reset.

Template lanes, entry and exit timing, shared elements and make-room behavior are authored in the
**Transitions** pane. Rules can issue Take, Update, Out and Clear commands to those lanes.

**Conditions.** A data rule's comparison sits on the **When** row, so the rule reads like a
sentence — _When Name is not empty_ — and **Only if** holds only extra conditions (**Always** when
there are none). A comparison checks a field against a value or, through the **value** menu,
another field — for example _Home score_ **Greater than** _Away score_. Operators cover equality,
numeric comparison (**Greater than**, **At least**, **Less than**, **At most**, **Between**), text
(**Contains**, **Starts with**, **Ends with**, **Is one of** a comma-separated list), emptiness, and
**Changed** / **Increased** / **Decreased**. Equality treats `5` and `"5"`, and `true` and `"true"`,
as the same value; **Aa** makes text comparisons ignore letter case. **+ Add condition** adds more
conditions, combined with **and** or **or**. Inside a runtime collection prototype, a condition on
the collection's field reads that row's own item, so each row can colour itself.

Choose **Mouse X** or **Mouse Y** in a comparison to use the pointer's position in composition
pixels, measured from the composition's top-left corner. They are available as the primary
**When** condition, an **Only if** condition, or a comparison operand. Values become available
when the pointer enters the preview and update as it moves; mouse conditions are false before
entry and after leaving. Change operators require an earlier known position. Use **Preview &
Export** or interactive exported playback to try them. They are virtual Rules inputs, not data
fields or OGraf GDD controls, and non-real-time playback has no live mouse input.

**Triggers.** Beside **Data condition**, a rule can start from the mouse. **While hovered** is a
state: its changes hold while the pointer is over the object and undo themselves when it leaves.
**Mouse enters**, **Mouse leaves**, **Mouse pressed**, **Mouse released**, **Clicked** and
**Double-clicked** happen once, and their changes stay until another rule changes them. A rule can
also start from playout: **Played in**
(the first step is reached), **Step reached** (a chosen step or any step), **Taken out**, or
**Custom action ran**. On these triggers, **+ Add condition** adds an _only if_ guard, and **after N fr**
delays the actions.

**Actions.** Choose **Show object**, **Hide object** or, on event triggers, **Toggle object
visibility**; a rule can also set bindable visual,
effect or exposed shader properties; trigger a custom action or shader-animation action; play a
Sound Event; or start an audio/video/live Media Cue. Show/hide/toggle and property actions change
the rule's own object by default; choose another object in the target menu to build tabs,
reveal panels, or winner highlights. The target menu tags each entry **object** or **group**: a
group (made with **Edit → Group**) applies the action to every object in it. **fade N fr** fades visibility and **over N fr** animates
numeric and colour property values instead of switching them.
Object actions are numbered in authored order, with Move up, Move down, Duplicate and Remove
controls. Later actions writing the same property win. Media and custom actions can overlap;
their numbers do not imply that one waits for the previous action to finish.

**Conditional size and position.** A property action offers **Position X**, **Position Y**,
**Width** and **Height** in pixels. These set the object's actual position or dimensions while the
rule holds, so changing a panel's height also resizes its masking and clipping geometry. Use
**Move horizontally** or **Move vertically** for an offset added to the animation instead.
Coordinates must be finite numbers; sizes must also be zero or more. Older templates whose rules
use `x`, `y`, `width` or `height` already use this behavior without re-authoring. Auto layout,
modifiers, masks and crops continue to operate on the resulting geometry. Explicit shared-element
values controlled by **Transitions** keep priority over a rule targeting the same channel.

**Playout actions.** In **Then**, choose **Take**, **Update**, **Out** or **Clear** from the
**Playout** section, then choose a **Lane**. Configure the lane and its templates in **Transitions**
first. These actions use the same transition planner as Preview & Export and exported packages;
entry/exit timing, make-room resizing, shared elements and **Take out with** dependencies stay in
Transitions.

| Action     | Target and result                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| **Take**   | Choose a template in the lane. It goes on air through its configured transition.                                    |
| **Update** | Update the current on-air template. An optional template selection guards the update; it does not switch templates. |
| **Out**    | Animate the lane and its dependent lanes out through their own Take out transitions.                                |
| **Clear**  | Remove the lane and its dependents immediately, without an Out animation.                                           |

Open the action's **Data** options to choose custom field values. Take otherwise uses the target
template's retained values or defaults. Update otherwise copies the triggering template's current
effective data, matching the target's field keys; custom values merge with retained target data.
Choosing custom data with no fields applies no data patch. An Update on an Off lane has no on-air
template to change. Out and Clear preserve editorial data while resetting dependent activation
intent, so taking the parent in again does not restore its dependents.

Data-condition and hover playout actions issue a command once when the rule starts matching,
without automatically undoing the command when it stops. Use a separate rule for an Out or Clear.
Event rules can delay these commands through **Timing**. Test them in **Preview & Export**;
**Try on canvas** only simulates visual object actions. A template with an active playout rule
requires coordinated set preview/export, rather than a standalone template package.

**State and events.** Data-condition and **While hovered** rules are states: their results hold
while the condition holds and revert when it stops, so a hover highlight needs one rule. Every other
trigger, and conditions that watch for a change, are events: their results stay until a later rule
replaces them. When a state rule starts matching, it takes back the properties and visibility an
earlier event set on the same object. Rules run after ordinary bindings, in authored order; when
two matching state rules set the same property on one object, the later one wins and the earlier
row shows **Overridden**. Hidden rule results participate in Auto layout's **Collapse hidden**
spacing.

**Trying rules.** The selected data rule shows **Matched** or **Not matched** for the current test
values. The editor header's preview icon opens **Preview & Export**. An event object's overflow menu also
offers **Try on canvas** for its show/hide and property actions; the list options menu's
**Reset canvas test** clears those results. Pointer rules run in the OGraf Preview and
exported real-time HTML graphic, where click/tap uses the object's rectangular bounds and hover
applies to mouse or pen; Studio's editing canvas keeps clicks for selecting and editing. If both
click and double-click rules exist on the same object, a single-click action waits briefly so a
double-click fires only the double-click rule. Playout triggers, delays, and transitions also replay
exactly in non-real-time scheduled rendering; pointer events do not, so use a playout custom action
for a deterministic or remote trigger.

### Data fields

Use **Data → Fields** to edit field definitions and values. **Data → Operator controls** provides a
searchable tree of the current template's controls, grouped by scene objects with nested object
properties and array items. Each control shows its OGraf exposure status and a checkbox deciding
whether it appears in the exported graphic's public data schema and accepts external playout
updates. Exposure is enabled by default, including for existing templates. Uncheck it to keep a
field internal: its default value, bindings, Rules, animations and Studio controls remain available.
**Required** applies only when the field is exposed.

Object and group checkboxes change all their controls together. Checked means all are exposed,
unchecked means none are exposed, and a mixed checkbox means only some are exposed; clicking a
mixed checkbox exposes all. These bulk changes include collapsed or filtered-out controls and
recursively update their object properties and array items.

The tree distinguishes a control's own checkbox from its effective status. An internal parent
field keeps its children internal without changing their individual choices; an internal item schema
keeps the whole array internal. Generated shader fields appear in the same tree; hiding one from
playout does not remove its shader control or animation. Exposure choices are saved in `.ogs`
and respected by standalone and coordinated exports.
An explicit template-level exposure choice is preserved when its field inherits a shared control's value.
When states in a coordinated lane expose different fields, their forms use conditional schemas.
Controllers that resolve these conditions show the selected state's fields; the package also
enforces the exposure policy when receiving external data.

Public updates to part of an object preserve its internal values, including nested branches left
out of the update. Exported schemas, public defaults and data examples include only exposed fields;
the graphic retains internal defaults for its own Rules and animation after loading or replaying.

### Data connections

Use **Data → Connections** for HTTP/HTTPS JSON or CSV, pasted/imported data, or the built-in
**Public markets · Coinbase + ECB** source. Map fields to JSON paths or CSV columns, choose how
missing values are handled, and enable the connection. **Update** selects the editor preview,
on-air templates in the combined preview, or both. Existing saved connections retain their
editor-only destination. Configuration and mappings are saved with the template or set.

Enabled connections continue while the pane is closed and during fullscreen preview. Matching
sources share requests. Status, last refresh and errors remain visible when you reopen the panel;
**Refresh now** requests an update. Native feed values update the running graphics in place,
without replaying a lane's update transition. Scrolling and transition timing continue; data Rules
and configured text-update effects still respond. Paused or transitioning lanes receive the latest
data when ready. Explicit Update commands retain their authored transition behavior.

The public-market source needs no API key or companion process. It supplies Coinbase USD spot
quotes and signed 24-hour changes, plus dated daily ECB FX references. Quote observations refresh
at most every 15 seconds. **Map matching field keys** connects recognized outputs automatically.
Exports remain standard OGraf: the playout controller supplies GDD updates; Studio's polling is
not embedded into the exported graphic.

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

Set the composition's **Update animation** duration and **Data arrives mid-fade** policy, then choose
a per-layer style under **Properties → Advanced → Data change transition**. Bound layers can crossfade, slide in
one of four directions, inherit the composition duration, override it, or update instantly. Unbound
backgrounds remain on screen, and only layers whose bound value really changed transition, so a
playout system can resend its complete data with every update. A text layer with **Count** or
**Roll** and **Replay on update** plays only that effect, unless you choose a style or duration for
the layer. Shader parameter fields apply at once without a fade, so dragging a slider stays smooth;
give the layer its own style if you want one there. On a layer with a Shader effect, the transition
moves the finished effect picture. **Finish current fade first** finishes each transition in order;
**Jump to newest data** ends the running transition at once with its data on air, then transitions
to the newest update, so values keep landing however fast they arrive; resending the data already on
its way leaves the running transition alone. Scheduled non-realtime rendering follows the same
policy, so a change that lands mid-fade starts when that fade ends. Exported action durations report
the longest authored layer update so playout can schedule accurately.

Each lane in a template set chooses how it shows new data under **Transitions → When its content
changes**. **Update transition**, the default, mounts the template again with the new data and plays
the lane's Update timing. **In place** keeps the template on air, so unchanged layers never dip and
no second copy of the template is built. Changed layers use their own **Data change transition**
with one data change, when the slowest has left. A layer with no length of its own takes the
composition's **Update animation**, then the lane's Update timing. A new image loads first and
replaces the old one with no blank frame; if it fails, the old image stays on air and the command
reports the error. Anything else only a new mount can load, such as a video, Lottie file or shader
source, plays the Update transition instead. The option applies to `updateAction`, a same-state
`transition.take` and a Rule's Update action. It needs a definition at version 6 or later.

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

Select one or more layers and open **Properties → Animate In / Out**. Choose a style independently
for entrance and exit:

- **Fade**: fades in or out.
- **Slide**: a short move with a fade.
- **Fly**: from or to beyond the canvas edge.
- **Drop**: falls in from above and lands with a bounce, or falls out below.
- **Wipe**: reveals from an edge, or opens from the centre.
- **Grow**: opens the box from an edge or the centre; shapes and images only, because text would reflow.
- **Scale**: grows from half size while fading.
- **Pop**: springs up from nothing with an overshoot.
- **Spin**: turns a quarter turn while fading; the arrows choose clockwise or counter-clockwise.
- **Focus**: fades out of a blur; it needs the layer's built-in blur effect.

The arrows choose where the motion comes from, or where it goes. Set the duration in frames and a
feel (Smooth, Gentle, Snappy, Overshoot, Bounce, Elastic, or Linear), then use ▶ to preview that
side. With several layers selected, **Stagger** spreads them out by that many frames, in the chosen
order (left to right, right to left, top to bottom or bottom to top). The first layer in that order
arrives first and leaves first. A stagger needs room in the span, so Studio shortens the duration
when the cascade wouldn't fit.

The editor writes ordinary keys between Start and the first Step, or between the last Step and End.
These are x/y, opacity and blur, plus Scale, the Wipe edges, width/height or rotation when the style
uses them. These keys remain editable on the Timeline; choosing another preset replaces only that
side's motion. **None (cut)** holds the on-air pose, while **Custom keys** warns that choosing a
preset would replace hand-authored keys there.

### Animation graph editor

Timeline shows either **Keys** or **Graph**, one view at a time. Selecting an animated numeric
property opens its value-over-time graph in place of the keyframe rows; **Keys** switches back to
the keyframe view, and **Graph** opens the curve manually. Both views share the ruler, zoom,
horizontal scroll and beginning/end markers. The channel navigator stays on the left and the
Keyframe editor stays on the right.

The curve samples the same easing and custom Bézier data used by playback. Drag a graph key horizontally to change its
frame and vertically to change its value; Control/Command-click adds keys to the existing selection.
The selected incoming segment keeps the detailed Bézier-handle editor and numeric controls in the
Keyframe editor.

With a numeric channel selected, right-click empty graph space and choose **Add keyframe here**.
The horizontal position sets the nearest whole frame within the timeline; the vertical position
sets the value, respecting the property's limits. The new key is selected without moving the
playhead, and one Undo removes the insertion. The action is disabled for locked objects or a frame
that already has a key; it never overwrites an existing key.

Right-click a graph point or near it and choose **Delete keyframe**. A curve right-click also uses
a single visible selected key when no nearby point is found. If no single key can be targeted,
**Delete keyframe** is disabled. For keyboard access, focus the key and press **Shift+F10** or the
context-menu key to open the same menu. Deletion targets that key without moving the playhead.
**Graph** stays active after deletion, including when the last key is removed;
choose **Keys** when you want to return to the keyframe view.

### Mixed text styles and languages

Text properties provide Automatic, Left-to-right, and Right-to-left base direction plus a BCP 47
language tag for browser shaping and accessibility. **Enable mixed styles** divides authored text
into ordered editable runs; each run can override color, weight, italics, and font family while the
layer retains one transform, outline, animation, and data identity. A content binding preserves
styled runs while its value matches the authored text. New operator text replaces them with plain
text to avoid applying stale character ranges.

### Native ticker

Choose **Ticker** in the add-object toolbar. Its layer box is the scrolling viewport; resize or
animate that box using the normal layer controls. In Properties, add and reorder text, logos,
Lottie animations, image sequences, shapes or shaders. Each item has an explicit width and an
optional height. Set widths to fit representative content so live updates retain a stable layout.

**Speed px/s** uses pixels per second at every output FPS, including fractional rates.
**Scroll** defaults to right-to-left travel; **Text direction** separately controls automatic, LTR or
RTL shaping for Arabic, Hebrew and mixed languages. **Entry fade px** and **Exit fade px** make
content dissolve transparently over the graphics underneath. Their sides follow scrolling
direction. **Fade softness** adjusts the curve, and **Background** is independent of those fades.

**Apply updates** defaults to **Next appearance**. Editing text, artwork, effects or an item width
keeps copies already entering or on screen unchanged until they leave. Studio prepares the new
version offscreen for its next entry. New items enter in feed order; removed items finish their
current pass and do not return. A short repeating feed can briefly show both old and new copies.
Use **Immediately** when an on-screen correction is intentional.

Properties and preview/playout controls show a **pending** count while changes wait for entry,
exit or resource preparation. Hover its detail for changed, added and removed counts or a
preparation error. If scrolling is stopped, changes may remain pending until it resumes.
Changing a feed does not restart scrolling, delay its Rules or alter authored transitions.

Text supports normal fonts, paint and Text FX. Images retain transparency, fit and source crop.
Lottie, image sequences and shaders use the same content clock as scrolling. Optional item
Fade, Rise or Scale motion runs from that clock, while normal Start/Step/End animation controls
the whole ticker. Compatible scene objects can be copied into an item with their element and
effects; this creates an editable copy, not a linked component instance.

Ticker shader usages appear in **Resources → Shaders**. Data bindings address item IDs rather
than ordering, for example `items.headline.content` or `items.logo.src`, so reordering retains
their links. The same ticker works in single-template and coordinated OGraf exports. Existing
text-crawl templates remain unchanged.

For an external feed, bind an array data field to **Items**. Send complete item definitions with
stable IDs. An existing ID updates that item; a new ID inserts it; an omitted ID removes it.
Individual bindings such as `items.headline.width` can also update an item's reserved width.

Playback prepares upcoming content and repeat seams. Extremely dense feeds may exceed the
2048-instance preparation limit; increase item widths or gaps if Studio reports that limit.
Smoothness also depends on shader load, hardware and display cadence. For broadcast review,
test the actual exported package at its output FPS and keep the test window visible.

### Clocks and timers

Choose **Clock / Timer** from the add-object toolbar. It has the same font, alignment, fill,
outline and effects controls as text, with a **Clock / Timer** section in Properties.

- **Clock** displays system time. Choose local time, UTC or an IANA zone such as `Europe/Istanbul`,
  12- or 24-hour display, and AM/PM casing.
- **Count up** starts at the initial value and can stop or loop at an optional limit.
- **Count down** starts at the initial value and stops at zero, continues into negative overtime,
  or loops. Whole-second displays round up while time remains.

Choose a format such as `hh:mm:ss`, `hh:mm`, `mm:ss`, `ss` or `hh:mm:ss.SSS`; control the leading
zeros independently. Timers show total minutes or seconds when larger units are omitted, so
`mm:ss` can show `90:00`. Custom formats accept `h`, `m`, `s`, `d` (or doubled forms), `SSS` for
milliseconds, `A`/`a` for meridiem, and `[literal text]`. Prefix and suffix add surrounding text.

**Automatic** uses the system clock or runs the timer. Timers have Start, Pause, Reset and Restart
preview controls, **Auto-start** on Take In, and **Pause when off air**. Reset returns to the initial
value and pauses; Restart returns to the initial value and runs.

Choose **Manual (external data)** to display a supplied time without advancing it. Set a fallback
and choose an **External value** data field; connect that field to your feed in Data or change it
from Preview & Export. Numeric values are milliseconds. Clock fields also accept `14:30:05`,
`2:30 PM`, or an ISO date/time with an explicit offset, such as `2026-01-01T14:30:05Z`. Timer fields
accept `mm:ss` or `hh:mm:ss`, optional milliseconds and a minus sign for overtime. An invalid feed
value leaves the fallback visible. Switching back to Automatic preserves the field binding for
later use.

Operators can also change how a clock or timer behaves from data, while it's on air. **+ Add
binding** offers **Time format** on both, **Time zone**, **Hour cycle (12/24)** and **Show AM/PM** on
a clock, and **Timer duration** and **Timer end behaviour** on a timer. A Select field with a value
map turns these into plain choices, such as a _Time zone_ list or a _Run into overtime_ toggle.

- Changing the display never disturbs the timer. Changing the end behaviour keeps it running.
- A new duration resets the timer to that value and rearms its alarms. It keeps running if it was
  running and stays paused if the operator paused it.
- Durations are milliseconds, `mm:ss` or `hh:mm:ss`. A value the setting can't take, such as an
  unknown time zone, leaves the authored setting on air.

Use real-time output for these on-air setting changes. Scheduled duration and end-behavior updates
have not yet been certified for standalone non-real-time rendering.

Choose an effect in **Update text FX** and enable **Replay on time change** to animate displayed
clock or timer changes. Keep the animation shorter than the update interval.
System clocks use real time during live playback; saved reference time keeps offline frame
captures and scrubbing repeatable. Automatic timers use elapsed time rather than counting ticks.

#### Alarms

In **Clock / Timer → Alarms**, use **+ Add alarm** for each threshold. A game-show countdown can
have a warning at **00:05** and an ending at **00:00**. Each row has its own checkbox, time and
**Edit rule** button. Edit opens the same record in the unified Rules pane, where you choose
conditions, actions and targets. A new alarm has no action until you configure one.

Alarms fire once per run on a value crossing, including skipped frames or external data jumps.
Reset/Restart rearms them; Pause/Resume retains their fired state. Manual Reset/Restart rearms
alarms without replacing the external value. Disabling an alarm keeps its configuration.
Countdown rows appear from higher thresholds to lower ones; count-up rows use ascending order.
Time-of-day mode retains the settings without running these timer alarms. Playback and testing
remain in Preview & Export; editing and scrubbing do not issue live operator commands.

### Transitions

Transitions decides how the templates of a set go on and off air together. Open the
**Transitions** tab (docked beside Timeline, or from **Window → Transitions**). Links that used to
open Transition Logic, including `?pane=transition-logic`, open Transitions.

#### First run

If the set has no playout yet, Transitions proposes one from the templates:

1. **Lanes.** Templates that cover much of the same area replace each other in one lane, such as
   three lower thirds. Templates elsewhere on screen, such as a ticker, get their own lane and can
   be on air together with it. Rename a lane, or move a template to another lane or a new one.
2. **Stays on screen and morphs.** Components placed in two or more templates of a lane are
   checked. They stay on screen and glide to each template's layout instead of fading out and in.
3. **House style.** A style and a speed for every moment of every lane.

**Create playout** builds it as one undoable step. Each template's values for an element come from
where that template places it, so nothing is typed.

#### The map

Select a lane from the **Lanes** list to show its controls and transition grid; the list follows
drawing order, with the top lane first. The selected lane shows its templates as thumbnails (their **⋯** menu moves
one to another lane or removes it), **+ Add template**, and the elements that **Morph
automatically**, with **×** to stop keeping one on screen and **+ Keep a component on screen…** to
add one. Edit the lane's name in its header, use **↑**/**↓** to change drawing order and **×** to
remove an empty lane. **+ Add lane** adds one.

**Take out with** links a lane's lifetime to another lane. For example, choose **Lower third**
on a ticker that should leave with its lower third. The parent's **Out** also plays each dependent
lane's own Take out; **Clear** removes them immediately. This follows dependencies through multiple
levels. Each lane is **Independent** by default; a lane cannot follow itself or its descendants.
Taking the parent in again leaves its dependents Off until you take them in explicitly. Their
editorial data is retained, but previous active/prepared selections are reset. A dependent Take is
rejected while the parent is leaving. This setting is separate from drawing order and making room;
leave it Independent when the ticker should remain on air after the lower third leaves.

For a takeover across lanes, expand **Take out before entering** under the incoming template's
thumbnail and check the lanes that must leave. For example, on **Breaking**, select **Headline**,
**Second line** and **Header**. Breaking is prepared first, then the selected lanes and their
dependents play their own Take out timings. Breaking enters only after they are Off. Unselected
lanes, such as the channel bug and ticker, stay on air. Taking Breaking out leaves those earlier
lanes Off; their data is retained for the next manual Take. Updating the same on-air template does
not repeat the takeover. To let a normal headline replace Breaking, check **Breaking** in that
headline's own **Take out before entering** list. Both directions can be authored independently.
A reverse Take prepares first and waits for Breaking's Out; it never restores a previous second
line or header automatically. If preparation fails, the current output stays on. Missing lanes,
duplicate targets, self references and targets whose dependents include the incoming lane are
rejected.

Below, **Every moment in this lane** is a grid: rows are where the lane comes from (Off, then each
template) and columns where it goes (each template, then Off). Each cell is one moment: **Take
in** from Off, **Update** from a template to itself (new data), **Switch** to another template and
**Take out** to Off. A cell shows its style, speed and length, with bars for when the old content
leaves (orange), the new content arrives (blue) and the elements morph (green). **Custom** marks a
cell with its own timing; every other cell follows its lane. Select a cell to see a summary, then
**Open on stage**, or double-click it.

Expand **Checks and lane coordination** for **▶ Play the show**, **Checks**, and **Together on air**
for each pair of lanes.

#### Shaping a moment on stage

The stage plays the moment with the exported coordinated player: Play runs real playout, and the
slider scrubs to any frame. **⇄ Reverse** shows a switch the other way round. Below the stage, the
timeline has a row for each part. Drag a bar's end to change its length, drag a movable bar (new
content, room) to move it, or click a row to jump there. **What morphs** lists every element
property that changes, with its values in both templates.

The inspector sets:

| Control      | Choices                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Style        | **Morph** (elements glide, content crossfades), **Authored animation**, **Slide**, **Wipe**, **Sequence**, **Dissolve**, **Cut** |
| Speed        | **Snappy** 0.45 s, **Natural** 0.64 s, **Gentle** 0.90 s                                                                         |
| Feel         | **Smooth** (ease in and out), **Settle** (ease out), **Even** (linear)                                                           |
| Use this for | **Every** moment of this kind in the lane, or **Only** this cell. Choosing the lane again removes the cell's own timing.         |

**Exact frames** shows the frame fields for when old content leaves, when new content arrives and
for how long, how long elements morph, and the hold after.

**Incoming animation** and **Outgoing animation** choose motion independently for a Take in,
Take out or template switch. **Transition style (default)** keeps the selected style's behavior;
**Template animation** plays that side's existing layer tracks without an extra whole-content
fade. Other choices use the same built-in Animate In/Out presets and compatible installed
animation plugins. Direction, distance, easing and plugin controls appear where applicable;
the existing incoming/outgoing timing fields set duration.

Built-in/plugin overrides move the template's non-shared content as one unit, without rewriting
its layer keyframes or playing its authored entrance/exit twice. **Shared objects still morph**
between layouts. Score/text updates keep their existing update behavior rather than replaying an
entrance. Retained plugin definitions stay pinned in the set, so a pack update/removal does not
silently change playback. Exports bake ordinary tracks and need no installed animation pack.
These selectors require Transition Logic version 5; older definitions keep their previous behavior.

**Move elements** parks the stage on the last frame and outlines the lane's elements where they
land. Drag one to move it. The new position is kept as a deliberate difference from the template's
layout; Checks doesn't report it as drift.

#### Together on air

Choose a lane pair to see both on screen. The status shows whether the top lane covers the other
and by how many pixels; the list shows this for every template.

The stage outlines the elements that stay on screen in the covered lane. Select one and drag a
corner to resize it; its anchor stays in place, and the size applies to every template of the lane
while the other lane is on air. Under **Resize in** _lane_ choose the object, its exact **Width**,
**Height** and **Anchor** (corners, edge centers or center), and **Reset size**. Choose whether to
edit when the other lane **appears** or **leaves**, and its **Start** and **Duration**; the
timeline's **Room opens/closes** bar can also be dragged. **Make room first, then show** reserves
space before the other lane enters and restores it after it leaves; **Both at once** resizes while
it appears. When lanes clash, **Clear it automatically** shortens the tallest element and lifts
what sits below it.

Several lanes can adjust the same object: second line and header can each grow a panel, while a
ticker lifts it. Their active adjustments add together using each lane's own timing; one leaving
removes only its contribution. An explicit template pose is the starting value, followed by these
layout adjustments. The editor checks the combined limits across every template and rejects sizes
that could become negative or values that could overflow, even when each adjustment alone is safe.

Only elements that stay on screen can make room; each template's own content keeps its place.
Objects with rotation or a transform parent show why they can't be resized yet.

#### Play the show

**▶ Play the show** rehearses a rundown with real timing. It starts with every template of the
bottom lane in turn and the other lanes going on and off; each step uses the transition that would
really play and holds briefly on air. Select a step to jump there, **×** to remove it, or add a step
for any lane (a template, or **Take it off**). **Reset rundown** restores the starting rundown.

#### Checks

| Check                                 | Means                                                                 | Fix                                                |
| ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| _Lane_ covers _lane_                  | Two lanes overlap when on air together and nothing makes room.        | **Make room…** opens Together on air.              |
| _Element_ doesn't match its templates | A stored value differs from where a template places the element.      | **Use template values**, or **Keep these values**. |
| Content runs off the frame            | Part of a template reaches past the frame edge while on air.          | Adjust the template.                               |
| _Element_ isn't in every template     | A template doesn't place the element; it uses its Off position there. | Place it in that template.                         |
| A moment has no timing                | Two timings claim a moment, or a timing is missing.                   | **Open** the moment and pick a style.              |

Every change saves at once as its own undoable step. If an older unapplied draft exists, a banner
offers **Apply it** or **Discard it**. **Turn off playout…** at the end of the side column removes
lanes and timings but keeps templates and components; it can be undone. Save the template set to
write the playout to `.ogs`.

#### MCP authoring

MCP integrations can apply a complete definition through **ograf_update_template_set** with
`operation:{type:"set_transition_logic",definition}` and the latest set revision. Template and
component references are validated before one undoable edit. An older unapplied draft must be
applied or discarded first. Use `definition:null` to remove it; removal or replacement with a
different definition ID requires `confirm:true`. A loaded live playout session keeps its existing
snapshot until explicitly reloaded.

#### Behavior preview

A moment's **▶ Preview** uses the existing **Preview & Export** viewport. It uses the current
definition and unsaved template edits, including the affected graphics and elements that stay on
screen. The compact data fields control the selected graphic. Fullscreen shows the same combined
output and starts with its data panel hidden. There is no additional preview-mode selector.
Selecting another template restores its ordinary lifecycle preview. Behavior preview is isolated
from MCP live output and does not export a package.

#### Live playout through MCP

MCP integrations use **ograf_get_playout** to read the session and **ograf_control_playout** to
send `load`, `prepare`, `take`, `update`, `out`, `clear` or `unload`. Commands require the playout
revision and a unique request ID. Admission is immediate; inspect command status/readiness before
assuming completion. Reusing an identical request ID does not execute another take. Playout
revisions are separate from authoring and template-set revisions.

`load` snapshots the applied definition and current template edits, initially Off. Prepare stages
resources and data; Take uses the selected state or prepared snapshot; Update changes on-air data.
An Update with `mode:"in-place"` patches the current graphic without starting a lane transition.
Omit `mode`, or use `mode:"transition"`, to retain the authored update transition. An optional
`stateId` guards against updating a different state. This works for the separate live session and
`target:"preview"`; the preview target accepts Update only, after taking graphics through Studio.
Out follows the authored route, while Clear removes output immediately. Editing or switching the
authoring template does not replace this session. Load again to apply changes, or Unload to stop it.
The session remains alive while Studio is open and is separate from the selected-template preview.

#### News example

The independent news demonstration is available at `/transition-logic-news.html` on the Studio server. It contains
Correspondent, Headline, Breaking news and Ticker templates, with a persistent shared panel, logo
and clock. Taking another lower third changes the content and panel geometry while the shader
sheen and clock continue. The ticker has its own playout layer.

Ticker text scrolls continuously from right to left inside a clipped viewport while its label
stays fixed. On ticker entry, the lower third first reserves its 62-pixel row and raises the clock,
then the ticker appears. On exit, the ticker disappears before the lower third expands into that
area. Ticker data updates keep the reserved space. The same make-room settings are included in the
editable source and exported package. Change the offsets under the **Ticker** layer's **Make room
in other layers**, and the timing in its **Take in** and **Take out**.
A separately timed Make room or Restore room row uses Transition Logic definition v3; existing
v1/v2 definitions remain readable and keep their timing until you add one.

The controls support Take, data update, Out and immediate Clear. Requests made during a transition
replace the pending request; the current transition finishes first. An incoming graphic must be
ready before it takes over. The preparation-failure control demonstrates retaining current output.
Replay scrubbing reconstructs the session from its event log.

**Download .ogs** saves the editable templates, linked component sources and the versioned
transition definition. Template-set source schema 5 preserves these definitions and reads older
sets. Opening or selecting a template in Studio changes the editing selection; it does not take a
graphic to air.

Shared-state animation supports numeric layer transforms. Legacy `.ogp` cannot preserve the
coordinator; keep the editable template set in `.ogs`.

#### Coordinated package export

In **File → Export…**, choose **Template set** and select the output format. When the set has
Transition Logic, the OGraf ZIP is one coordinated `.ograf.zip` containing the controller,
referenced templates, shared components and their resources. **Standalone HTML** plays the
coordinated set in a browser. You can also use **Export package…** or **Download package** in the
Transitions tab's toolbar. Apply or discard any unapplied transition draft before exporting. Studio
snapshots current edits and certifies the exact package before saving.

The exported graphic starts Off. Its public data is a `slots` object: each slot contains a
`stateId` and that template's `data`; the empty string `""` selects Off. The manifest supplies default selections and typed data
schemas. Standard **play** takes the selected states; **stop** takes all slots Out. Updating data
on an active slot requests its next appearance through the same transition planner.

Initial selections form a compatible baseline: lanes requiring another lane fully On start Off,
and mutually conflicting states are not selected together. Independent lanes choose a compatible
state in lane order. The custom **Take** form still suggests a valid state for its chosen lane;
that suggestion does not activate the lane during startup.

Real-time **Load** privately prepares resources for the valid selected startup scene while lanes
remain Off. A matching first **Play** reuses successful preparation after normal admission. This
does not create an explicit Prepare state or satisfy a lane's On prerequisite. Changing selected
states or data, superseding commands, reload and disposal discard stale preparation. Invalid
selections still fail on Play; failed preparation is released so Play can retry through its normal
readiness and error handling. Non-real-time playback keeps its existing behavior.

When the operator explicitly selects both a parent and its dependent lanes, **play** plans the
whole selection and prepares its resources before changing output. It waits for required exits
and completed parent entrances before starting the next stage. Conflicting selections or missing
selected prerequisites are rejected without changing on-air selections. The same stage timing is
used for real-time playback and non-real-time scheduled rendering. A newer playout command can
supersede unfinished stages; canceled stages do not return later. Individual **Take** commands
continue to require their prerequisites already On.

The coordinator has one On-air step. A plain Play after that step advances Out; use
`playAction({goto:0})` to reapply the current On selection explicitly. Export certification checks
successful default startup as well as the API contract; a controller's green schema validation
alone does not prove that a requested scene played successfully.

`skipAnimation:true` skips authored transition waits; resource, rendering and GPU work still take
time. In OGraf Devtool, use the complete exported multilane scene: await successful Load, time and
await the first Play from Off, then check the response and capture ready output. Keep cold first-Play
measurements separate from warm replay and recheck after state/data changes. Latency depends on
the template and host; no single timing bound applies to every graphic and GPU.
The Devtool's detached-element latency check and visibly mounted playback should both be checked;
a slow command response alone does not establish dropped display frames. Text that already fits
its box avoids repeated layout measurements while retaining the same fitted size and minimum-size
behavior. Font loading, shader rendering and final-frame readiness still complete before success.

For real-time batch Play with `skipAnimation:true`, prepared independent lanes in the same
dependency stage share a final coherent frame and readiness pass outside nested Rules dispatch.
Each lane retains its request, ready and advance events. Rules keep their order after stage
readiness, and parent Rules or a superseding command can cancel later child stages. Direct Take,
animated playback and non-real-time replay keep their existing behavior.

Playout integrations can address individual slots through these OGraf custom actions:

| Action                                     | Payload                     | Result                                                                   |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------ |
| `transition.take`                          | `{slotId, stateId, data?}`  | Prepare and take a state, or update the active state                     |
| `transition.patch`                         | `{slotId, stateId?, data}`  | Patch an on-air graphic in place, with an optional active-state guard    |
| `transition.out`                           | `{slotId}`                  | Animate a slot to Off                                                    |
| `transition.clear`                         | `{slotId?}`                 | Immediately clear one slot, or all slots if omitted                      |
| `template.action`                          | `{slotId, actionId, data?}` | Run an authored action or generated timer command on the active template |
| `loop.pause` / `loop.resume` / `loop.next` | `{slotId, groupId}`         | Control one timed loop group while other graphics continue               |

The package includes an operator guide with the actual slot/state IDs and example payloads.
External quote feeds should use `transition.patch` to merge changed values into the existing
graphic. It keeps lane transitions, paused state and continuous animation intact; ordinary data
Rules and configured text-update effects still run. It rejects Off or leaving graphics. An entering
graphic can receive a patch without changing its transition deadline. A prepared replacement is
not retargeted by a patch to the current graphic. A new image loads before the patch applies, so it
never blanks, and a failed image leaves the old one on air and returns an error. Standard
`updateAction` and `transition.take` continue to use authored update transitions, unless the lane
is set to update **In place**. Scheduled `transition.patch` actions replay during non-real-time
rendering and backward seeks.
Shared instances remain mounted between takes. Incoming resources must be ready before they
replace the current output; newer pending requests replace older pending requests. The current
transition finishes first. The coordinator plays each layer's authored Start-to-first-Step IN
and final-Step-to-End OUT within the selected transition timing, including masks and effect tracks.
Retained shared elements morph without replaying their entrance. Independent loops, shaders and
text/clock effects continue. Timed loop groups expose a hold-duration field and independent
Pause/Resume/Next controls in Preview & Export.
Generated clock/timer Start, Pause, Reset and Restart commands are available through
`template.action`. The dropdown labels identify the template and timer; take that template on
air before issuing its command. Start resumes, Pause holds the value, Reset restores the initial
value and pauses, and Restart restores it and runs. System clocks ignore timer commands. Manual
Reset/Restart rearms alarms without replacing the feed. These commands keep transition timing and dependencies; their
non-real-time event times replay deterministically during seeks.
Choose **Authored animation** as the transition style to use those layer tracks without an
additional whole-graphic fade. Existing Dissolve, Slide and Wipe styles keep their chosen overlay motion.

Non-real-time packages accept scheduled actions and deterministic `goToTime` seeking, including
backward seeking. Coordinated Rules support data conditions and change events, pointer input
(including once-per-entry hover commands), Played in, the first Step reached, and Taken out.
Take/Update/Out/Clear commands can be delayed on event rules. Pointer input requires real-time
playback. Template custom actions, Custom action ran triggers, template-local set-data,
custom-action chains and animated Rule properties are supported. Export requires matching output
dimensions and frame rates. Audio/media cues, shader/media Rule side effects, custom-action loop
activation and loops outside the first on-air step remain unsupported
and are reported before saving. Use the original
`.ogs` for editing; Import OGraf cannot reconstruct a coordinated template set from its runtime package.

### Text animation presets

Select a text layer and open **Text animation** in Properties, or **Update text FX** for a clock or
timer. Choose **Typewriter**, **Fade in**, **Rise in**, **Pop in**, **Word reveal**, **Flip**, **Blur in**,
**Rotate in**, **Stretch in**, **Count up**, **Count down**, **Roll up**, or **Roll down**. Typewriter reveals letters or words in steps and can draw a blinking
bar or block cursor. Fade in changes each segment's opacity; Rise in moves it upward while fading;
Pop in grows it with a small overshoot; Word reveal slides each word upward through its own mask.
Flip turns each segment around its horizontal axis; Blur in sharpens it while fading in; Rotate in
turns it from a quarter rotation; Stretch in expands it horizontally. These reveals can split by
Unicode-safe Characters or Words. Word reveal always splits by words.

**Count up** and **Count down** animate a single number and finish at the value written in the text.
Set **From** to choose the starting value, or leave it empty for an automatic start. Currency or
other surrounding text, decimal precision, thousands separators and leading zeros are retained.
Text containing multiple numbers, such as `12:34`, stays unchanged; use a single-number clock format
when applying these effects to a clock/timer. Counting uses the same Duration and Replay controls.
Choose **Digit motion → Roll up / Roll down** to combine counting with rolling digits.

**Roll up** and **Roll down** move the previous and new characters through a clipped vertical window.
Enable **Replay on update** (or **Replay on time change** for clocks) to roll changed digits while
unchanged characters stay still. These effects work with complete clock formats such as `hh:mm:ss`.

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

**Resources → Shaders** lists saved library shaders and every applied **Fill**, **Outline**, and
shader **Effect**, including bypassed effects and shaders inside component definitions. Applied
entries identify their object and destination; displaying them does not create another library copy.
**New Shader** opens a draft without adding a canvas object.
Choose **Save shader** to keep it in the project, then drag it onto the canvas and choose Fill,
Outline or Effect when needed;
**Cancel** discards the new draft. Unused project shaders are retained in editable `.ogs` files.
Entries have a thumbnail, **Edit**, **Load**, and a remove icon. **Edit shader** in an object's
**Properties** also opens the dedicated shader editor; parameter controls remain in Properties.
The editor has an
editable shader name and a larger animated preview. Changes stay in the window until **Save
shader**; **Cancel** discards them. **Preview shader** tests source changes in the preview, and
loading a file opens a draft. Editing an applied entry changes only its identified Fill, Outline,
or Effect. Library entries and applied copies stay independent, even when their source is
identical. Edits preserve compatible parameter values and keep the current canvas selection.
Drag a shader entry from Resources onto an object's **Fill** or text **Outline** row to apply a
copy of its current source, settings, name, and controls. The destination highlights while dragging;
the original shader stays independent.
Dropping on the canvas opens the Fill/Outline/Effect chooser instead of applying immediately.
Effect-only resources are labelled **Effect shader** and preview against a temporary reference
image. That image is never saved, and Fill/Outline remain unavailable until the shader has its
own suitable input. Effects always take their input from the layer's stack.
Removing a saved library shader keeps copies already applied to objects. Removing an applied Fill
or Outline detaches that shader; removing an applied Effect removes only its stack entry. Text
returns to solid paint, shapes to a solid fill, and media to its original pixels. The Fill and
Outline controls in Properties also offer Solid or Original pixels. Use **Undo** to restore a change.

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
Uncheck the generated field in **Data → Operator controls** to keep it internal while
retaining the shader control, default, bindings, Rules and animation.
Changing to Shader detaches incompatible whole-fill and gradient-stop bindings while keeping
their data fields and Brand Kit tokens available.
Text outline parameters use `strokePaint.parameters.NAME` and independent fields, so the same
parameter name can appear in both shaders without sharing its value.

Exposed shader controls can also own keyframes and local loops. Expand the object in **Timeline**
and use **+ Property → Fill shader** or **Outline shader** to choose a control; explicit key
creation does not require Auto-keyframe. Move the playhead and adjust the control in Properties,
or edit a selected key's **Value** in the Keyframe editor. **Edit → At playhead** records changes
to keyed controls at that time; **Whole animation** shifts their existing values together.
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

**Properties** lists what most layers need first: Transform, Animate In / Out, the layer's
content, Data Bindings, Effects, and a summary of its Visual rules with **Open Rules**. Brand
tokens, compositing and masks, layout relationships, data change transitions, and semantic intent
sit under **Advanced**; typing in **Filter properties…** still finds them. The built-in blur and
drop shadow stay out of the Effects list while they are off; **Show built-in…** lists them.

Use **Properties → Animate In / Out** to add editable entrance and exit motion; see
[Animate In / Out](#animate-in--out) for all styles, timing and stagger controls.

AI proposals appear on the main canvas. Review frames and compare the original, then use
**Accept changes** or **Reject** in **AI Assistant**. Acceptance creates one undoable history entry.

### Your first keyframe animation

1. Add a rectangle and place it at its starting position. A new blank template starts at time zero.
2. Click **Key transform** in Timeline to record the starting pose.
3. Enter **1s** in Timeline's **Current time** field, press Enter, and move the rectangle.
4. Press Stop to return to zero, then Play. The rectangle moves to the new position and holds it.

For an OGraf entrance, place the **On air** cue at the completed entrance pose (1s in this
example). Moving the cue changes the playout pause boundary; **Length** retimes animation keys.
Use **Stop at Steps** or **Preview & Export** to check the pose that playout will hold on air.

New objects start with one static pose. OGraf **Before / On air / After** markers stay separate
from the object's property keys, so they do not insert an unintended pause or return pose.
Previously authored keys remain editable. Diamonds beside X, Y, Width, Height, Rotation and Alpha
are hollow for an unkeyed frame and filled when that property has a key at the playhead. Their
accent color indicates that animation is enabled. Clicking a filled diamond removes that key;
removing the final transform key keeps the currently sampled value as the static pose.

To clear a whole channel in one action, select **Position X**, **Position Y**, **Alpha** or another
property in Timeline and click **Reset [channel] animation** in its editor. The same command is in
the channel name, track and keyframe right-click menus, and in a Properties diamond's right-click
menu (**Shift+F10** also opens that menu).

Reset samples the authored value at the current playhead (or the displayed phase of an active
editor loop), removes that channel's main-timeline and local-loop keys, and keeps the sampled
value as its static setting. Other channels and loop tracks are
preserved, and Undo restores the reset in one step. Right-clicking a different time does not change
the sampling time. Data bindings, Rules and layout modifiers remain active. Scale and wipe-only channels return to
their neutral values; unlink a channel managed by shared lighting before resetting it.

**Properties → Transform → Edit** defaults to **At playhead**. Changing an animated property
records a key at that time, even with Auto-keyframe off; changing a static property changes its
static value. Choose **Whole animation** to move an existing animation's values together while
keeping its key times. The heading states the editing time or whole-animation scope.

**Auto-keyframe** automatically starts animation on static properties as they change. It is off
by default and resets when opening or creating a project. Explicit diamond clicks, **Key
transform**, property-track keys, double-click/context-menu inserts, loop keys and **+ Step** work
with Auto-keyframe off. With a property selected, the key button adds a key for that property;
**Key transform** deliberately captures all transform properties.

Timeline Play is continuous by default. Enable **Stop at Steps** for playout rehearsal, where
playback waits at each OGraf Step for another Play. This preference does not change exported
playout behavior. With the timeline focused, **Space** toggles play/pause and **Left/Right Arrow**
steps one frame; **Ctrl/Cmd+Left/Right** jumps to a neighboring keyframe.

The **Current time** field accepts seconds, milliseconds, frames and timecode, such as **1s**,
**500ms**, **25f** or **00:00:01:00**. Plain key selection seeks to that key; modifier selection
keeps multi-selection available. **Keys** and **Graph** are exclusive views. Selecting an animated
property switches the keyframe rows to **Graph**; **Keys** returns to the keyframe view, and **Graph**
opens it manually. The ruler, zoom, horizontal scroll, left channel navigator and right Keyframe editor
remain shared. Graph axes stay fixed during a drag, and releasing commits one undoable
time/value edit. Property easing applies to the selected property's key. Deleting graph keys keeps
**Graph** active, even when the channel has no keys left.

For vector points and handles, see the [path-editing guide](../skills/ograf-authoring/references/path-editing.md).
Clicking blank canvas keeps path editing active. Choose **Done** or press **Escape** to finish.
For recent changes, see the [0.31.0 release notes](releases/0.31.0.md).

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

**File** groups creation, opening/import, saving, and export in that order, with separators between
groups. Template and template-set actions appear together. **File → Export…** opens Preview & Export.

**Edit** has Undo, Redo, Cut, Copy, Paste, Duplicate, Delete, Group or Ungroup, Select all, and
Deselect all, with the same shortcuts on the canvas (**Ctrl+X/C/V**, **Ctrl+G**,
**Ctrl+Shift+G**). Text fields keep their own copy, paste, and undo. **Window → Workspaces → Default** restores the original panel arrangement.
**Help** lists every keyboard shortcut, links to this guide, and shows the
version.

## Moving dialog windows

Studio's dialog windows, including **Settings & Preferences**, save/export, resource editors,
plugin details, Camera Settings, workspace management, keyboard shortcuts and import windows,
can be moved by dragging an empty area of their header. Buttons, inputs and other controls in
the header remain interactive. These windows are movable within their current browser window;
they do not become dockable panes.

Tab to the header and use the arrow keys to move it by 10 pixels, or hold **Shift** for 50-pixel
steps. Press **Home**, or double-click an empty part of the header, to restore its initial
position. Dragging and resizing the browser keep the window reachable within the viewport.
Movement lasts while that dialog remains open; closing and reopening restores its initial
position.

Dialog positions are local interface state. They are not saved in templates, template sets or
workspace presets. Existing dockable panes retain their docking, floating and detached-window
behavior. Embedded plugin regions remain part of their containing pane, and operating-system
file pickers use the operating system's window controls.

## Workspaces

The **Layout** dropdown in the menu bar switches between **Default**, **Essentials**, **Design**,
**Animation**, **Data & Rules**, **Dual Monitor**, and your saved presets. The selected name shows
**(modified)** after you rearrange panels. **Window → Workspaces** offers the same layouts together
with Save, Reset and Manage commands. A workspace includes panel visibility, dock groups, tab
order and active tabs, panel sizes, floating panes, and detached window positions and sizes.

Choose a pane from the **Window** menu to open it as a floating window centered in Studio. You can
then drag its title bar to move or dock it wherever you need.

Drag a pane tab or a floating pane's title bar to rearrange it. The outer edge guides dock a pane
outside the other regions: the bottom guide spans the full workspace width, while the left or right
guide can span the full workspace height. The most recently chosen outer bottom or side guide owns
the shared corners; that choice is saved with the workspace. Drop near an existing group to place the pane before or after it, or
drop on the group's tabs to combine them. The blue preview shows the destination. Drag the dividers
to resize regions and groups; their sizes are remembered with the workspace. Press **Esc** while
dragging to suppress docking.

Use **Save Workspace As…** to name the current arrangement. **Update Current Workspace** replaces
a custom preset with the current arrangement; built-in presets stay available as starting points.
**Reset Current Workspace** restores the selected preset. Rearranging panels updates session recovery
automatically and marks the workspace as modified, while the named preset changes only when updated.
**Manage Workspaces…** applies, renames, deletes, imports, and exports custom presets as JSON.
Names are unique without regard to case; imports receive a numbered suffix if a name is already used.

Under **File → Preferences → OGraf Studio → Workspace & windows**, choose whether startup restores the last
session or a specific preset, and whether to reopen detached windows. These application preferences
save immediately and are independent of template-set output defaults.

Detached panes remember their last position even after Dock Back or closing that pane. Reloading
Studio preserves the window arrangement. If the browser blocks reopening windows, use **Restore
Detached Windows** in the Window menu or **Restore Windows** in the recovery notice. The panes remain
available in the main editor. Missing displays fall back to an available screen when the browser can
identify the monitor layout; precise multi-monitor placement depends on browser support and permission.

Browser builds save workspaces in the current browser profile and address, including its port.
The standalone build also saves a per-user `OGrafStudio/workspaces.json` profile in the operating
system's application settings directory (`%LOCALAPPDATA%` on Windows). Use preset import/export to
transfer arrangements between browsers or computers. Workspace preferences do not affect rendered
graphics or template-set settings.

## Live components

Select objects and choose **Resources → Components → + Create Component**. Studio creates a
reusable asset and turns the selected objects into its first linked instance, preserving their
layer IDs and appearance. **Insert Instance** adds another linked instance; **Insert Copy** makes
an independent copy.

**Edit Component** opens the source editor with its source layers, preview frame, text, font, paint,
dimensions, effects and field defaults. Source changes update linked instances automatically.
Editing a linked object creates a local override for the changed property; other properties keep
inheriting. Instance placement remains independent.

In **Properties → Component instance**, use the property's **Reset**, **Reset Layer** or
**Reset Instance** to resume inheritance. **Select Instance** selects its members. **Make Unique**
creates a separate asset for that instance. **Update from Selection** publishes selected instance
content back to its asset. Deleting an asset is disabled while instances use it.

Deleting a timeline key from a linked instance is a local override; it does not remove the source
key or affect other instances. Reset that keyframe override, the layer, or the instance to inherit
the source animation again.

To add a new object to a component, select the edited instance's members together with the new
object and choose **Update from Selection**. The new object joins that instance in place: existing
layer IDs, masks, bindings, animation and references are preserved. Other linked instances receive
one corresponding child, while their local overrides remain. Select one instance at a time; layers
from another component and locked selected layers are rejected. A selection containing only
independent objects becomes a new linked source instance of the chosen component.

When a shared component is used by **Transitions**, Studio checks its prospective source layers
before publishing an edit. Removing a source used by a shared instance, template state or resize
target is rejected without changing the templates or Undo history. Retarget or remove those
references in **Transitions** first, then update the component again. The same protection applies
to connected MCP edits and Undo/Redo.

A template set shares set-scoped component assets between its templates. Saved `.ogs` templates
also carry their resolved layers and required component dependencies, so exported OGraf graphics
play without Studio or an external component library. Older independent copies remain independent;
local differences in older linked instances become overrides when opened.

## Preview and export

**Preview & Export** has one viewport with playback, data fields, diagnostics and export settings.
It normally follows the template selected in **Templates**. The **▶ Preview** button of a playout
layer's **Take in**, **Update** or **Take out** shows the coordinated graphics in that same
viewport, including fullscreen. Selecting another template returns to its ordinary preview.
**File → Export…** opens the pane directly.

### Browse and play templates

Open an editable `.ogs` document from **File → Open…**. Selecting a
thumbnail in **Templates** automatically shows that template in **Preview & Export**. Previous/next
controls move through the set and update the selection in **Templates** too. Reorder templates in
the **Templates** pane when needed. Navigation is manual; each template retains its animations and
loops.

Switching the selected template loads it into the preview automatically. **Take In** plays its
native animation, **Next** advances its lifecycle steps and **Take Out** plays it out. Template
navigation and lifecycle steps have separate controls. Editing a template rebuilds its preview.
Fullscreen playback takes priority over hidden Templates and Transitions thumbnails; pending thumbnails
refresh after fullscreen exits. This does not change the template's animation or transition timing.

Data fields appear below the preview with their native controls, including checkboxes for Boolean
values and the standard color picker with editable hex for color fields. They update the loaded
preview only. Each fullscreen entry starts with the controls hidden. Right-click the fullscreen
output to open or reposition the controls at that location; the pane stays within the screen edges.
Drag the panel header to move it. Clicking outside the panel or pressing **D** outside an editor
hides the controls. **Exit fullscreen** in the popup header or **Escape** exits fullscreen without
stopping playback. There is no separate Show/Hide Controls toolbar.
The popup has a subtle 2px background blur confined to its own bounds. The surrounding preview
and the controls stay sharp. When editing hides the other controls, the pane's background blur clears too.
The panel background is 15% transparent and rows are 10% transparent by default; hovered rows are fully opaque.
Dropdowns and listboxes keep the whole panel visible while you choose an option.
While you change a focused text, number or color value, its row becomes fully opaque while keeping focus and
accepting edits. Every other control and the panel background are completely transparent
during the edit. A color picker's swatch, hex and alpha controls stay together as one row. Moving
focus away, committing or cancelling the edit restores the normal controls appearance. Hiding the
panel or leaving fullscreen also clears the editing state.
Studio replaces the browser context menu
inside fullscreen output; native system picker menus are separate.

When the set has Transition Logic, this panel also includes a template selector and **Take / Out**
controls for each playout layer. Taking a graphic starts the combined preview in the same
viewport; subsequent takes preserve the other layers and use the configured playout timing.
Each layer's **Data** section exposes its graphic's fields. On-air values update that layer;
values under **Next** are staged for the selected graphic's next Take. If the selected graphic
differs from the one on air, only the selected template's fields are shown. Values are shared between the
docked Playout Controls and fullscreen preview without changing saved template defaults.
**Pause / Resume**, **Replay**, and **Clear all** control this preview. Replay refreshes it from
the current draft; these controls do not command a separate live or MCP output.

Choose **Preview** in the main menu to enter fullscreen, including when the pane was closed.
To use another display, detach **Preview & Export**, move its window
there, then use the detached window's **Preview** button. Fullscreen preserves composition
proportions. With focus in Preview, **Left/Right Arrow** visit the template's previous/next Step.
At a Step boundary they select the previous/next template: moving forward lands on its first Step,
moving backward on its last Step. **Right Arrow** takes an off-air template to its first Step.
At the last template's final Step, Right plays Out; at the first template's first Step, Left returns
to Start. **Space** retains the native lifecycle behavior,
including Take Out after the last Step, and **D** toggles the data panel. Text fields keep their
editing keys, and the popup drag handle retains its positioning arrows. Left/right buttons follow
the same route as the keyboard and describe their next action.

### Save and export

Save the editable template or complete set from **File**. Preview & Export contains the selected
template's export settings and compatibility checks. The File menu also exports complete sets:

- A single template produces a certified `.ograf.zip`.
- A set with Transition Logic produces one coordinated `.ograf.zip`.
- A set without Transition Logic produces an `.ograf-set.zip` containing a certified package for
  each template.

Package exports run the compatibility checks before saving. Keep the `.ogs` document to reopen
and edit its templates in Studio.

### Single-template lifecycle preview

The preview plays the exported graphic the way playout does: **Take In ▶** plays it in,
**Next ⏭** continues to the next Step (or out after the last one), **⏮ Back** returns one Step,
and **Take Out** plays it out. **Live** plays in real time; **Rendered** steps through time exactly,
like a video renderer. The raw OGraf call log and the scheduled-action tester are under
**Developer**; the log's heading shows **error** when a call fails.

Choose **Fullscreen** for the active template's lifecycle preview.

A compact data panel with a 15% transparent background lets you edit the template's data fields in
fullscreen, with checkboxes for Boolean values and the standard color picker for color fields.
Changes update the running preview automatically. Right-click the fullscreen output to open or
reposition the controls at the pointer, with the pane kept within the screen edges. Drag the panel
header to reposition it. Click outside or press **D** when you are not editing a control to hide the
panel; **Exit fullscreen** in the header or **Escape** exits fullscreen. There is no separate
Show/Hide Controls toolbar.
These controls appear only in Studio; they are not included in exported graphics.
Rows are 10% transparent by default and fully opaque on hover. Dropdowns and listboxes keep the
rest of the controls visible. A focused text, number or color row becomes fully opaque while
its value is being changed, but remains focused and editable. All other controls and the panel
background are 100% transparent during editing. The swatch, hex and alpha inputs of a color
field stay together. Moving focus away, committing or cancelling the edit restores the normal
controls appearance. Hiding the panel or leaving fullscreen also clears the editing state.
Right-click uses Studio's controls instead of
the browser context menu inside fullscreen output.

In the template lifecycle preview, **Left/Right Arrow** move between Steps first and then between
templates at the boundaries. **Space** advances the native lifecycle. Data-entry controls keep their
editing keys. **Escape** exits fullscreen without
restarting the graphic. Fullscreen fits the composition to the display while preserving its
proportions, with black margins where needed.

### Use an exported graphic in a tutorial website

The reusable `packages/ograf-web-player/ograf-player.js` browser module plays an actual exported
OGraf graphic inside a page. Export a certified single graphic or coordinated package, extract the
`.ograf.zip` into a website folder, and serve its manifest, JavaScript and assets over HTTP(S) with
their paths intact. Copy the player module to the website and use the manifest URL; Studio and its
MCP server are not required by the published page. `packages/ograf-web-player/demo.html` is a small
example of website controls. See the player package README for integration and the JavaScript API.

For coordinated packages, use the exported manifest's declared custom actions and data schema to
control lanes. The player hosts the coordinator as one graphic. The module does not read `.ogs`
documents or directly extract ZIP files. A web server must provide suitable MIME types, and
cross-origin files require explicit permission and appropriate CORS headers.

OGraf graphics contain executable JavaScript. Only load trusted packages on the same website origin;
the player is not a security sandbox. If accepting untrusted packages, use a separately isolated origin
and narrowly scoped communication. Playback also depends on browser support and permissions for
features such as WebGL, audio, webcam and external data. Validate the real hosted package in the
target browser before publishing a tutorial.

### Workspace, motion and review

New browser profiles start in the **Essentials** workspace with Layers, Properties and Timeline.
Existing saved layouts are preserved, and the Window menu can open the other panes. The start screen
offers blank canvas presets, recipes and file import. Recent files use browser file handles when
available; reopening one may require renewed file permission.
Choose **Custom** under Canvas size to enter a width and height, or under Frame rate to enter any
positive rate. The broadcast frame-rate presets retain exact fractional NTSC values internally.

Use the controls at the lower-right of the canvas to zoom out, enter a percentage, zoom in, fit
the canvas, or choose 1:1 and other preset magnifications. Fit keeps the canvas fitted as the
workspace changes. Zoom changes the editor view, not the graphic's output resolution.

Duration fields show seconds by default. Click the **s / f / TC** button beside the Timeline
readout to cycle through seconds, frames and timecode, or use Settings & Preferences → Studio → Workspace & windows. This saved editor preference
changes duration displays throughout Studio; it does not retime the animation. You can type `12f`, `0.5s`, `500ms` or a
timecode in any supported duration field; Studio stores frame-aligned values and shows rounding.
New blank templates use one Step and a five-second timeline, with **Short Out** enabled in the
Timeline. If Studio can prove the skipped interval is static, Take Out uses the final half-second
of the timeline (rounded to whole frames). Studio displays a warning and uses the full authored Out
duration when that proof is not possible, including shader/Media content, data bindings, Rules,
timed media and staged exit keys. The built-in shader lower-third currently uses that fallback.
Clear **Short Out** to always use the authored duration; older projects retain their existing timing
until you explicitly enable it. Coordinated routes still use their own transition durations.
In the Timeline, select keys and use Ctrl/Cmd+C and Ctrl/Cmd+V to paste their motion at the
playhead onto selected objects. The key context menu can paste only the easing. **Animate group**
in Properties builds an editable panel → headline → secondary-text cascade with a reverse exit.

Open **History** from the Window menu to inspect named steps and return to an earlier or later
state. Open **Review** to pin comments to a frame and canvas point, save named snapshots, compare
Before/On air/After and mark a project approved. Editing after approval marks the stamp out of
date. Comments and review versions are saved in editable source and are not part of OGraf output.

**Board** captures labelled lifecycle moments for the current template or every template in a
set. Its Update images use saved test-data rows, or the active preview values when there are no
rows. Capture the board and choose **Export PNG** for a contact sheet.

In **Data → Test data**, import CSV, TSV or JSON into named rundowns. Step through rows without
changing field defaults, run **Check all** to inspect text overflow and field limits, or play a
rundown through the real preview's Take, updates and Out. Test rundowns are saved with editable
source but do not appear in exported graphics or operator data schemas. MCP authoring uses
`set_test_rundowns` with field IDs for these authoring-only rows.

In **Resources**, use **Import editable SVG**, **Import PSD** or **Import Figma JSON** to retain
supported objects as editable layers. Unsupported effects use image fallbacks where available;
the import report describes any approximations, including text metrics and flattened nested groups.
The Figma interchange uses the downloadable local
Figma export plugin. The Pen tool draws editable paths; **Combine shapes** creates a boolean path
while retaining the hidden source shapes for Undo.

For a text layer, **Properties → Browse fonts…** opens the bundled font library. Its previews use
the selected text; adding a family embeds its files and license in the project for offline export.

Text FX can include multiple property animators with character, word or line ranges and seeded
ordering. Animator color supports solid and parseable gradient text fills; shader and media fills
support the other animator properties. Gradient tint repaints per glyph and can be costly.
Per-layer **Motion blur** is experimental, off by default,
and follows authored X/Y keyframes and loops. Test it on the intended renderer: blur can have a
substantial playback cost and does not currently sample path, modifier, Rule or live-data motion.

### Program monitor

Open **Playout Controls → Open Program Monitor** to detach Preview & Export. Move the window to a
second screen and use its Fullscreen button; **Choose display…** can position it where supported
and permitted by the browser. Playout Controls remains available in the editor. Background
options include black, checkerboard, webcam, a local video and two bundled procedural studio loops.
Title-safe, action-safe and aspect guides are preview overlays and do not enter the exported graphic.
**Show FPS overlay** displays a small **Preview FPS** badge in docked, fullscreen and detached
single-template or coordinated previews. The default is on; the setting belongs to this browser
session rather than the template or set. It measures browser animation-frame cadence, not the
composition's configured frame rate or GPU throughput. Sampling stops while the preview is hidden
and resets when it becomes visible again. The badge stays screen-sized when the graphic is fitted
and is excluded from authored output and captured/exported thumbnails.
When the program preview or Playout Controls has focus, **T** takes in, **U** reapplies the current
data and **O** takes out. Data-entry fields keep their typing keys; authored keyboard Rules have
priority in the fullscreen output.

## Compatibility notes

- Importing arbitrary third-party OGraf packages is best-effort; opaque JavaScript cannot always
  be recovered as editable layers.
- Package font assets when consistent typography across computers matters. Embedded project fonts stay active even when Resources is closed, and are included in captures, review images, contact sheets, and saved/exported thumbnails. Detached windows register their own copies.
- Linked components preserve local overrides when their asset changes. Reset an override to inherit
  again, or use **Make Unique** for a separate reusable asset.
- Runtime collections have explicit capacity and truncate overflow. Validate representative data
  and test the exported package with your target player.
- Large embedded assets can exhaust browser storage. Save editable source regularly.
- Browser certification and visual captures require a responsive Studio window.
- For official OGraf Devtool tests, follow the [local integration guide](guides/devtool-conditional-actions.md).
  In non-real-time mode, verify the visible frame at the same playhead after editing a schedule,
  reloading, or changing duration. The maintained integration refreshes cached samples after a
  schedule change, including when the playhead is already at a nonzero time.
