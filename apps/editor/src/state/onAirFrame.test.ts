import { describe, expect, it } from 'vitest';
import { computeKeyframeFrames, createProject } from '@ograf-editor/scene-model';
import { onAirFrame } from './onAirFrame';

describe('default authoring pose', () => {
  it('returns the first operator step frame', () => {
    const composition = createProject().compositions[0]!;
    const step = composition.keyframes.find((keyframe) => keyframe.role === 'step')!;
    expect(onAirFrame(composition)).toBe(
      computeKeyframeFrames(composition).find((entry) => entry.keyframeId === step.id)!.frame,
    );
  });

  it('falls back to zero without a step', () => {
    const composition = createProject().compositions[0]!;
    composition.keyframes = composition.keyframes.filter((keyframe) => keyframe.role !== 'step');
    expect(onAirFrame(composition)).toBe(0);
  });
});
