import { describe, expect, it } from 'vitest';
import { createComposition, createDefaultTransform } from './factory';
import { buildLayerMotionKeyframes } from './motionPresets';

const onAir = createDefaultTransform({ x: 140, y: 760, width: 1120, height: 170 });

describe('motion presets', () => {
  it('builds a left-to-right wipe mask with directional easing', () => {
    const keys = buildLayerMotionKeyframes({
      composition: createComposition(),
      onAir,
      style: 'wipe',
      entrance: 'left',
      exit: 'down',
      isRevealMask: true,
    });
    expect(keys[0]!.transform).toMatchObject({ x: 140, width: 1 });
    expect(keys[1]).toMatchObject({ frame: 12, easing: 'cubic-out' });
    expect(keys.at(-1)).toMatchObject({ frame: 24, easing: 'cubic-in' });
    expect(keys.at(-1)!.transform.y).toBeGreaterThan(1080);
  });

  it('cascades four layers inside the entrance transition without crossing the Step', () => {
    const composition = createComposition();
    const arrivals = [0, 1, 2, 3].map(
      (cascadeIndex) =>
        buildLayerMotionKeyframes({
          composition,
          onAir,
          style: 'stagger',
          entrance: 'left',
          exit: 'down',
          cascadeIndex,
          cascadeCount: 4,
          staggerFrames: 3,
        }).find((key) => key.frame > 0 && key.transform.x === onAir.x && key.frame <= 12)!.frame,
    );
    expect(arrivals).toEqual([3, 6, 9, 12]);
  });

  it('rejects a cascade that cannot fit before the first Step', () => {
    expect(() =>
      buildLayerMotionKeyframes({
        composition: createComposition(),
        onAir,
        style: 'stagger',
        entrance: 'left',
        exit: 'down',
        cascadeIndex: 0,
        cascadeCount: 4,
        staggerFrames: 4,
      }),
    ).toThrow('Stagger cascade needs at least 14 entrance frames');
  });

  it('keeps every lifecycle pose static for none', () => {
    const keys = buildLayerMotionKeyframes({
      composition: createComposition(),
      onAir,
      style: 'none',
      entrance: 'left',
      exit: 'down',
    });
    expect(keys.every((key) => key.transform.x === onAir.x && key.transform.y === onAir.y)).toBe(
      true,
    );
  });
});
