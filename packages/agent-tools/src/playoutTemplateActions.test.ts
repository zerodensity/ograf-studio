import { describe, expect, it } from 'vitest';
import { livePlayoutOperationSchema, livePlayoutRequestSchema } from './playoutSchemas';

describe('scoped template actions in MCP playout', () => {
  it('preserves lane, action and bounded payload through command admission', () => {
    const operation = {
      type: 'template-action',
      slotId: 'main',
      actionId: 'show-ad',
      data: { headline: 'Advertising', mode: { active: true } },
    };
    const request = {
      action: 'command',
      expectedRevision: 'playout:12',
      requestId: 'action-1',
      operation,
    };
    expect(livePlayoutRequestSchema.parse(request)).toEqual(request);
  });
  it.each([
    { type: 'template-action', actionId: 'show-ad' },
    { type: 'template-action', slotId: 'main', actionId: '' },
    { type: 'template-action', slotId: 'main', actionId: 'a'.repeat(257) },
    { type: 'template-action', slotId: 'main', actionId: 'show-ad', data: { amount: Number.NaN } },
    {
      type: 'template-action',
      slotId: 'main',
      actionId: 'show-ad',
      data: { text: 'x'.repeat(65537) },
    },
    { type: 'template-action', slotId: 'main', actionId: 'show-ad', templateId: 'other' },
  ])('rejects invalid or unbounded operations', (operation) => {
    expect(livePlayoutOperationSchema.safeParse(operation).success).toBe(false);
  });
});
