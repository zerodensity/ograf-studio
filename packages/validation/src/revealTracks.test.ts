import { describe, expect, it } from 'vitest';
import {
  createLayerKeyframe,
  createLayerLoopClip,
  createProject,
  createRectangleLayer,
  defaultTransformFor,
  type LayerRevealProperty,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

function fixture(scope: 'lifecycle' | 'loop', property: LayerRevealProperty, value: number) {
  const project = createProject();
  const layer = createRectangleLayer();
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('rectangle'))];
  const keys = [{ id: 'reveal', frame: 0, value, easing: 'linear' as const }];
  if (scope === 'loop') {
    layer.loop = createLayerLoopClip({ durationFrames: 12, repeatCount: 1 });
    layer.loop.tracks[property] = keys;
  } else layer.animationTracks[property] = keys;
  project.compositions[0]!.layers = [layer];
  return project;
}

describe.each(['lifecycle', 'loop'] as const)('%s reveal track constraints', (scope) => {
  it.each([
    ['scale', -0.1],
    ['scale', Infinity],
    ['clipLeft', -0.1],
    ['clipRight', 1.1],
    ['clipTop', -1],
    ['clipBottom', Infinity],
  ] as Array<[LayerRevealProperty, number]>)('rejects %s=%s', (property, value) => {
    const result = validateProject(fixture(scope, property, value));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain(`${property} key must be`);
  });

  it.each([
    ['scale', 0],
    ['scale', 1.25],
    ['clipLeft', 0],
    ['clipRight', 1],
    ['clipTop', 0.5],
    ['clipBottom', 1],
  ] as Array<[LayerRevealProperty, number]>)(
    'accepts %s=%s, including positive scale overshoot',
    (property, value) => {
      expect(validateProject(fixture(scope, property, value)).errors).toEqual([]);
    },
  );
});
