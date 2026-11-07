import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createLayerOfKind,
  createLayerKeyframe,
  createDefaultTransform,
  applyStylePack,
  layerMotionWindows,
} from '@ograf-editor/scene-model';
import { groupMotionPlan } from './groupMotion';

describe('Animate group', () => {
  it('brings panel, headline and subline in order and takes them out in reverse within the lifecycle', () => {
    const composition = createComposition();
    const panel = createLayerOfKind('rectangle');
    const headline = createLayerOfKind('text');
    const subline = createLayerOfKind('text');
    for (const layer of [panel, headline, subline])
      layer.keyframes.push(createLayerKeyframe(0, createDefaultTransform()));
    if (headline.element.type !== 'text' || subline.element.type !== 'text')
      throw new Error('expected text');
    headline.element.fontSize = 60;
    subline.element.fontSize = 30;
    composition.layers.push(subline, headline, panel);
    const inPlan = groupMotionPlan(composition, composition.layers, 'in');
    const outPlan = groupMotionPlan(composition, composition.layers, 'out');
    expect(inPlan.map((item) => item.layerId)).toEqual([panel.id, headline.id, subline.id]);
    expect(inPlan.map((item) => item.spec.style)).toEqual(['wipe', 'slide', 'slide']);
    expect(inPlan[0]!.spec.offsetFrames).toBeGreaterThan(inPlan[2]!.spec.offsetFrames!);
    expect(outPlan[0]!.spec.offsetFrames).toBeLessThan(outPlan[2]!.spec.offsetFrames!);
    const windows = layerMotionWindows(composition)!;
    for (const item of inPlan)
      expect(item.spec.durationFrames + (item.spec.offsetFrames ?? 0)).toBeLessThanOrEqual(
        windows.inFrames,
      );
    for (const item of outPlan)
      expect(item.spec.durationFrames + (item.spec.offsetFrames ?? 0)).toBeLessThanOrEqual(
        windows.outFrames,
      );
  });

  it('uses Brand Kit motion tokens while fitting the lifecycle window', () => {
    const composition = createComposition();
    applyStylePack(composition, 'sports');
    const panel = createLayerOfKind('rectangle');
    const text = createLayerOfKind('text');
    for (const layer of [panel, text])
      layer.keyframes.push(createLayerKeyframe(0, createDefaultTransform()));
    const incoming = groupMotionPlan(composition, [panel, text], 'in');
    expect(incoming.every((item) => item.spec.easing === 'expo-out')).toBe(true);
    expect(incoming[0]!.spec.durationFrames).toBe(8);
    expect(incoming[0]!.spec.offsetFrames).toBe(2);
  });

  it('honors custom Brand Kit motion tokens without requiring a built-in pack', () => {
    const composition = createComposition();
    composition.designSystem.tokens.push(
      {
        id: 'dur',
        key: 'motion.entrance.frames',
        name: 'Entrance',
        type: 'number',
        value: 5,
        description: '',
      },
      {
        id: 'ease',
        key: 'motion.entrance.easing',
        name: 'Ease',
        type: 'text',
        value: 'linear',
        description: '',
      },
      {
        id: 'stagger',
        key: 'motion.stagger.frames',
        name: 'Stagger',
        type: 'number',
        value: 2,
        description: '',
      },
    );
    const first = createLayerOfKind('rectangle');
    const second = createLayerOfKind('text');
    for (const layer of [first, second])
      layer.keyframes.push(createLayerKeyframe(0, createDefaultTransform()));
    const incoming = groupMotionPlan(composition, [first, second], 'in');
    expect(incoming[0]!.spec).toMatchObject({
      durationFrames: 5,
      easing: 'linear',
      offsetFrames: 2,
    });
  });
});
