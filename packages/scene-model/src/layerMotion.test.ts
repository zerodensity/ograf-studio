import { describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  createComposition,
  createLayerKeyframe,
  createLayerOfKind,
  defaultTransformForRole,
  getLayerPropertyValueAtFrame,
  type Layer,
} from './index';
import {
  applyLayerMotion,
  defaultLayerMotionSpec,
  layerMotionStagger,
  layerMotionStaggerOffsets,
  layerMotionState,
  layerMotionStyleAvailable,
  layerMotionWindows,
} from './layerMotion';
import type { AnimatableLayerProperty } from './types';

function setup(kind: 'rectangle' | 'text' = 'rectangle') {
  const composition = createComposition();
  const layer: Layer = createLayerOfKind(kind);
  const frames = computeKeyframeFrames(composition);
  layer.keyframes = composition.keyframes.map((keyframe, index) =>
    createLayerKeyframe(frames[index]!.frame, {
      ...defaultTransformForRole(layer.element.type, keyframe.role),
      x: 200,
      y: 300,
      width: 400,
      height: 100,
      opacity: 1,
    }),
  );
  layer.animationTracks = {};
  composition.layers.push(layer);
  return { composition, layer, windows: layerMotionWindows(composition)! };
}

const at = (layer: Layer, property: AnimatableLayerProperty, frame: number) =>
  getLayerPropertyValueAtFrame(layer, property, frame);
const keyAt = (layer: Layer, property: AnimatableLayerProperty, frame: number) =>
  layer.animationTracks[property]?.find((key) => key.frame === frame);

