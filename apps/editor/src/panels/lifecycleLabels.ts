import type { Keyframe } from '@ograf-editor/scene-model';

/** Translate only untouched defaults; custom names and stored role values remain unchanged. */
export function lifecycleLabel(keyframe: Keyframe, keyframes: readonly Keyframe[]): string {
  if (keyframe.role === 'start' && keyframe.name === 'Start') return 'Before';
  if (keyframe.role === 'end' && keyframe.name === 'End') return 'After';
  if (keyframe.role === 'step') {
    const index = keyframes
      .filter((item) => item.role === 'step')
      .findIndex((item) => item.id === keyframe.id);
    if (index >= 0 && keyframe.name === `Step ${index + 1}`)
      return index === 0 ? 'On air' : `On air · step ${index + 1}`;
  }
  return keyframe.name;
}
