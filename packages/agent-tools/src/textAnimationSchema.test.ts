import { describe, expect, it } from 'vitest';
import { textAnimationPatchSchema } from './schemas';

describe('counting text animation patches', () => {
  it.each(['roll-up', 'roll-down'] as const)('accepts %s for data and clock updates', (type) => {
    expect(
      textAnimationPatchSchema.parse({ type, replayOnUpdate: true, durationFrames: 10 }),
    ).toEqual({ type, replayOnUpdate: true, durationFrames: 10 });
  });

  it.each(['none', 'up', 'down'] as const)('accepts counter digit motion %s', (countRoll) => {
    expect(textAnimationPatchSchema.parse({ type: 'count-up', countRoll })).toEqual({
      type: 'count-up',
      countRoll,
    });
  });

  it('rejects unknown counter digit motion', () => {
    expect(textAnimationPatchSchema.safeParse({ countRoll: 'sideways' }).success).toBe(false);
  });
  it.each(['count-up', 'count-down'] as const)(
    'accepts %s with explicit and automatic starts',
    (type) => {
      expect(
        textAnimationPatchSchema.parse({ type, countFrom: -12.5, durationFrames: 45 }),
      ).toEqual({ type, countFrom: -12.5, durationFrames: 45 });
      expect(textAnimationPatchSchema.parse({ type, countFrom: null })).toEqual({
        type,
        countFrom: null,
      });
    },
  );

  it.each([Infinity, -Infinity, NaN, '100'])('rejects invalid start %s', (countFrom) => {
    expect(textAnimationPatchSchema.safeParse({ type: 'count-up', countFrom }).success).toBe(false);
  });
});
