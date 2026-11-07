import { describe, expect, it } from 'vitest';
import { livePlayoutOperationSchema } from './playoutSchemas';
describe('independent loop commands', () => {
  it.each(['pause', 'resume', 'next'])(
    'preserves %s group targeting across the MCP contract',
    (action) => {
      const operation = { type: 'loop', slotId: 'alert', groupId: 'headlines', action };
      expect(livePlayoutOperationSchema.parse(operation)).toEqual(operation);
    },
  );
  it.each([
    { type: 'loop', slotId: 'alert', groupId: '', action: 'pause' },
    { type: 'loop', groupId: 'headlines', action: 'resume' },
    { type: 'loop', slotId: 'alert', groupId: 'headlines', action: 'rewind' },
    { type: 'loop', slotId: 'alert', groupId: 'headlines', action: 'next', data: {} },
  ])('rejects invalid loop commands', (operation) => {
    expect(livePlayoutOperationSchema.safeParse(operation).success).toBe(false);
  });
});
