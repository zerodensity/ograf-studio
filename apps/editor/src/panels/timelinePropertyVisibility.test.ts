import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
} from '@ograf-editor/scene-model';
import {
  isTimelinePropertyMeaningful,
  meaningfulTimelineProperties,
  timelineAnimationTracks,
  timelineLayerKeyframes,
} from './timelinePropertyVisibility';

describe('meaningful timeline property visibility', () => {
  it('shows a single enabled independent key while omitting synthetic static channels and the base pose', () => {
    const layer = createLayerOfKind('rectangle');
    layer.animationTrackMode = 'independent';
    const base = createLayerKeyframe(0, createDefaultTransform({ x: 100 }));
    const animated = createLayerKeyframe(12, createDefaultTransform({ x: 100 }));
    layer.keyframes = [base, animated];
    layer.animationTracks = { x: [createLayerPropertyKeyframe(12, 100)] };

    expect(meaningfulTimelineProperties(layer, new Set([0, 12, 24]))).toEqual(['x']);
    expect(Object.keys(timelineAnimationTracks(layer))).toEqual(['x']);
    expect(timelineAnimationTracks(layer).y).toBeUndefined();
    expect(timelineLayerKeyframes(layer).map((key) => key.frame)).toEqual([12]);

    layer.animationTracks.x = [createLayerPropertyKeyframe(0, 100)];
    expect(isTimelinePropertyMeaningful(layer, 'x', new Set([0, 12, 24]))).toBe(true);
    expect(timelineLayerKeyframes(layer).map((key) => key.frame)).toEqual([0]);

    layer.animationTracks = {};
    expect(meaningfulTimelineProperties(layer, new Set([0, 12, 24]))).toEqual([]);
    expect(timelineAnimationTracks(layer)).toEqual({});
    expect(timelineLayerKeyframes(layer)).toEqual([]);
  });

  it('hides static lifecycle compatibility tracks and shows value changes', () => {
    const layer = createLayerOfKind('rectangle');
    const base = createDefaultTransform({ x: 100, y: 200, width: 300, height: 100, opacity: 1 });
    layer.keyframes = [
      createLayerKeyframe(0, base),
      createLayerKeyframe(12, { ...base, x: 180 }),
      createLayerKeyframe(24, base),
    ];
    layer.animationTracks = {};
    const lifecycleFrames = new Set([0, 12, 24]);

    expect(meaningfulTimelineProperties(layer, lifecycleFrames)).toContain('x');
    expect(isTimelinePropertyMeaningful(layer, 'y', lifecycleFrames)).toBe(false);
    expect(isTimelinePropertyMeaningful(layer, 'height', lifecycleFrames)).toBe(false);
    expect(timelineAnimationTracks(layer).x?.map((key) => key.frame)).toEqual([0, 12, 24]);
    expect(timelineLayerKeyframes(layer)).toBe(layer.keyframes);
  });

  it('shows explicitly authored non-lifecycle and local-loop tracks even when values are constant', () => {
    const layer = createLayerOfKind('rectangle');
    layer.animationTracks.width = [
      createLayerPropertyKeyframe(0, 300),
      createLayerPropertyKeyframe(7, 300),
    ];
    layer.loop = createLayerLoopClip({
      tracks: {
        opacity: [createLayerPropertyKeyframe(0, 1), createLayerPropertyKeyframe(10, 1)],
      },
    });
    const lifecycleFrames = new Set([0, 12, 24]);

    expect(isTimelinePropertyMeaningful(layer, 'width', lifecycleFrames)).toBe(true);
    expect(isTimelinePropertyMeaningful(layer, 'opacity', lifecycleFrames)).toBe(true);
  });
});
