# Handover — 2026-08-16 — Timeline Groups, Canvas Interaction, and Step Playback

## Branch and revision

- Branch: repository has no established committed baseline; all files remain untracked.
- Last commit: none in the current workspace baseline.
- PR or issue: none.
- Working tree clean: no — preserve the user's existing work and do not reset it.

## Objective

Make timeline-only layer organization discoverable from Ctrl/Command multi-selection and expose the
same capability to MCP agents. Add canvas-only zoom shortcuts, optional OGraf Step-aware playback,
and safe Spacebar transport control without changing OGraf output or the existing source-file shape.

## Completed and verified

- Ctrl/Command-selected timeline layer names retain their full selection on right-click and offer
  `Create Group`; a single selected row leaves the command disabled.
- Timeline group headers and selected-row menus use `Rename Group` and `Ungroup`; the toolbar uses
  `+ Group`. No Folder/Dissolve labels remain in the Timeline UI.
- Groups remain named, colored, collapsible, editor-only row organization. They do not change layer
  paint order, property tracks, persistent canvas `groupId`, transforms, or compiled OGraf output.
- MCP supports revisioned `create_timeline_group`, `rename_timeline_group`,
  `set_timeline_group_color`, and `ungroup_timeline_group` operations. Creation requires at least two
  existing layer IDs and returns a stable generated timeline-group ID.
- MCP capabilities and tool descriptions publish the UI-only semantics. Scene inspection and
  filtered layout reads expose `layout.timelineGroups`; the serialized `timelineFolders` field is
  retained as a deprecated compatibility field so existing v7/v8 `.ogeproj` files do not migrate or
  break.
- The `ograf-authoring` Skill recommends named/color-coded Timeline Groups for multi-part lower
  thirds, repeated forecast cells, and other large related layer sets, and explicitly distinguishes
  them from canvas groups.
- Ctrl/Command+wheel zooms the canvas around the mouse pointer; Ctrl/Command+plus/minus zooms around
  the viewport center. Browser/editor chrome scale remains unchanged, zoom is clamped to 5–400%,
  and composition changes return to fit-to-view.
- `Pause at OGraf steps` makes the main editor transport stop exactly at each lifecycle Step and
  continue to the next Step or End on the following Play command. The option is transient preview
  state and does not author or compile anything.
- Space toggles the same Play/Pause controller. Input, textarea, select, button, contenteditable, and
  textbox-role targets keep their native key handling.
- The old composition-scaled gradient rulers were replaced with Photoshop-style fixed viewport
  chrome. Horizontal/vertical rulers are 20 screen pixels, use adaptive 1/2/5 pixel intervals, keep
  zero aligned to the composition origin during pan/zoom, and show restrained hierarchical ticks.
- Guides are fixed 1px cyan viewport lines. Drag from the horizontal/vertical ruler to create a
  guide, drag a guide to move it, and drag it back onto its source ruler to remove it. Guide values
  remain integer composition pixels and the compiled OGraf artifact is unchanged.

## In progress

- None.

## Next actions

1. Continue using Timeline Groups when adding large repeated compositions through MCP.
2. If the source document schema is ever revised beyond v8, consider a formal field rename only
   through a versioned migration; do not rename `timelineFolders` in-place.

## Decisions made

- “Timeline Group” is the canonical UI and MCP term.
- The old serialized field name remains intentionally unchanged for project/client compatibility.
- A layer can belong to only one Timeline Group; creating a group moves its selected members from
  older groups and removes groups left empty.
- Timeline grouping is a revisioned authoring mutation but remains excluded from compiled OGraf
  artifacts.

## Important files changed

- `apps/editor/src/panels/TimelinePanel.tsx`
- `apps/editor/src/canvas/{Stage.tsx,stageZoom.ts,ografStepPlayback.ts}`
- `apps/editor/src/canvas/{CanvasRulers.tsx,CanvasLayoutOverlay.tsx,canvasRuler.ts,Stage.css}`
- `apps/editor/src/{App.tsx,state/timelineStore.ts,state/keyboardShortcuts.ts}`
- `apps/editor/src/state/projectStore.ts`
- `packages/authoring-core/src/types.ts`
- `packages/authoring-core/src/operations.ts`
- `apps/mcp-server/src/schemas.ts`
- `apps/mcp-server/src/mcpServer.ts`
- `skills/ograf-authoring/`
- `docs/{STATUS,ARCHITECTURE,ROADMAP}.md`

## Verification

- `npm run verify`: passed — formatting, lint, all workspace typechecks, 36 test files / 169 tests,
  and production builds. Only the existing large-editor-chunk warning remains.
- Targeted authoring/MCP/timeline-group tests: 3 files / 43 tests passed.
- Skill validation: `quick_validate.py skills/ograf-authoring` passed; the packaged ZIP was refreshed.
- Visible editor check: Ctrl multi-selection remained active on right-click, `Create Group` was
  enabled, existing group headers exposed `Rename Group`/`Ungroup`, and no Folder/Dissolve UI labels
  were present.
- Visible interaction check: Ctrl+plus changed the canvas zoom percentage without changing page
  chrome; Step-aware Play stopped at frame 30 and resumed to End at frame 50; Space started and
  paused ordinary playback, while Space on a focused numeric form field left playback paused.
- Ruler interaction check: the 20px rulers stayed visually fixed, major tick density adapted between
  27% and 48% canvas zoom, dragging from the horizontal ruler created a guide, and dragging that
  temporary guide back removed it without leaving project content behind.
- Manual or external OGraf verification: not required because timeline-group metadata is explicitly
  excluded from compiled descriptors; regression compilation and build passed.

## Known failures and risks

- Internal TypeScript/source identifiers and the persisted field still say `Folder`/
  `timelineFolders` by design. Renaming those without a versioned source migration would risk old
  project compatibility and existing clients.
- Right-clicking timeline frame cells continues to open the keyframe/frame menu. `Create Group` is
  intentionally exposed by right-clicking the selected layer-name rows, where grouping intent is
  unambiguous.

## Environment and generated artifacts

- MCP server restarted from the verified source and is healthy at `http://127.0.0.1:4318/mcp`.
- Editor bridge reports connected through `http://127.0.0.1:4318/health`.
- Editor dev server remains at `http://localhost:5173/`.
- `skills/ograf-authoring/ograf-authoring.zip` contains the updated Skill.

## Uncommitted work

- All repository files remain untracked under the user's original no-baseline workspace state.
