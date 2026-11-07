import { describe, expect, it } from 'vitest';
import { createComposition, createFieldDefinition } from '@ograf-editor/scene-model';
import { resolveRuntimePreviewDataRecord } from './previewData';

describe('runtime data acknowledgement boundary', () => {
  const composition = createComposition({
    dataFields: [
      createFieldDefinition('boolean', { key: 'active', defaultValue: false }),
      createFieldDefinition('text', { key: 'headline', defaultValue: 'Default' }),
      createFieldDefinition('number', { key: 'count', defaultValue: 3 }),
      createFieldDefinition('array', { key: 'rows', defaultValue: [] }),
    ],
  });
  it('accepts JSON values for declared fields and drops unknown runtime keys', () => {
    expect(
      resolveRuntimePreviewDataRecord(composition, {
        active: true,
        headline: 'News',
        count: 4,
        rows: [{ name: 'First', values: [1, null] }],
        unknown: 'ignored',
      }),
    ).toEqual({
      active: true,
      headline: 'News',
      count: 4,
      rows: [{ name: 'First', values: [1, null] }],
    });
  });
  it('falls back to defaults for non-JSON, cyclic, non-finite or excessive values', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(
      resolveRuntimePreviewDataRecord(composition, {
        active: () => true,
        headline: Symbol('text'),
        count: Number.NaN,
        rows: cycle,
      }),
    ).toEqual({ active: false, headline: 'Default', count: 3, rows: [] });
    expect(
      resolveRuntimePreviewDataRecord(composition, { rows: Array(5000).fill(1) }).rows,
    ).toEqual([]);
  });
});
