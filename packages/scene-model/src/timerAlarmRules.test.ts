import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  createComposition,
  createLayerOfKind,
  createLayerVisualRule,
  firedVisualRuleEventRules,
  instantiateComponentDefinition,
  isVisualRuleState,
  MAX_TIMER_VALUE_MS,
  normalizeLayerVisualRule,
  pruneVisualRuleReferences,
  reconcileComponentInstances,
  remapVisualRule,
  validateTimerAlarmTrigger,
  visualRuleReferencedLayerIds,
  visualRuleTargetLayerIds,
  VISUAL_RULE_TRIGGER_VALUES,
  type LayerVisualRule,
  type VisualRuleCondition,
  type VisualRuleEngine,
} from './index';

const alarm = (overrides: Partial<LayerVisualRule> = {}) =>
  createLayerVisualRule({
    id: 'five-seconds',
    trigger: 'timer-alarm',
    timerAlarm: { sourceLayerId: 'timer', thresholdMs: 5000, direction: 'down' },
    ...overrides,
  });

describe('timer alarm rule contract', () => {
  it('keeps multiple alarms as ordinary event Rules with separate identity and thresholds', () => {
    const rules = [
      alarm(),
      alarm({
        id: 'time-up',
        timerAlarm: {
          sourceLayerId: 'timer',
          thresholdMs: 0,
          direction: 'down',
        },
      }),
    ];
    expect(VISUAL_RULE_TRIGGER_VALUES).toContain('timer-alarm');
    expect(rules.every((rule) => !isVisualRuleState(rule))).toBe(true);
    expect(JSON.parse(JSON.stringify(rules))).toEqual(rules);
    expect(normalizeLayerVisualRule(rules[0]!)).toEqual(rules[0]);
  });

  it('validates finite nonnegative thresholds and an existing clock source, allowing retained clock-mode configuration', () => {
    const timer = createLayerOfKind('clock');
    const source = { sourceLayerId: timer.id, thresholdMs: 0, direction: 'down' };
    expect(validateTimerAlarmTrigger(source, [timer])).toEqual([]);
    expect(
      validateTimerAlarmTrigger({ ...source, thresholdMs: MAX_TIMER_VALUE_MS }, [timer]),
    ).toEqual([]);
    for (const thresholdMs of [-1, NaN, Infinity, MAX_TIMER_VALUE_MS + 1, '5000', null])
      expect(validateTimerAlarmTrigger({ ...source, thresholdMs }, [timer])).not.toEqual([]);
    for (const value of [undefined, null, [], true])
      expect(validateTimerAlarmTrigger(value)).not.toEqual([]);
    expect(validateTimerAlarmTrigger({ ...source, sourceLayerId: '' })).not.toEqual([]);
    expect(validateTimerAlarmTrigger({ ...source, direction: 'sideways' })).not.toEqual([]);
    expect(validateTimerAlarmTrigger(source, [])).not.toEqual([]);
    expect(validateTimerAlarmTrigger(source, [{ ...timer, isGuide: true }])).not.toEqual([]);
    expect(
      validateTimerAlarmTrigger({ ...source, sourceLayerId: 'shape' }, [
        { ...createLayerOfKind('rectangle'), id: 'shape' },
      ]),
    ).not.toEqual([]);
    if (timer.element.type !== 'text') throw new Error('Expected text.');
    delete timer.element.clock;
    expect(validateTimerAlarmTrigger(source, [timer])).not.toEqual([]);
  });

  it('routes the alarm by source timer and rule ID independently of a retargeted owner, with normal condition guards', () => {
    const first = alarm({
      conditions: [{ fieldId: 'armed', sourcePath: [], operator: 'equals', value: true }],
    });
    const second = alarm({
      id: 'time-up',
      timerAlarm: {
        sourceLayerId: 'timer',
        thresholdMs: 0,
        direction: 'down',
      },
    });
    const engine: VisualRuleEngine<
      VisualRuleCondition,
      LayerVisualRule,
      Record<string, unknown>
    > = {
      hosts: [{ layerId: 'warning-graphic', rules: [first, second] }],
      reader: {
        read: (condition, _host, data) => data[condition.fieldId],
        readCompare: () => null,
      },
    };
    const fire = (scope: { hostLayerId?: string; eventId?: string }, armed = true) =>
      firedVisualRuleEventRules(engine, 'timer-alarm', { armed }, scope);
    expect(fire({ hostLayerId: 'timer', eventId: first.id })).toEqual([
      { hostLayerId: 'warning-graphic', rule: first },
    ]);
    expect(fire({ hostLayerId: 'timer', eventId: second.id })).toEqual([
      { hostLayerId: 'warning-graphic', rule: second },
    ]);
    expect(fire({ hostLayerId: 'timer', eventId: first.id }, false)).toEqual([]);
    expect(fire({ hostLayerId: 'warning-graphic', eventId: first.id })).toEqual([]);
    expect(fire({ hostLayerId: 'other-timer', eventId: first.id })).toEqual([]);
    expect(fire({ hostLayerId: 'timer' })).toEqual([]);
    expect(fire({ eventId: first.id })).toEqual([]);
    first.enabled = false;
    expect(fire({ hostLayerId: 'timer', eventId: first.id })).toEqual([]);
  });

  it('remaps source IDs on copy while preserving external references and the original Rule', () => {
    const original = alarm({
      actions: [{ type: 'visibility', visible: true, targetLayerId: 'warning' }],
    });
    const copy = remapVisualRule(original, {
      layerIds: new Map([
        ['timer', 'timer-copy'],
        ['warning', 'warning-copy'],
      ]),
    });
    expect(copy.id).not.toBe(original.id);
    expect(copy.timerAlarm).toEqual({
      sourceLayerId: 'timer-copy',
      thresholdMs: 5000,
      direction: 'down',
    });
    expect(visualRuleReferencedLayerIds(copy)).toEqual(['timer-copy', 'warning-copy']);
    expect(visualRuleTargetLayerIds(copy)).toEqual(['warning-copy']);
    expect(original.timerAlarm?.sourceLayerId).toBe('timer');
    expect(remapVisualRule(original).timerAlarm).toEqual(original.timerAlarm);
  });

  it('disambiguates equal Rule IDs on different owners without changing legacy dispatch behavior', () => {
    const fiveSeconds = alarm();
    const zero = alarm({
      timerAlarm: {
        sourceLayerId: 'timer',
        thresholdMs: 0,
        direction: 'down',
      },
    });
    const engine: VisualRuleEngine<
      VisualRuleCondition,
      LayerVisualRule,
      Record<string, unknown>
    > = {
      hosts: [
        { layerId: 'warning-graphic', rules: [fiveSeconds] },
        { layerId: 'ending-graphic', rules: [zero] },
      ],
      reader: { read: () => undefined, readCompare: () => null },
    };
    const scope = { hostLayerId: 'timer', eventId: 'five-seconds' };
    expect(
      firedVisualRuleEventRules(
        engine,
        'timer-alarm',
        {},
        {
          ...scope,
          timerAlarmOwnerLayerId: 'warning-graphic',
        },
      ),
    ).toEqual([{ hostLayerId: 'warning-graphic', rule: fiveSeconds }]);
    expect(
      firedVisualRuleEventRules(
        engine,
        'timer-alarm',
        {},
        {
          ...scope,
          timerAlarmOwnerLayerId: 'ending-graphic',
        },
      ),
    ).toEqual([{ hostLayerId: 'ending-graphic', rule: zero }]);
    expect(
      firedVisualRuleEventRules(
        engine,
        'timer-alarm',
        {},
        {
          ...scope,
          timerAlarmOwnerLayerId: 'missing',
        },
      ),
    ).toEqual([]);
    expect(firedVisualRuleEventRules(engine, 'timer-alarm', {}, scope)).toHaveLength(2);
  });

  it('prunes alarms after deleting their source or disabling the clock feature, retaining linked drafts', () => {
    const timer = createLayerOfKind('clock');
    timer.id = 'timer';
    const graphic = createLayerOfKind('rectangle');
    graphic.visualRules = [alarm(), alarm({ id: 'draft', actions: [] })];
    const composition = createComposition({ layers: [timer, graphic] });
    pruneVisualRuleReferences(composition);
    expect(graphic.visualRules).toHaveLength(2);
    if (timer.element.type !== 'text') throw new Error('Expected text.');
    delete timer.element.clock;
    pruneVisualRuleReferences(composition);
    expect(graphic.visualRules).toEqual([]);
    graphic.visualRules = [alarm()];
    composition.layers = [graphic];
    pruneVisualRuleReferences(composition);
    expect(graphic.visualRules).toEqual([]);
  });
});

