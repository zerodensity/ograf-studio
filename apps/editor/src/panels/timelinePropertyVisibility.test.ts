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
} from './timelinePropertyVisibility';

describe('meaningful timeline property visibility', () => {
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
