# Detached Studio panes

Tool windows share the original editor's project, selection, undo, local form drafts and MCP
connection. Use the pane header's Open in new window button; browser popup creation requires a
user gesture. Closing or Dock back restores the original dock location. Choosing a pane from the
Window menu returns it to Studio as a centered floating pane, including when it was detached.
An outer-bottom docking guide spans the workspace width; a later outer-side dock can take the full
height instead. The latest choice owns the lower corners and persists in the saved workspace.
The main menu's **Preview** command opens fullscreen preview.
For another monitor, move the detached Preview & Export window there and use its header's
**Preview** button. Fullscreen preserves the current graphic instance and playback position.
The detached window also offers **Program Monitor** with optional display selection where the
browser supports it. Its local background and safe guides are preview-only; T takes, U updates,
and O takes out when focus is outside an input. None of these monitor choices alter exports.
For templates using [Functions](./functions.md), verify startup while the preview is already
detached as well as after moving it there. Test custom actions and keyboard/mouse input, then
dock back and reopen; a working main-window preview alone does not verify this ownership path.
Test the detached window's close button too: the returned preview must retain committed game
state, pause audio and accept an explicit resume, without a spurious “Runtime disposed” failure.
Check music and sound effects separately: a loaded, unmuted clip at time zero is not proof of
playback. Verify its media clock advances, then test pause/resume, mute/gain and Out after moving
between windows. Native media identity must survive both creation in another window and adoption
back into the editor; a constructor check against either window alone is insufficient.
Open **Window → Playout Controls** to operate that same preview from a separate dockable pane.
It includes template navigation, lifecycle transport, transition lanes, custom actions and typed
data controls. It can remain docked on the operator monitor or detach through its own pane header;
keep Preview & Export open as the output destination. Both control views share preview data,
lane selections and runtime state, so opening or closing Playout Controls does not create or
restart graphics. If the output pane is closed, Playout Controls offers **Open Preview & Export**.
For a coordinated set, expand a lane's **Data** section to edit its on-air graphic. When the
selected next state differs, its separate **Next** section stages values for that state's Take.
Lane/state values are independent, including fields with the same key in different templates;
operator edits do not change saved defaults. The docked and fullscreen controls share these values.
External feeds can inspect this visible combined output with `ograf_get_playout {target:"preview"}`
and send revision-checked `ograf_control_playout {target:"preview",expectedRevision,requestId,
operation:{type:"update",slotId,stateId,data,mode:"in-place"}}`. Preview accepts Update only; take
graphics using Studio's lane controls first. These feed patches preserve the same runtime,
scrolling phase, transition timing and paused state, and never edit saved template defaults.
Data Rules and configured leaf text effects still respond. Omitted `mode` or `mode:"transition"`
retains authored update transitions for deliberate operator changes. Omitting `target`
addresses the separate live/MCP session; it does not update the visible Preview & Export output.
For ordinary Studio feeds, prefer native **Data → Connections** with its editor/on-air/both
destinations. The application owns polling while panes are closed or detached fullscreen is active;
an external MCP bridge is unnecessary. See [data connections](./data-connections.md). Exports still
receive ordinary GDD values from their controller. Preserve source timestamps and distinguish
reference/delayed prices from live observations.
The dockable pane uses ordinary Studio styling; the transparency and dismissal behavior below
apply only to the fullscreen popup. Workspace saving remembers the pane and detached geometry.

**File → Preferences → OGraf Studio → Workspace & windows → Sync editor and preview** makes
Preview & Export, including detached fullscreen, display the editor's current composition frame.
Scrubbing, Timeline playback, property edits and editor test data appear in both views. The preview
mirrors the existing rendered output, including shader/effect canvases and live clock text, without
starting another timeline, timer or Rules runtime. Selection handles, safe-area guides and crop
editing chrome stay in the editor. Preview data controls edit the same editor test values while
sync is enabled; its Play/Pause/Stop and frame controls operate the editor Timeline. Playout lane
controls return when sync is disabled. Existing coordinated preview is parked and paused while
sync is enabled and resumes on reattachment; ordinary single-template preview is reloaded when
returning to independent operation. This checkbox defaults off and persists in the user Studio
profile/browser recovery, outside `.ogs` files and workspace preset snapshots. Operator controls
remain Studio UI; the preference does not alter exported OGraf playback.

## Presentation backgrounds

**Playout Controls → Background** and the shared preview popup offer four modes: **None**,
**Big Buck Bunny** looping sample video, **Still image** and **Webcam**. Still image accepts a URL
or a local image up to 10 MB. Canvas Layout provides **Open Playout Controls** instead of duplicate
background controls. There are no additional custom-video or color modes.

One presentation background is shared by the editor and independent single-template or combined
previews, beneath the entire output in embedded, fullscreen and detached windows. With
**Sync editor and preview** enabled, use the editor mirror without a second background layer.
Changes apply immediately without rebuilding the runtime or requiring **Replay**. Authored opaque
backgrounds and full-frame objects cover it; choose transparent composition output where the
presentation background should show.

Preferences initialize once per set/project from the active composition's legacy layout settings,
then persist locally in IndexedDB, including the selected still image. Current background edits
do not enter project source, `.ogs`, exports or workspace presets. Legacy layout settings remain
readable as initial defaults; this requires no file-format migration.

