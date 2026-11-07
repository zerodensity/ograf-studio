import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

describe('Nodos metadata in MCP field schemas', () => {
  it('keeps nested declarations and supports explicitly clearing an assignment', () => {
    const parsed = authoringOperationSchema.parse({
      type: 'add_data_field',
      fieldType: 'array',
      key: 'positions',
      items: {
        key: 'position',
        fieldType: 'object',
        nodosType: 'nos.fb.vec2',
        properties: [
          { key: 'x', fieldType: 'number' },
          { key: 'y', fieldType: 'number' },
        ],
      },
    });
    expect(parsed).toMatchObject({ items: { nodosType: 'nos.fb.vec2' } });
    expect(
      authoringOperationSchema.parse({
        type: 'update_data_field',
        fieldKey: 'positions',
        nodosType: null,
      }),
    ).toMatchObject({ nodosType: null });
    expect(
      authoringOperationSchema.parse({
        type: 'update_data_field',
        fieldKey: 'positions',
        nodosType: 'nos.fb.vec4',
      }),
    ).toMatchObject({ nodosType: 'nos.fb.vec4' });
  });
  it.each(['', '../type', '[nos.fb.vec4]', 'x'.repeat(257)])(
    'rejects invalid type name %s',
    (nodosType) => {
      expect(
        authoringOperationSchema.safeParse({
          type: 'add_data_field',
          fieldType: 'object',
          key: 'data',
          nodosType,
        }).success,
      ).toBe(false);
      expect(
        authoringOperationSchema.safeParse({
          type: 'update_data_field',
          fieldKey: 'data',
          nodosType,
        }).success,
      ).toBe(false);
      expect(
        authoringOperationSchema.safeParse({
          type: 'add_data_field',
          fieldType: 'array',
          key: 'data',
          items: { key: 'item', fieldType: 'object', nodosType },
        }).success,
      ).toBe(false);
    },
  );
});
