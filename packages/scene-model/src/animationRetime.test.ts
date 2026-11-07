import { describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  createComposition,
  createLayerOfKind,
  createLayerPropertyKeyframe,
} from './index';
import { animationRetimePhaseRange, retimeAnimationPhase } from './animationRetime';

describe('phase animation retiming', () => {
  it('reports the current duration for every selectable phase', () => {
    const composition = createComposition();
    expect(animationRetimePhaseRange(composition, 'in')).toMatchObject({
      startFrame: 0,
      endFrame: 12,
      durationFrames: 12,
      transitionCount: 1,
      retimable: true,
    });
    expect(animationRetimePhaseRange(composition, 'on-air')).toMatchObject({
      startFrame: 12,
      endFrame: 12,
      durationFrames: 0,
      transitionCount: 0,
      retimable: false,
    });
    expect(animationRetimePhaseRange(composition, 'out').durationFrames).toBe(12);
    expect(animationRetimePhaseRange(composition, 'entire').durationFrames).toBe(24);
  });

  it('stretches IN proportionally and shifts later keys without changing loop-local timing', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('rectangle');
    layer.animationTracks.x = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(6, 60),
      createLayerPropertyKeyframe(12, 120),
      createLayerPropertyKeyframe(24, 240),
    ];
    layer.loop = {
      id: 'loop',
      name: 'Loop',
      activation: { type: 'lifecycle' },
      durationFrames: 10,
      phaseOffsetFrames: 0,
      repeatCount: null,
      tracks: { x: [createLayerPropertyKeyframe(5, 10)] },
    };
    composition.layers.push(layer);

    const result = retimeAnimationPhase(composition, 'in', 24);

    expect(result).toMatchObject({ previousEndFrame: 12, targetEndFrame: 24, deltaFrames: 12 });
    expect(layer.animationTracks.x?.map((key) => key.frame)).toEqual([0, 12, 24, 36]);
    expect(layer.loop.tracks.x?.[0]?.frame).toBe(5);
    expect(computeKeyframeFrames(composition).map((item) => item.frame)).toEqual([0, 24, 36]);
  });

  it('fits the entire sequence while preserving relative stagger', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('rectangle');
    layer.animationTracks.opacity = [
      createLayerPropertyKeyframe(3, 0),
      createLayerPropertyKeyframe(6, 1),
      createLayerPropertyKeyframe(18, 0),
    ];
    composition.layers.push(layer);
    retimeAnimationPhase(composition, 'entire', 48);
    expect(layer.animationTracks.opacity?.map((key) => key.frame)).toEqual([6, 12, 36]);
  });
});
