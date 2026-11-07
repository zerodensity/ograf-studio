import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

describe('chart animation MCP wire input', () => {
  it('admits a chart custom curve on update_element for authoring-core validation', () => {
    expect(
      authoringOperationSchema.safeParse({
        type: 'update_element',
        layerId: 'chart',
        patch: { animation: { type: 'grow', curve: { x1: 0.2, y1: 0, x2: 0.8, y2: 1 } } },
      }).success,
    ).toBe(true);
  });
});
