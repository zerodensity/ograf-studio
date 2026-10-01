import { easedProgress, evaluateExpression } from '@ograf-editor/scene-model';
import { describe, expect, it } from 'vitest';
import { EASING_OPTION_GROUPS, easingOptions } from './easingOptions';

describe('easing options', () => {
  it.each(easingOptions())('matches keyframe easing for $value', ({ value }) => {
    // Include boundaries, fractional frames, reverse seeking, and progress beyond the interval.
    for (const t of [0, 0.125, 0.4, 0.75, 1, -0.2, 1.2, 0.125]) {
      expect(evaluateExpression(`ease(25, -75, t, "${value}")`, { t })).toBeCloseTo(
        25 - 100 * easedProgress(Math.min(1, Math.max(0, t)), value),
        12,
      );
    }
  });

  it('offers the common easing families with directional variants', () => {
    expect(EASING_OPTION_GROUPS.map((group) => group.label)).toEqual([
      'Basic',
      'Cubic',
      'Quart',
      'Quint',
      'Sine',
      'Expo',
      'Circ',
      'Back',
      'Bounce',
      'Elastic',
    ]);
    expect(easingOptions()).toHaveLength(31);
    expect(easingOptions().map((option) => option.value)).toContain('elastic-in-out');
    expect(easingOptions().find((option) => option.value === 'sine-out')?.label).toBe('Sine Out');
    expect(easingOptions().find((option) => option.value === 'elastic-in-out')?.label).toBe(
      'Elastic In / Out',
    );
  });
});
