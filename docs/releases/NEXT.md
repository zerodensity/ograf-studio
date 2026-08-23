# OGraf Studio — Next release

## Preview workflow

- Added an always-visible **Start** control before **Previous Step** in the main OGraf Preview. It
  reloads the current data and render configuration from End or any Step, then immediately plays the
  entrance animation to Step 1. This prevents the preview controls from becoming a terminal dead end
  after Take Out or the final transition.
- Fixed Typography & broadcast QA source overlays stretching across the complete composition.
  Overlay images now retain authored layer bounds, infer portable Photoshop SVG-composite placement
  from their embedded plate assets, or fall back to intrinsic dimensions when no placement exists.

This file is the unreleased changelog. Add completed, verified changes here before assigning the
next version and tag.
