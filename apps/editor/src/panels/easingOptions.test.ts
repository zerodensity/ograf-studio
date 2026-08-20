import { describe, expect, it } from 'vitest';
import { EASING_OPTION_GROUPS, easingOptions } from './easingOptions';

describe('easing options', () => {
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
