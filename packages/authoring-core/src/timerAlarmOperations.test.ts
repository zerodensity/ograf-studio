import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createLayerOfKind,
  createLayerVisualRule,
  createProject,
  normalizeClockTimerSettings,
  type LayerVisualRule,
} from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

function fixture() {
  const timer = createLayerOfKind('clock');
  timer.id = 'question-timer';
  if (timer.element.type !== 'text') throw new Error('Expected clock text.');
  timer.element.clock = normalizeClockTimerSettings({
    mode: 'count-down',
    initialValueMs: 10000,
    autoStart: false,
  });
  const warning = createLayerOfKind('rectangle');
  warning.id = 'warning';
  const armed = createFieldDefinition('boolean', { id: 'armed', key: 'armed', defaultValue: true });
  const manual = createFieldDefinition('number', {
    id: 'remaining',
    key: 'remaining',
    defaultValue: 10000,
  });
  const composition = createComposition({ layers: [timer, warning], dataFields: [armed, manual] });
  const project = createProject({ compositions: [composition], mainCompositionId: composition.id });
  const session = new AuthoringSession(project);
  const rules = [5000, 0].map((thresholdMs) =>
    createLayerVisualRule({
      id: thresholdMs ? 'five-seconds' : 'time-up',
      name: thresholdMs ? 'Five-second warning' : 'Time up',
      trigger: 'timer-alarm',
      timerAlarm: { sourceLayerId: timer.id, thresholdMs, direction: 'down' },
      conditions: [{ fieldId: armed.id, sourcePath: [], operator: 'equals', value: true }],
      actions: [{ type: 'visibility', visible: true, targetLayerId: warning.id }],
    }),
  );
  return { session, timer, warning, rules };
}

describe('timer alarm authoring operations', () => {
  it('keeps two ordinary guarded Rules owned by another object and bound manual input', () => {
    const { session, timer, warning, rules } = fixture();
    const result = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'set_layer_visual_rules', layerId: warning.id, rules },
        {
          type: 'update_element',
          layerId: timer.id,
          patch: { clock: { source: 'manual', manualValue: 10000 } },
        },
        {
          type: 'set_layer_binding',
          layerId: timer.id,
          binding: { fieldId: 'remaining', targetProperty: 'clock.manualValue' },
        },
      ],
    });
    expect(result.validation.errors).toEqual([]);
    const composition = result.project.compositions[0]!;
    expect(composition.layers.find((layer) => layer.id === warning.id)!.visualRules).toEqual(rules);
    expect(composition.layers.find((layer) => layer.id === timer.id)!.bindings).toContainEqual({
      fieldId: 'remaining',
      targetProperty: 'clock.manualValue',
    });
    const snapshot = session.snapshot();
    expect(
      snapshot.project.compositions[0]!.layers.find(
        (layer) => layer.id === warning.id,
      )!.visualRules.map((rule) => rule.timerAlarm?.thresholdMs),
    ).toEqual([5000, 0]);
  });

  it('rejects invalid sources and thresholds atomically while retaining the prior 5-second and zero alarms', () => {
    const { session, timer, warning, rules } = fixture();
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_layer_visual_rules', layerId: warning.id, rules }],
    });
    const before = session.snapshot();
    const badConfigs: Array<unknown> = [
      undefined,
      { sourceLayerId: 'missing', thresholdMs: 5000, direction: 'down' },
      { sourceLayerId: warning.id, thresholdMs: 5000, direction: 'down' },
      { sourceLayerId: timer.id, thresholdMs: -1, direction: 'down' },
      { sourceLayerId: timer.id, thresholdMs: Infinity, direction: 'down' },
    ];
    for (const timerAlarm of badConfigs) {
      const bad = { ...rules[0], timerAlarm } as LayerVisualRule;
      expect(() =>
        session.apply({
          expectedRevision: 1,
          operations: [{ type: 'set_layer_visual_rules', layerId: warning.id, rules: [bad] }],
        }),
      ).toThrow(/Timer alarm/);
      expect(session.snapshot()).toEqual(before);
    }
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [
          { type: 'set_layer_flags', layerId: timer.id, isGuide: true },
          { type: 'set_layer_visual_rules', layerId: warning.id, rules },
        ],
      }),
    ).toThrow(/Timer alarm source/);
    expect(session.snapshot()).toEqual(before);
  });

  it('prunes both linked alarms when their timer layer is deleted', () => {
    const { session, timer, warning, rules } = fixture();
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_layer_visual_rules', layerId: warning.id, rules }],
    });
    const result = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'remove_layer', layerId: timer.id }],
    });
    expect(result.validation.errors).toEqual([]);
    expect(
      result.project.compositions[0]!.layers.find((layer) => layer.id === warning.id)!.visualRules,
    ).toEqual([]);
  });

  it.each(['remove clock', 'promote guide'] as const)(
    'prunes linked alarms when the source becomes invalid: %s',
    (change) => {
      const { session, timer, warning, rules } = fixture();
      session.apply({
        expectedRevision: 0,
        operations: [{ type: 'set_layer_visual_rules', layerId: warning.id, rules }],
      });
      const result = session.apply({
        expectedRevision: 1,
        operations: [
          change === 'remove clock'
            ? { type: 'update_element', layerId: timer.id, patch: { clock: null } }
            : { type: 'set_layer_flags', layerId: timer.id, isGuide: true },
        ],
      });
      expect(result.validation.errors).toEqual([]);
      expect(
        result.project.compositions[0]!.layers.find((layer) => layer.id === warning.id)!
          .visualRules,
      ).toEqual([]);
    },
  );

  it('rejects linking an alarm to plain text without a clock feature', () => {
    const { session, timer, warning, rules } = fixture();
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'update_element', layerId: timer.id, patch: { clock: null } }],
    });
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [{ type: 'set_layer_visual_rules', layerId: warning.id, rules }],
      }),
    ).toThrow(/Timer alarm source/);
  });
});