**Background → Webcam** includes **Start webcam** and **Camera Settings**, using the same camera
controls as Live tags. Selecting or restoring Webcam mode, opening settings or opening a preview
never starts capture or requests permission; **Start webcam** is explicit. MCP does not activate
or configure the camera. Same-set template navigation and Take, Update, Out or Clear retain the
presentation stream. **Stop background webcam** or switching away from Webcam releases the
presentation consumer; an active Live tag may retain the shared track. Opening an unrelated
document/set or the capture owner's `pagehide` stops all camera capture. Camera selection, capture settings and footage
remain session-only and are never exported; exported live tags require the renderer's source hook.

## Fullscreen controls

Templates and Transitions PNG thumbnail generation pauses while that preview is fullscreen and resumes with the
latest pending project after exit, so hidden thumbnails do not compete with the animation.

The semi-transparent fullscreen data panel shares Preview & Export's data values and automatic
updates; boolean fields use checkboxes. **D** shows or hides the panel outside editors. Its header
includes **Exit fullscreen**, which works in the preview's own document, including detached windows,
without stopping playback. There is no duplicate Show/Hide Controls toolbar.
Space advances the lifecycle. Left/Right buttons and keys use the same route: visit an available
Step, then cross to an adjacent template. At the last template's final Step, Right plays Out;
at the first template's first Step, Left returns to Start. Right from Off takes In. Native data
inputs retain their editing arrows, and a focused drag handle retains its positioning arrows.
Ordinary preview buttons do not block navigation. Escape also exits fullscreen. Operator
controls are Studio UI and are never exported. Editing a template rebuilds its preview.
Fullscreen uses the same controls in main and detached panes. Right-click opens or repositions
the controls at the clicked location, clamped within the viewport. The pane background and rows are
60% transparent by default; only the hovered row becomes 15% transparent. A focused row becomes fully
opaque while its value is being changed, while retaining focus and editability. All other
controls and the pane background are 100% transparent during editing. Color swatch, hex and
alpha inputs share one row. Focus leave, edit commit or cancel restores the normal appearance.
Panel hide or fullscreen exit also clears the interaction state.
Studio suppresses the default browser context menu throughout its main and detached windows,
including inputs, blank areas and fullscreen output. Studio's own menus and fullscreen right-click
controls remain available. Native system picker menus and browser chrome remain outside this boundary.

For a multi-monitor verification, enter fullscreen from the detached preview's own **Preview**
button, then right-click while controls are hidden. **D** working by itself does not verify the
right-click path. Check repositioning near the viewport edges, outside-click dismissal, editing,
and docking back into the main window. Controls belong to the preview window and use its local
viewport coordinates, including on monitors to the left of the main display. Preserve unsaved
artwork and detached-window positions before reloading Studio to apply a window-handling fix.

Keep the main editor open. Do not open another full editor to create a multi-monitor workspace:
the newer editor takes over the MCP socket. Main reload/close preserves child-window geometry;
startup preferences control reopening. A blocked popup stays available in the main editor with
a Restore Windows action. Browser-dependent capture/certification still
belongs to the main editor: bring it into view and require `editor.certificationReady` as usual.

Embedded browser hosts may turn detached-window requests into tabs. Use a regular Edge/Chrome
window for OS-level monitor placement. A popup-blocked message leaves the pane safely docked.
The normal revision-checked tools continue to operate on session `editor`; detaching is local UI
state, not a scene operation or a new authoring session.

## Movable dialog windows

Studio-owned standalone dialogs use an empty part of their header as a drag handle. This includes
Settings & Preferences, save/export, resource editors, plugin details, Camera Settings, workspace
management, keyboard shortcuts and import dialogs. Header buttons and form controls keep their
normal interaction. Dialogs stay within their current browser window and are not dockable.

Focus the header with Tab, then use arrows to move 10 pixels or Shift+arrows for 50 pixels.
Home or a double-click on the empty header restores the initial position. Viewport changes keep
the moved dialog reachable. Positions last for that open dialog only; reopening starts at its
initial position. These positions are local UI state, not project operations, `.ogs` data or
saved workspace geometry.

Existing dockable panes and embedded plugin regions keep their existing behavior. Native system
file pickers are outside Studio's dialog controller. Do not infer a new docking or positioning
MCP mutation from this interaction; continue using the existing authoring and window tools.

## Saved workspaces

Use the menu bar's **Layout** dropdown to switch built-in or saved presets; **(modified)** marks
arrangement changes. Use **Window → Workspaces** to save the current arrangement under a unique name,
update a custom preset, reset its arrangement, or manage JSON import/export. Default, Design,
Animation, Data & Rules, and Dual Monitor are built-in starting points. Named presets change only
on explicit update; session recovery tracks ongoing panel rearrangement. Detached panes remember
their last position after docking or closing, and saved presets include the detached arrangement.

**File → Preferences → OGraf Studio → Workspace & windows** selects last-session or preset startup and
automatic detached-window reopening. Browser profiles are origin-specific; standalone builds also
persist a per-user profile. These are local UI preferences, independent of `.ogs` authoring data.
The same searchable **Settings & Preferences** window has separate **Template Set** and **Template**
scopes. Set defaults are staged until Apply/OK and then saved with the set `.ogs`; Template controls
reuse composition Properties, apply immediately through undoable authoring edits, and are saved with
the template or set. File → Preferences opens the user-local Studio scope; the Templates gear opens
the set scope, and template context/Properties Settings opens the template scope. Scope selection
does not move workspace preferences into the document.
Monitor restoration uses available browser screen information and previously granted permission;
do not assume precise native placement in an embedded browser or promise automatic popup reopening.
