import { describe, expect, it } from 'vitest';
import { MAX_TIMER_VALUE_MS } from '@ograf-editor/scene-model';
import { authoringOperationSchema } from './schemas';

const validAlarm = { sourceLayerId: 'question-timer', thresholdMs: 5000, direction: 'down' };
const parse = (overrides: Record<string, unknown> = {}) =>
  authoringOperationSchema.safeParse({
    type: 'set_layer_visual_rules',
    layerId: 'warning-group-member',
    rules: [
      {
        id: 'five-seconds',
        name: 'Rule #1',
        enabled: true,
        trigger: 'timer-alarm',
        timerAlarm: validAlarm,
        actions: [
          {
            type: 'property',
            targetProperty: 'fill',
            value: '#ff0000',
            targetLayerId: 'question-timer',
          },
        ],
        ...overrides,
      },
    ],
  });

describe('MCP timer alarm authoring schema', () => {
  it('accepts independently owned 5-second and zero alarms with guards and normal actions', () => {
    expect(
      parse({
        conditions: [{ fieldId: 'armed', operator: 'equals', value: true }],
        actions: [
          {
            type: 'property',
            targetProperty: 'fill',
            value: '#ff0000',
            targetLayerId: 'question-timer',
          },
          { type: 'playout', operation: 'take', slotId: 'warning', stateId: 'warning-on' },
        ],
      }).success,
    ).toBe(true);
    expect(parse({ id: 'time-up', timerAlarm: { ...validAlarm, thresholdMs: 0 } }).success).toBe(
      true,
    );
    expect(
      parse({ timerAlarm: { ...validAlarm, thresholdMs: MAX_TIMER_VALUE_MS, direction: 'up' } })
        .success,
    ).toBe(true);
    expect(parse({ actions: [] }).success).toBe(true);
  });

  it('requires a full explicit alarm configuration', () => {
    for (const timerAlarm of [
      undefined,
      null,
      {},
      [],
      { thresholdMs: 5000, direction: 'down' },
      { ...validAlarm, sourceLayerId: '' },
      { sourceLayerId: 'timer', direction: 'down' },
      { sourceLayerId: 'timer', thresholdMs: 0 },
    ])
      expect(parse({ timerAlarm }).success, JSON.stringify(timerAlarm)).toBe(false);
  });

  it('rejects invalid thresholds, directions and unsupported alarm properties', () => {
    for (const thresholdMs of [-1, NaN, Infinity, -Infinity, MAX_TIMER_VALUE_MS + 1, '5000', null])
      expect(parse({ timerAlarm: { ...validAlarm, thresholdMs } }).success).toBe(false);
    expect(parse({ timerAlarm: { ...validAlarm, direction: 'downward' } }).success).toBe(false);
    expect(parse({ timerAlarm: { ...validAlarm, repeats: true } }).success).toBe(false);
  });
});
