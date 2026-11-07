import { describe, expect, it } from 'vitest';
import type { CompiledDataExposure } from '@ograf-editor/ograf-types';
import { filterExposedData } from './dataExposure';

const policy: Record<string, CompiledDataExposure> = {
  gain: { exposed: false, defaultValue: 0.4 },
  settings: {
    exposed: true,
    properties: {
      secret: { exposed: false, defaultValue: false },
      optics: { exposed: true, properties: { gain: { exposed: false, defaultValue: 0 } } },
      rows: {
        exposed: true,
        items: { exposed: true, properties: { internal: { exposed: false, defaultValue: 0 } } },
      },
    },
  },
};

describe('public playout data filtering', () => {
  it('keeps legacy data identity when there is no exposure policy', () => {
    const data = { arbitrary: { nested: 2 } };
    expect(filterExposedData(data, undefined)).toBe(data);
    expect(filterExposedData(undefined, policy)).toBeUndefined();
  });

  it('removes internal root writes and preserves public and unknown input keys', () => {
    expect(filterExposedData({ gain: 1.8, title: 'Updated', unknown: 4 }, policy)).toEqual({
      title: 'Updated',
      unknown: 4,
    });
  });

  it('retains private values, including false and zero, while updating public siblings', () => {
    const current = { settings: { secret: false, optics: { gain: 0 }, rows: [] } };
    expect(
      filterExposedData(
        { settings: { secret: true, optics: { gain: 2, tint: 'blue' } } },
        policy,
        current,
      ),
    ).toEqual({ settings: { secret: false, optics: { gain: 0, tint: 'blue' }, rows: [] } });
  });

  it('does not erase deeper internal descendants when a public parent patch omits their branch', () => {
    const current = {
      settings: { secret: false, optics: { gain: 0.7 }, rows: [{ internal: 12, label: 'A' }] },
    };
    expect(filterExposedData({ settings: { theme: 'night' } }, policy, current)).toEqual({
      settings: {
        theme: 'night',
        secret: false,
        optics: { gain: 0.7 },
        rows: [{ internal: 12, label: 'A' }],
      },
    });
  });

  it('supplies nested private defaults to new array rows without accepting operator overrides', () => {
    const current = { settings: { rows: [{ internal: 7 }] } };
    expect(
      filterExposedData(
        {
          settings: {
            rows: [
              { internal: 99, label: 'A' },
              { internal: 88, label: 'B' },
            ],
          },
        },
        policy,
        current,
      ),
    ).toEqual({
      settings: {
        secret: false,
        optics: { gain: 0 },
        rows: [
          { internal: 7, label: 'A' },
          { internal: 0, label: 'B' },
        ],
      },
    });
  });

  it.each([null, 'bad', 3, []])(
    'protects private object descendants from malformed parent %j',
    (incoming) => {
      const current = {
        settings: { secret: false, optics: { gain: 1.2 }, rows: [{ internal: 4 }] },
      };
      expect(filterExposedData({ settings: incoming }, policy, current)).toEqual(current);
    },
  );

  it('does not mutate caller input or previous data', () => {
    const input = { settings: { optics: { gain: 9, tint: 'blue' } } };
    const current = { settings: { secret: false, optics: { gain: 0.3 }, rows: [] } };
    const before = structuredClone({ input, current });
    filterExposedData(input, policy, current);
    expect({ input, current }).toEqual(before);
  });
});
