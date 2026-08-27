import type { Composition } from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { buildRuntimeTimeline } from '@ograf-editor/ograf-runtime';

/**
 * Builds one paused GSAP timeline spanning every Keyframe in sequence, with a label at each
 * Keyframe's cumulative frame position (converted to seconds via the composition's frame rate —
 * GSAP itself always works in seconds) and a per-layer tween for each Transition. Used for both
 * scrub-preview (`.seek()`) and playback (`.play()`).
 *
 * Layers are first snapped to Keyframe 0's pose via `gsap.set` so the first tween in the chain
 * has a correct "from" value — otherwise GSAP would lazily capture whatever the DOM's current
 * (unrelated) style happens to be at first render, since `.to()` doesn't pin a starting value.
 */
export function buildMasterTimeline(
  composition: Composition,
  layerRefs: Map<string, HTMLElement>,
): ReturnType<typeof buildRuntimeTimeline> {
  // One compiler and one timeline interpreter now power both authoring and the exported graphic.
  // Guides are retained only for the editor canvas; export uses compileDescriptor's default.
  return buildRuntimeTimeline(compileDescriptor(composition, { includeGuides: true }), layerRefs);
}