describe('Animate In/Out', () => {
  it('uses Start to first Step for in and last Step to End for out', () => {
    const { windows } = setup();
    expect(windows).toMatchObject({ start: 0, firstStep: 12, lastStep: 12, end: 24 });
    expect(windows.inFrames).toBe(12);
    expect(windows.outFrames).toBe(12);
  });

  it('slides and fades in, then holds its on-air pose', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', {
      style: 'slide',
      direction: 'left',
      distance: 80,
      durationFrames: 8,
    });
    expect(at(layer, 'x', 0)).toBe(120);
    expect(at(layer, 'x', 4)).toBe(120);
    expect(at(layer, 'opacity', 4)).toBe(0);
    expect(at(layer, 'x', 8)).toBeGreaterThan(120);
    expect(at(layer, 'x', 12)).toBe(200);
    expect(at(layer, 'opacity', 12)).toBe(1);
    expect(at(layer, 'x', 20)).toBe(200);
    expect(layerMotionState(composition, layer, 'in')).toMatchObject({ style: 'slide' });
    expect(layer.keyframes.map((key) => key.frame)).toEqual([0, 4, 12, 24]);
  });

  it('flies out past the canvas edge and clamps to the window', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'out', {
      style: 'fly',
      direction: 'right',
      durationFrames: 50,
    });
    expect(at(layer, 'x', 12)).toBe(200);
    expect(at(layer, 'x', 24)).toBe(composition.width + 40);
    expect(layer.motion?.out?.durationFrames).toBe(12);
  });

  it('replaces an earlier choice and can go back to none', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', defaultLayerMotionSpec('slide', 12));
    applyLayerMotion(composition, layer, 'in', { style: 'fade', durationFrames: 6 });
    expect(at(layer, 'x', 0)).toBe(200);
    expect(at(layer, 'opacity', 3)).toBe(0);
    applyLayerMotion(composition, layer, 'in', null);
    expect(at(layer, 'opacity', 0)).toBe(1);
    expect(at(layer, 'x', 0)).toBe(200);
    expect(layerMotionState(composition, layer, 'in')).toBeNull();
    expect(layer.keyframes.map((key) => key.frame)).toEqual([0, 12, 24]);
  });

  it('un-blurs with Focus when the layer has a blur to animate', () => {
    const { composition, layer } = setup('text');
    applyLayerMotion(composition, layer, 'in', { style: 'focus', durationFrames: 12 });
    expect(at(layer, 'blur', 0)).toBe(24);
    expect(at(layer, 'blur', 12)).toBe(0);
    expect(at(layer, 'opacity', 0)).toBe(0);
  });

  it('reports hand-made motion as custom until a choice replaces it', () => {
    const { composition, layer } = setup();
    layer.keyframes[0]!.transform.y = 900;
    expect(layerMotionState(composition, layer, 'in')).toBe('custom');
    expect(layerMotionState(composition, layer, 'out')).toBeNull();
  });

  it.each([
    'rotation',
    'scale',
    'clipLeft',
    'clipRight',
    'clipTop',
    'clipBottom',
    'width',
    'height',
  ] as const)('reports animated %s as custom without needing stored provenance', (property) => {
    const { composition, layer } = setup();
    layer.animationTracks[property] = [
      {
        id: 'first',
        frame: 0,
        value: property === 'width' || property === 'height' ? 20 : 0,
        easing: 'linear',
      },
      {
        id: 'anchor',
        frame: 12,
        value: property === 'width' || property === 'height' ? 100 : 1,
        easing: 'linear',
      },
    ];
    expect(layerMotionState(composition, layer, 'in')).toBe('custom');
    expect(layerMotionState(composition, layer, 'out')).toBeNull();
  });

  it.each([
    'rotation',
    'scale',
    'clipLeft',
    'clipRight',
    'clipTop',
    'clipBottom',
    'width',
    'height',
  ] as const)('keeps static %s channels classified as no motion', (property) => {
    const { composition, layer } = setup();
    layer.animationTracks[property] = [
      { id: 'first', frame: 0, value: 1, easing: 'linear' },
      { id: 'anchor', frame: 12, value: 1, easing: 'linear' },
      { id: 'end', frame: 24, value: 1, easing: 'linear' },
    ];
    expect(layerMotionState(composition, layer, 'in')).toBeNull();
    expect(layerMotionState(composition, layer, 'out')).toBeNull();
  });

  it('wipes in from an edge and drops the inset track when another style replaces it', () => {
    const { composition, layer } = setup('text');
    applyLayerMotion(composition, layer, 'in', defaultLayerMotionSpec('wipe', 12));
    expect(layer.motion?.in).toMatchObject({ style: 'wipe', direction: 'left' });
    expect(at(layer, 'clipRight', 0)).toBe(1);
    applyLayerMotion(composition, layer, 'in', {
      style: 'wipe',
      direction: 'down',
      durationFrames: 12,
    });
    expect(layer.animationTracks.clipRight).toBeUndefined();
    expect(at(layer, 'clipTop', 0)).toBe(1);
    expect(at(layer, 'clipRight', 12)).toBe(0);
    expect(at(layer, 'opacity', 0)).toBe(1);
    applyLayerMotion(composition, layer, 'in', {
      style: 'wipe',
      direction: 'center',
      durationFrames: 12,
    });
    expect(at(layer, 'clipLeft', 0)).toBe(0.5);
    expect(at(layer, 'clipRight', 0)).toBe(0.5);
    applyLayerMotion(composition, layer, 'in', { style: 'fade', durationFrames: 12 });
    expect(layer.animationTracks.clipLeft).toBeUndefined();
    expect(layer.animationTracks.clipRight).toBeUndefined();
  });

  it('pops with an overshoot and scales out', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', { style: 'pop', durationFrames: 12 });
    expect(at(layer, 'scale', 0)).toBe(0);
    expect(keyAt(layer, 'scale', 12)).toMatchObject({ value: 1, easing: 'back-out' });
    expect(at(layer, 'scale', 10)).toBeGreaterThan(1);
    applyLayerMotion(composition, layer, 'out', { style: 'scale', durationFrames: 12 });
    expect(at(layer, 'scale', 24)).toBe(0.5);
    expect(at(layer, 'opacity', 24)).toBe(0);
    expect(at(layer, 'scale', 12)).toBe(1);
  });

  it('grows from an edge on shapes but not on text', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', {
      style: 'grow',
      direction: 'right',
      durationFrames: 12,
    });
    expect(at(layer, 'width', 0)).toBe(0);
    expect(at(layer, 'x', 0)).toBe(600);
    expect(at(layer, 'width', 12)).toBe(400);
    expect(at(layer, 'x', 12)).toBe(200);
    applyLayerMotion(composition, layer, 'in', null);
    expect(at(layer, 'width', 0)).toBe(400);
    expect(layerMotionStyleAvailable(setup('text').layer, 'grow')).toBe(false);
  });

  it('spins in and out the way the direction turns', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', defaultLayerMotionSpec('spin', 12));
    applyLayerMotion(composition, layer, 'out', defaultLayerMotionSpec('spin', 12));
    expect(at(layer, 'rotation', 0)).toBe(-90);
    expect(at(layer, 'rotation', 24)).toBe(90);
    applyLayerMotion(composition, layer, 'in', {
      style: 'spin',
      direction: 'left',
      durationFrames: 12,
    });
    expect(at(layer, 'rotation', 0)).toBe(90);
    expect(at(layer, 'rotation', 12)).toBe(0);
  });

  it('drops in from above with a bounce and falls out below', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', defaultLayerMotionSpec('drop', 12));
    applyLayerMotion(composition, layer, 'out', defaultLayerMotionSpec('drop', 12));
    expect(at(layer, 'y', 0)).toBe(-140);
    expect(keyAt(layer, 'y', 12)?.easing).toBe('bounce-out');
    expect(at(layer, 'y', 24)).toBe(composition.height + 40);
    expect(layer.motion?.in).not.toHaveProperty('direction');
  });

  it('staggers by finishing earlier and holding until the Step', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', {
      style: 'fade',
      durationFrames: 6,
      offsetFrames: 4,
    });
    expect(at(layer, 'opacity', 2)).toBe(0);
    expect(at(layer, 'opacity', 8)).toBe(1);
    expect(at(layer, 'opacity', 12)).toBe(1);
    applyLayerMotion(composition, layer, 'out', {
      style: 'fade',
      durationFrames: 6,
      offsetFrames: 50,
    });
    expect(layer.motion?.out?.offsetFrames).toBe(6);
    expect(at(layer, 'opacity', 18)).toBe(0);
    expect(at(layer, 'opacity', 24)).toBe(0);
  });

  it('orders a stagger by position and reads it back from the offsets', () => {
    const { composition, layer: left } = setup();
    const right = structuredClone(left);
    right.id = 'right-layer';
    for (const key of right.keyframes) key.transform.x = 900;
    composition.layers.push(right);
    const layers = [right, left];
    const offsets = layerMotionStaggerOffsets(composition, layers, 'in', {
      frames: 3,
      order: 'left-to-right',
    });
    expect(offsets.get(left.id)).toBe(3);
    expect(offsets.get(right.id)).toBe(0);
    for (const layer of layers)
      applyLayerMotion(composition, layer, 'in', {
        style: 'slide',
        durationFrames: 6,
        offsetFrames: layerMotionStaggerOffsets(composition, layers, 'in', {
          frames: 3,
          order: 'right-to-left',
        }).get(layer.id)!,
      });
    expect(layerMotionStagger(composition, layers, 'in')).toEqual({
      frames: 3,
      order: 'right-to-left',
    });
  });
});
