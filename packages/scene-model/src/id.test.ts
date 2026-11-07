import { describe, expect, it } from 'vitest';
import { createId, createScopedUuid, withStableGeneratedIds } from './id';

describe('stable recipe identity scope', () => {
  it('repeats a seeded sequence, keeps scopes distinct, and restores state after errors', () => {
    const seed = 'recipe-12345678-1234-4567-8912-123456789012';
    const generate = () =>
      withStableGeneratedIds(seed, () => [
        createId('layer'),
        createScopedUuid(),
        createId('field'),
      ]);
    expect(generate()).toEqual(generate());
    expect(generate()[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(withStableGeneratedIds(seed, () => createId('layer'))).not.toBe(
      withStableGeneratedIds('recipe-87654321-1234-4567-8912-123456789012', () =>
        createId('layer'),
      ),
    );
    expect(() =>
      withStableGeneratedIds(seed, () => {
        throw new Error('failure');
      }),
    ).toThrow('failure');
    expect(createId('layer')).not.toContain(seed);
  });
});
