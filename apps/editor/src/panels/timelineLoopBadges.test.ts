import { describe, expect, it } from 'vitest';
import {
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
} from '@ograf-editor/scene-model';
import { buildTimelineLoopBadges } from './timelineLoopBadges';

describe('timeline loop badges', () => {
  it('marks lifecycle loops at the first on-air Step', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('text');
    layer.loop = createLayerLoopClip({
      activation: { type: 'lifecycle' },
      tracks: {
        x: [createLayerPropertyKeyframe(0, 0), createLayerPropertyKeyframe(10, 100)],
        opacity: [createLayerPropertyKeyframe(0, 1), createLayerPropertyKeyframe(10, 0)],
      },
    });
    composition.layers = [layer];
    const step = composition.keyframes.find((keyframe) => keyframe.role === 'step')!;

    expect(buildTimelineLoopBadges(composition)).toEqual([
      {
        layerId: layer.id,
        lifecycleKeyframeId: step.id,
        frame: 12,
        activation: 'lifecycle',
        properties: ['x', 'opacity'],
      },
    ]);
  });

  it('marks step loops only at their configured Step and ignores stale references', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const step = composition.keyframes.find((keyframe) => keyframe.role === 'step')!;
    const valid = createLayerOfKind('rectangle');
    const stale = createLayerOfKind('ellipse');
    valid.loop = createLayerLoopClip({
      activation: { type: 'step', stepKeyframeId: step.id },
    });
    stale.loop = createLayerLoopClip({
      activation: { type: 'step', stepKeyframeId: 'missing-step' },
    });
    composition.layers = [valid, stale];

    expect(buildTimelineLoopBadges(composition)).toEqual([
      {
        layerId: valid.id,
        lifecycleKeyframeId: step.id,
        frame: 12,
        activation: 'step',
        properties: [],
      },
    ]);
  });
});