describe('component alarm source safety', () => {
  function fixture() {
    const timer = createLayerOfKind('clock');
    timer.id = 'timer';
    const graphic = createLayerOfKind('rectangle');
    graphic.id = 'warning';
    graphic.visualRules = [alarm({ actions: [] })];
    const composition = createComposition({ layers: [timer, graphic] });
    return { timer, graphic, composition };
  }

  it('requires the timer source in the saved component selection', () => {
    const { graphic, composition } = fixture();
    expect(() => buildComponentDefinition(composition, [graphic.id], 'Warning')).toThrow(
      /timer alarm source/,
    );
  });

  it('creates independent rule and timer identities for each instance, retaining empty-action alarm drafts', () => {
    const { timer, graphic, composition } = fixture();
    const definition = buildComponentDefinition(
      composition,
      [timer.id, graphic.id],
      'Timed warning',
    );
    composition.components.push(definition);
    const first = instantiateComponentDefinition(composition, definition);
    const second = instantiateComponentDefinition(composition, definition);
    const firstRule = first.layers.find((layer) => layer.id === first.layerIds[graphic.id])!
      .visualRules[0]!;
    const secondRule = second.layers.find((layer) => layer.id === second.layerIds[graphic.id])!
      .visualRules[0]!;
    expect(firstRule.timerAlarm?.sourceLayerId).toBe(first.layerIds[timer.id]);
    expect(secondRule.timerAlarm?.sourceLayerId).toBe(second.layerIds[timer.id]);
    expect(firstRule.id).not.toBe(secondRule.id);
    expect(firstRule.actions).toEqual([]);
    expect(definition.layers[1]!.visualRules[0]!.timerAlarm?.sourceLayerId).toBe(timer.id);
  });

  it('retains a removed component timer as a private asset when an external alarm still refers to it', () => {
    const { timer, graphic, composition } = fixture();
    // Keep the external alarm outside the component; it must survive asset edits safely.
    graphic.visualRules = [];
    const definition = buildComponentDefinition(composition, [timer.id, graphic.id], 'Timer');
    composition.layers = [];
    composition.components.push(definition);
    const instance = instantiateComponentDefinition(composition, definition);
    composition.layers.push(...instance.layers);
    const actualTimerId = instance.layerIds[timer.id]!;
    const external = createLayerOfKind('rectangle');
    external.visualRules = [
      alarm({ timerAlarm: { sourceLayerId: actualTimerId, thresholdMs: 0, direction: 'down' } }),
    ];
    composition.layers.push(external);
    definition.layers = definition.layers.filter((layer) => layer.id !== timer.id);
    reconcileComponentInstances(composition);
    const retained = composition.layers.find((layer) => layer.id === actualTimerId)!;
    expect(retained).toBeDefined();
    expect(retained.componentLink?.componentId).not.toBe(definition.id);
    pruneVisualRuleReferences(composition);
    expect(external.visualRules[0]!.timerAlarm?.sourceLayerId).toBe(actualTimerId);
  });
});
