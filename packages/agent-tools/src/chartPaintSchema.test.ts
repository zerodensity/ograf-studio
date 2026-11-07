import { describe, expect, it } from 'vitest';
import {
  createDefaultGradient,
  createMediaPaint,
  createShaderPaint,
} from '@ograf-editor/scene-model';
import { authoringOperationSchema } from './schemas';
describe('chart standard Paint MCP operation schema', () => {
  it.each([
    '#2676ef',
    'transparent',
    createDefaultGradient(),
    createShaderPaint(),
    createMediaPaint({ source: { kind: 'clip', src: 'asset:chart-video' } }),
    null,
  ])('preserves a standard fill or explicit palette reset %j', (fill) => {
    const patch = { fill };
    expect(
      authoringOperationSchema.parse({ type: 'update_element', layerId: 'chart', patch }),
    ).toMatchObject({ type: 'update_element', layerId: 'chart', patch });
  });
  it('preserves a chart mark fill and exact provider pin on creation', () => {
    const element = {
      provider: { id: 'chart.provider', version: '1.2.0', sha256: 'a'.repeat(64) },
      fill: createMediaPaint({
        source: { kind: 'live', tag: 'camera-main', fallback: 'asset:still' },
      }),
    };
    expect(
      authoringOperationSchema.parse({ type: 'add_layer', kind: 'chart', element }),
    ).toMatchObject({ type: 'add_layer', kind: 'chart', element });
  });
});
