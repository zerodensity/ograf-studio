import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';
import { mcpTemplateSetOperationSchema, templateSetOperationSchema } from './templateSetSchemas';

describe('output layer agent schemas', () => {
  it.each([Number.MIN_SAFE_INTEGER, -1, 0, Number.MAX_SAFE_INTEGER])(
    'accepts safe integer %s in both scopes',
    (outputLayer) => {
      expect(
        authoringOperationSchema.parse({ type: 'set_project_metadata', outputLayer }),
      ).toMatchObject({ outputLayer });
      for (const schema of [templateSetOperationSchema, mcpTemplateSetOperationSchema])
        expect(schema.parse({ type: 'set_output_layer', outputLayer })).toEqual({
          type: 'set_output_layer',
          outputLayer,
        });
    },
  );

  it.each([null, '1', 0.5, NaN, Infinity, -(2 ** 53), 2 ** 53])(
    'rejects %j without coercion',
    (outputLayer) => {
      expect(
        authoringOperationSchema.safeParse({ type: 'set_project_metadata', outputLayer }).success,
      ).toBe(false);
      expect(
        templateSetOperationSchema.safeParse({ type: 'set_output_layer', outputLayer }).success,
      ).toBe(false);
    },
  );

  it('does not make the package value an inheritable setting', () => {
    expect(
      templateSetOperationSchema.safeParse({ type: 'set_defaults', patch: { outputLayer: 1 } })
        .success,
    ).toBe(false);
    expect(templateSetOperationSchema.safeParse({ type: 'set_output_layer' }).success).toBe(false);
  });
});
