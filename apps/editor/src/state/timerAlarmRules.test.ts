import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayerOfKind,
  createProject,
  normalizeClockTimerSettings,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { usePaneRequestStore } from './paneRequestStore';
import {
  formatTimerAlarmThreshold,
  nextTimerAlarm,
  parseTimerAlarmThreshold,
  sortedTimerAlarmRules,
  timerAlarmRules,
} from './timerAlarmRules';

const timerFixture = (mode: 'count-up' | 'count-down' = 'count-down') => {
  const project = createProject();
  const timer = createLayerOfKind('text');
  if (timer.element.type !== 'text') throw new Error('Expected text');
  timer.element.clock = normalizeClockTimerSettings({
    mode,
    initialValueMs: mode === 'count-down' ? 10_000 : 0,
  });
  project.compositions[0]!.layers.push(timer);
  return { project, timer };
};

describe('timer alarm authoring', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('creates independent zero and five-second ordinary rules atomically, with no accidental actions or data field', () => {
    const { project, timer } = timerFixture();
    useProjectStore.getState().loadProject(project);
    const store = useProjectStore.getState();
    let changes = 0;
    const unsubscribe = useProjectStore.subscribe(() => {
      changes++;
    });
    const zero = store.addClockTimerAlarm(timer.id);
    const five = store.addClockTimerAlarm(timer.id);
    unsubscribe();
    expect(changes).toBe(2);
    const composition = useProjectStore.getState().project.compositions[0]!;
    expect(composition.dataFields).toEqual([]);
    const alarms = timerAlarmRules(composition.layers, timer.id);
    expect(alarms).toHaveLength(2);
    expect(
      alarms.map(({ rule, alarm }) => ({
        id: rule.id,
        name: rule.name,
        actions: rule.actions,
        ...alarm,
      })),
    ).toEqual([
      {
        id: zero,
        name: 'Rule #1',
        actions: [],
        sourceLayerId: timer.id,
        thresholdMs: 0,
        direction: 'down',
      },
      {
        id: five,
        name: 'Rule #2',
        actions: [],
        sourceLayerId: timer.id,
        thresholdMs: 5_000,
        direction: 'down',
      },
    ]);
    expect(zero).not.toBe(five);
    expect(composition.layers[0]!.element).not.toHaveProperty('clock.alarms');
  });

  it('keeps disabled alarm actions and its source after retargeting the rule owner, then removes the row on rule deletion', () => {
    const { project, timer } = timerFixture();
    const target = createLayerOfKind('rectangle');
    project.compositions[0]!.layers.push(target);
    useProjectStore.getState().loadProject(project);
    const store = useProjectStore.getState();
    const id = store.addClockTimerAlarm(timer.id)!;
    const actions = [{ type: 'visibility' as const, visible: true, targetLayerId: target.id }];
    store.updateLayerVisualRule(timer.id, id, { enabled: false, actions });
    expect(store.retargetLayerVisualRule(timer.id, id, target.id)).toBe(true);
    const current = () => useProjectStore.getState().project.compositions[0]!;
    const [alarm] = timerAlarmRules(current().layers, timer.id);
    expect(alarm).toMatchObject({
      owner: { id: target.id },
      rule: { id, enabled: false, actions },
      alarm: { sourceLayerId: timer.id },
    });
    store.updateLayerVisualRule(target.id, id, { enabled: true });
    expect(timerAlarmRules(current().layers, timer.id)[0]!.rule.actions).toEqual(actions);
    store.removeLayerVisualRule(target.id, id);
    expect(timerAlarmRules(current().layers, timer.id)).toEqual([]);
  });

  it('preserves draft alarms and stable IDs through ordinary project loading', () => {
    const { project, timer } = timerFixture();
    useProjectStore.getState().loadProject(project);
    const id = useProjectStore.getState().addClockTimerAlarm(timer.id)!;
    const saved = structuredClone(useProjectStore.getState().project);
    useProjectStore.getState().loadProject(saved);
    expect(
      timerAlarmRules(useProjectStore.getState().project.compositions[0]!.layers, timer.id)[0]!
        .rule,
    ).toMatchObject({ id, actions: [], trigger: 'timer-alarm' });
  });

  it.each(['remove-clock', 'guide'] as const)(
    'prunes linked alarms on other owners after %s',
    (change) => {
      const { project, timer } = timerFixture();
      const other = createLayerOfKind('rectangle');
      project.compositions[0]!.layers.push(other);
      useProjectStore.getState().loadProject(project);
      const store = useProjectStore.getState();
      const id = store.addClockTimerAlarm(timer.id)!;
      store.retargetLayerVisualRule(timer.id, id, other.id);
      if (change === 'remove-clock') store.updateLayerElement(timer.id, { clock: null });
      else store.toggleLayerGuide(timer.id);
      const composition = useProjectStore.getState().project.compositions[0]!;
      expect(timerAlarmRules(composition.layers, timer.id)).toEqual([]);
      expect(composition.layers.find((layer) => layer.id === other.id)!.visualRules).toEqual([]);
      if (change === 'remove-clock')
        expect(composition.layers[0]!.element).not.toHaveProperty('clock');
    },
  );

  it('does not create alarms for locked, guide, or non-timer layers', () => {
    const { project, timer } = timerFixture();
    const rectangle = createLayerOfKind('rectangle');
    timer.isLocked = true;
    project.compositions[0]!.layers.push(rectangle);
    useProjectStore.getState().loadProject(project);
    expect(useProjectStore.getState().addClockTimerAlarm(timer.id)).toBeNull();
    expect(useProjectStore.getState().addClockTimerAlarm(rectangle.id)).toBeNull();
    timer.isLocked = false;
    timer.isGuide = true;
    useProjectStore.getState().loadProject(project);
    expect(useProjectStore.getState().addClockTimerAlarm(timer.id)).toBeNull();
  });

  it('uses count-up limits and supports manual sources without duplicate thresholds', () => {
    const { project, timer } = timerFixture('count-up');
    if (timer.element.type !== 'text' || !timer.element.clock) throw new Error('Expected timer');
    timer.element.clock = { ...timer.element.clock, source: 'manual', limitMs: 30_000 };
    expect(
      nextTimerAlarm(project.compositions[0]!.layers, timer.id, timer.element.clock),
    ).toMatchObject({ thresholdMs: 30_000, direction: 'up' });
    useProjectStore.getState().loadProject(project);
    useProjectStore.getState().addClockTimerAlarm(timer.id);
    useProjectStore.getState().addClockTimerAlarm(timer.id);
    expect(
      timerAlarmRules(useProjectStore.getState().project.compositions[0]!.layers, timer.id).map(
        ({ alarm }) => alarm.thresholdMs,
      ),
    ).toEqual([30_000, 5_000]);
  });

  it('reveals the exact linked rule without relying on canvas selection', () => {
    const store = usePaneRequestStore.getState();
    store.revealRule('composition', 'other-owner', 'alarm-rule');
    expect(usePaneRequestStore.getState()).toMatchObject({
      request: { pane: 'rules' },
      ruleRequest: { compositionId: 'composition', layerId: 'other-owner', ruleId: 'alarm-rule' },
    });
    const previous = usePaneRequestStore.getState().ruleRequest!.id;
    store.revealRule('composition', 'other-owner', 'alarm-rule');
    expect(usePaneRequestStore.getState().ruleRequest!.id).toBe(previous + 1);
  });

  it('shows alarms in countdown/count-up travel order without mutating the Rules list', () => {
    const { project, timer } = timerFixture();
    useProjectStore.getState().loadProject(project);
    const store = useProjectStore.getState();
    const zero = store.addClockTimerAlarm(timer.id)!;
    const five = store.addClockTimerAlarm(timer.id)!;
    const layers = useProjectStore.getState().project.compositions[0]!.layers;
    expect(
      sortedTimerAlarmRules(layers, timer.id, 'count-down').map(({ rule }) => rule.id),
    ).toEqual([five, zero]);
    expect(sortedTimerAlarmRules(layers, timer.id, 'count-up').map(({ rule }) => rule.id)).toEqual([
      zero,
      five,
    ]);
    expect(layers[0]!.visualRules.map((rule) => rule.id)).toEqual([zero, five]);
  });
});

describe('alarm duration editor', () => {
  it.each([
    [0, '00:00'],
    [5_000, '00:05'],
    [65_125, '01:05.125'],
    [3_601_000, '01:00:01'],
  ] as const)('round trips %s milliseconds as %s', (value, formatted) => {
    expect(formatTimerAlarmThreshold(value)).toBe(formatted);
    expect(parseTimerAlarmThreshold(formatted)).toBe(value);
  });
  it('accepts seconds and rejects malformed or negative thresholds', () => {
    expect(parseTimerAlarmThreshold('5')).toBe(5_000);
    expect(parseTimerAlarmThreshold('1.5')).toBe(1_500);
    for (const value of ['', '-1', '-00:05', '00:60', 'garbage', '999999999999999999999'])
      expect(parseTimerAlarmThreshold(value)).toBeNull();
  });
});
