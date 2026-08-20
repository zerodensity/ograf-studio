# ADR-002: Independent Layer Timelines

Status: Accepted  
Date: 2026-08-15

## Context

Document v2 stored one pose for every layer at every OGraf lifecycle marker. This forced all objects
to share key timing and prevented the delayed, staggered, and overlapping animation expected from a
broadcast motion-graphics editor.

## Decision

Keep a single composition frame clock and a separate global OGraf lifecycle-marker track. Give each
layer its own arbitrary-frame transform keys. A document-v3 key initially contained a complete
transform and the easing used to approach it. Document v5 refines that representation into
independent property tracks. Editing an unkeyed frame auto-keys only the changed property on the
edited layer.

The compiler copies these tracks into the compiled descriptor. The shared GSAP interpreter builds
each layer tween independently. Lifecycle actions seek the shared clock to global marker frames, so
realtime and non-realtime output remain deterministic.

## Consequences

- Layers can be keyed, moved, and retimed without modifying other layers.
- Existing v2 documents migrate losslessly by placing their poses at lifecycle cumulative frames.
- Layer keys remain constrained to the current composition duration.
- Per-property transform/effect tracks and custom cubic Bézier curves were implemented in document
  v5 without changing the single-clock or OGraf lifecycle-marker decisions.
