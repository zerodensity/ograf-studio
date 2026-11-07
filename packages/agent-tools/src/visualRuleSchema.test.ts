import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

const parse = (rule: Record<string, unknown>) =>
  authoringOperationSchema.safeParse({
    type: 'set_layer_visual_rules',
    layerId: 'tab',
    rules: [{ id: 'r', name: 'Rule', enabled: true, ...rule }],
  });

describe('set_layer_visual_rules schema', () => {
  it('requires a valid keyboard configuration and preserves exact modifier and repeat options', () => {
    const action = [{ type: 'toggle-visibility', targetLayerId: 'panel' }];
    for (const trigger of ['key-down', 'key-up']) {
      expect(
        parse({
          trigger,
          keyboard: { key: ' ', ctrl: false, shift: true, alt: false, meta: false, repeat: true },
          delayFrames: 8,
          actions: action,
        }).success,
      ).toBe(true);
      for (const keyboard of [
        undefined,
        { key: '' },
        { key: '\t' },
        { key: 'a', ctrl: 'true' },
        { key: 'a', code: 'KeyA' },
      ])
        expect(parse({ trigger, keyboard, actions: action }).success).toBe(false);
    }
  });
  it('accepts conditions, field comparisons, playout triggers and targeted actions', () => {
    expect(
      parse({
        fieldId: 'home',
        operator: 'greater-than',
        compareFieldId: 'away',
        conditions: [{ fieldId: 'status', operator: 'one-of', value: 'LIVE, HT' }],
        match: 'all',
        actions: [
          {
            type: 'property',
            targetProperty: 'fill',
            value: '#f5c542',
            targetLayerId: 'badge',
            transitionFrames: 12,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      parse({
        trigger: 'step',
        eventId: 'step-2',
        delayFrames: 50,
        actions: [{ type: 'toggle-visibility', targetLayerId: 'panel' }],
      }).success,
    ).toBe(true);
  });

  it('rejects incomplete or contradictory rules', () => {
    expect(parse({ actions: [{ type: 'visibility', visible: true }] }).success).toBe(false);
    expect(parse({ trigger: 'click', actions: [{ type: 'visibility' }] }).success).toBe(false);
    expect(
      parse({ trigger: 'click', actions: [{ type: 'toggle-visibility', visible: true }] }).success,
    ).toBe(false);
    expect(
      parse({ trigger: 'custom-action', actions: [{ type: 'visibility', visible: true }] }).success,
    ).toBe(false);
    expect(
      parse({
        fieldId: 'score',
        delayFrames: 10,
        actions: [{ type: 'visibility', visible: true }],
      }).success,
    ).toBe(false);
    expect(
      parse({
        trigger: 'click',
        conditions: [{ fieldId: 'score', operator: 'increased' }],
        actions: [{ type: 'visibility', visible: true }],
      }).success,
    ).toBe(false);
    expect(
      parse({
        trigger: 'click',
        conditions: [{ fieldId: 'score', operator: 'bigger' }],
        actions: [{ type: 'visibility', visible: true }],
      }).success,
    ).toBe(false);
  });
});
