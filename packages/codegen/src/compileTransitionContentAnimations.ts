import {
  createTransitionContentAnimationComposition,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import type { CompiledTransitionLogicDescriptor } from '@ograf-editor/ograf-types';
import { compileDescriptor } from './compileDescriptor';

/** Shared by editor preview and packaged output; the runtime needs only ordinary numeric tracks. */
export function compileTransitionContentAnimations(
  definition: TransitionLogicDefinition,
  width: number,
  height: number,
  frameRate: number,
): CompiledTransitionLogicDescriptor['contentAnimations'] {
  const result: NonNullable<CompiledTransitionLogicDescriptor['contentAnimations']> = {};
  for (const recipe of definition.transitions) {
    for (const [key, choice, side, duration] of [
      ['incoming', recipe.incomingAnimation, 'in', recipe.incomingFrames],
      ['outgoing', recipe.outgoingAnimation, 'out', recipe.outgoingFrames],
    ] as const) {
      const composition = createTransitionContentAnimationComposition(
        choice,
        side,
        duration,
        width,
        height,
        frameRate,
        definition.animationPresetPlugins,
      );
      if (!composition) continue;
      const layer = compileDescriptor(composition).layers[0]!;
      (result[recipe.id] ??= {})[key] = { layer, durationFrames: duration };
    }
  }
  return Object.keys(result).length ? result : undefined;
}
