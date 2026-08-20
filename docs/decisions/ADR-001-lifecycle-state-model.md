# ADR-001: Explicit OGraf lifecycle states

Status: accepted

## Context

OGraf distinguishes the start state, zero or more pausable steps, and the end state. Treating every authored keyframe as a step cannot correctly implement first play, play beyond the last step, stop, or zero-step graphics.

## Decision

Every composition contains explicit `start` and `end` keyframes. Authored pausable keyframes have role `step`. Only step keyframes contribute to the manifest `stepCount` and `currentStep`.

## Consequences

Legacy projects require migration. Start/end poses become editable timeline states. Store operations must preserve a complete ordered transition chain. Runtime navigation becomes a state machine rather than a clamped numeric index.
