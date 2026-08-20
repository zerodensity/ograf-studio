import { describe, expect, it } from 'vitest';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import { createLayerEffects, createLayerLoopClip } from '@ograf-editor/scene-model';
import { sampleCompiledLayerVisualState } from './loopRendering';

function layer(): CompiledLayer {
  return {
    id: 'pulse',
    isVisible: true,
    element: {
      type: 'rectangle',
      fill: '#fff',
      strokeColor: 'transparent',
      strokeWidth: 0,
      borderRadius: 0,
    },
    effects: createLayerEffects(),
    keyframes: [
      {
        id: 'base',
        frame: 0,
        easing: 'linear',
        transform: {
          x: 100,
          y: 100,
          width: 400,
          height: 120,
          rotation: 0,
          opacity: 1,
          transformOriginX: 0.5,
          transformOriginY: 0.5,
        },
      },
    ],
    animationTracks: {},
    loop: createLayerLoopClip({
      durationFrames: 20,
      tracks: {
        opacity: [
          { id: 'a', frame: 0, value: 0.2, easing: 'linear' },
          { id: 'b', frame: 10, value: 1, easing: 'sine-in-out' },
          { id: 'c', frame: 20, value: 0.2, easing: 'sine-in-out' },
        ],
        width: [
          { id: 'd', frame: 0, value: 400, easing: 'linear' },
          { id: 'e', frame: 10, value: 440, easing: 'back-out' },
          { id: 'f', frame: 20, value: 400, easing: 'quad-in' },
        ],
      },
    }),
    binding: null,
  };
}

describe('compiled loop sampling', () => {
  it('combines independent loop properties over the finite base pose', () => {
    const compiled = layer();
    const atPeak = sampleCompiledLayerVisualState(compiled, 0, 10);
    expect(atPeak.transform.opacity).toBe(1);
    expect(atPeak.transform.width).toBe(440);
    expect(atPeak.transform.x).toBe(100);
    expect(sampleCompiledLayerVisualState(compiled, 0, 30)).toEqual(atPeak);
  });
});
