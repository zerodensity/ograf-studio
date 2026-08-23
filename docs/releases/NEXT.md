# OGraf Studio — Next release

## Preview workflow

- Added an always-visible **Start** control before **Previous Step** in the main OGraf Preview. It
  reloads the current data and render configuration from End or any Step, then immediately plays the
  entrance animation to Step 1. This prevents the preview controls from becoming a terminal dead end
  after Take Out or the final transition.
- Fixed Typography & broadcast QA source overlays stretching across the complete composition.
  Overlay images now retain authored layer bounds, infer portable Photoshop SVG-composite placement
  from their embedded plate assets, or fall back to intrinsic dimensions when no placement exists.

## Motion quality

- Replaced the flagship lower-third recipe's lockstep default with a deterministic compiled mask
  wipe using cubic-out entrance and cubic-in exit motion. Added explicit stagger-cascade,
  directional-slide, and no-motion styles with left/right/up/down direction choices.
- Added a shared scene-model motion vocabulary and atomic validation that rejects stagger spacing
  which cannot fit before the first pausable Step.
- Verified the default wipe through a five-frame browser strip, zero-finding deterministic design
  review, and all five exact real-time/non-real-time certification gates.

## Documentation

- Replaced the stale auto-loaded `CLAUDE.md` phase narrative with a concise current pointer to the
  working agreement, status, architecture, newest handover, and MCP authoring Skill, while retaining
  the durable npm-workspace and runtime-rebuild requirements.

This file is the unreleased changelog. Add completed, verified changes here before assigning the
next version and tag.
