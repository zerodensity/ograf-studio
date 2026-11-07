import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

describe('animation preset operation schema', () => {
  const operation = {
    type: 'apply_animation_preset',
    layerName: 'Panel',
    reference: { id: 'test.motion', version: '1.0.0', sha256: 'a'.repeat(64) },
    presetId: 'slide',
    side: 'in',
    durationFrames: 12,
    parameters: { distance: 100 },
  };
  it('accepts exact pins, names and finite numeric parameters', () => {
    expect(authoringOperationSchema.parse(operation)).toEqual(operation);
  });
  it.each([
    { side: 'hover' },
    { durationFrames: 0 },
    { durationFrames: 1.5 },
    { offsetFrames: -1 },
    { parameters: { distance: '100' } },
    { parameters: { distance: Infinity } },
    { source: 'alert(1)' },
    { reference: { id: 'test.motion', version: '1.0.0', sha256: '' } },
  ])('rejects unsupported input %j', (patch) => {
    expect(authoringOperationSchema.safeParse({ ...operation, ...patch }).success).toBe(false);
  });
});
