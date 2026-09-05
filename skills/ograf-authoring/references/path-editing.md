# Vector point editing

Studio supports Edit as path on rectangles, rounded rectangles, ellipses and existing SVG paths.
Drag points, add/remove points, or use Smooth/Corner. Shift constrains dragging; arrows nudge
(Shift = 10); Alt lets a curve handle move independently. Escape cancels a drag or exits.
Each finished drag is one undo step. UI conversion uses current-frame dimensions; MCP defaults to 0.

## MCP operations

Use `ograf_apply_operations` with the current revision and a layer ID or exact name:

```json
{ "type": "edit_path", "layerName": "Panel", "frame": 0, "edit": { "action": "convert" } }
```

Read `ograf_inspect_scene` afterward. `pathEditing.d` is the canonical SVG; `pathEditing.contours`
contains each contour's `closed` flag and ordered `nodes`. A node has `x`, `y` and optional
`in`/`out` handle coordinates in local viewBox units.

```json
{
  "type": "edit_path",
  "layerName": "Panel",
  "edit": {
    "action": "move",
    "expectedD": "M 0 0 L 200 0 L 200 200 L 0 200 Z",
    "contour": 0,
    "node": 0,
    "x": 30,
    "y": 0
  }
}
```

The example SVG is illustrative: use the exact returned `d`. Zero-based contour/node indices
identify points within that snapshot; insertion/removal changes later indices. Re-read afterward.
`expectedD` rejects stale point edits even when the project revision is fresh.

- `move`: `x`, `y`; translates attached handles with the anchor.
- `handles`: `incoming` and/or `outgoing` = `{x,y}`, or null to remove one; omitted handles stay.
- `insert`: splits the following segment; optional `t` in (0,1), default 0.5. Cubic subdivision
  preserves its curve. The final open-contour point has no following segment.
- `remove`: retains at least three closed-contour or two open-contour points.
- `smooth`: creates aligned tangent handles; `corner`: removes this anchor's handles.

Point actions require `expectedD`, `contour`, `node`. Unknown fields and locked layers fail.
Operations use ordinary atomic mutation, undo, save and export.

## Conversion boundaries

Layer identity, compatible paint, effects, links, transforms and loops survive conversion.
Unlink corner-radius tokens first. Rounded rectangles clipping children require a separate mask
or disabling child clipping before conversion. Converted paths scale corners and strokes with
their box; review animated resizing. SVG arcs become cubic approximations, including ellipses.
Compound contours and fill rules survive. Limits: 4096 points and 500000 SVG characters.

Geometry edits apply across the animation. Vertex keyframes/morphing, text outlines, image
tracing/clipping tools, pattern-symbol editing and Lottie decomposition are outside this version.
