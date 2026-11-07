import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

describe('renderer plugin removal schema', () => {
  const reference = { id: 'test.chart', version: '0.0.0', sha256: 'a'.repeat(64) };
  it('accepts an explicit exact reference and optional composition scope', () => {
    expect(authoringOperationSchema.parse({ type: 'remove_renderer_plugin', reference })).toEqual({
      type: 'remove_renderer_plugin',
      reference,
    });
    expect(
      authoringOperationSchema.parse({
        type: 'remove_renderer_plugin',
        reference,
        compositionId: 'main',
      }),
    ).toEqual({
      type: 'remove_renderer_plugin',
      reference,
      compositionId: 'main',
    });
  });
  it.each([undefined, null, { ...reference, sha256: '' }, { ...reference, version: '' }])(
    'rejects incomplete exact references %j',
    (requested) => {
      expect(
        authoringOperationSchema.safeParse({ type: 'remove_renderer_plugin', reference: requested })
          .success,
      ).toBe(false);
    },
  );
});
