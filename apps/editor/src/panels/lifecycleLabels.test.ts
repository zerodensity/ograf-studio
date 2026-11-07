import { describe, expect, it } from 'vitest';
import { lifecycleLabel } from './lifecycleLabels';

describe('lifecycle display labels', () => {
  it('translates default names without modifying stored values or custom labels', () => {
    const keys = [
      { id: 's', name: 'Start', role: 'start' },
      { id: 'one', name: 'Step 1', role: 'step' },
      { id: 'two', name: 'Step 2', role: 'step' },
      { id: 'end', name: 'End', role: 'end' },
    ] as const;
    expect(keys.map((key) => lifecycleLabel(key, keys))).toEqual([
      'Before',
      'On air',
      'On air · step 2',
      'After',
    ]);
    expect(lifecycleLabel({ ...keys[1], name: 'Result' }, keys)).toBe('Result');
    expect(keys[0].name).toBe('Start');
  });
});
