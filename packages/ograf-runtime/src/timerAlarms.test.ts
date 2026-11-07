import { describe, expect, it, vi } from 'vitest';
import { createTextElement, normalizeClockTimerSettings } from '@ograf-editor/scene-model';
import { createClockTimerRuntime, type ClockTimerEvent } from './clockTimerRuntime';
import { clockTimerAlarmEventsAtTime, createClockTimerAlarmTracker } from './timerAlarms';

const alarms = [
  { id: 'warning', thresholdMs: 5000, direction: 'down' as const },
  { id: 'zero', thresholdMs: 0, direction: 'down' as const },
];
const countdown = normalizeClockTimerSettings({
  mode: 'count-down',
  initialValueMs: 10000,
  endBehavior: 'stop',
  autoStart: true,
});

describe('timer alarm raw-value latches', () => {
  it('retains fired latches through end-behavior changes and does not revive an expired timer', () => {
    const events: ClockTimerEvent[] = [
      { timestamp: 6000, command: 'set-settings', settings: { endBehavior: 'continue' } },
    ];
    expect(clockTimerAlarmEventsAtTime(countdown, alarms, 15000, events)).toEqual([
      { id: 'warning', timestamp: 5000, valueMs: 5000, run: 0 },
      { id: 'zero', timestamp: 10000, valueMs: 0, run: 0 },
    ]);
    const expired = createClockTimerAlarmTracker(countdown, alarms);
    expect(expired.advanceTo(15000)).toHaveLength(2);
    expect(
      expired.command({
        timestamp: 15000,
        command: 'set-settings',
        settings: { endBehavior: 'continue' },
      }),
    ).toEqual([]);
    expect(expired.nextAlarmTimestamp()).toBeUndefined();
    expect(expired.advanceTo(20000)).toEqual([]);
  });

  it('rearms duration changes at their timestamp while preserving Pause and repeatable replay', () => {
    const events: ClockTimerEvent[] = [
      { timestamp: 6000, command: 'pause' },
      { timestamp: 7000, command: 'set-settings', settings: { initialValueMs: 20000 } },
      { timestamp: 9000, command: 'start' },
    ];
    const expected = [
      { id: 'warning', timestamp: 5000, valueMs: 5000, run: 0 },
      { id: 'warning', timestamp: 24000, valueMs: 5000, run: 1 },
      { id: 'zero', timestamp: 29000, valueMs: 0, run: 1 },
    ];
    expect(clockTimerAlarmEventsAtTime(countdown, alarms, 30000, events)).toEqual(expected);
    expect(clockTimerAlarmEventsAtTime(countdown, alarms, 8000, events)).toEqual(
      expected.slice(0, 1),
    );
    expect(clockTimerAlarmEventsAtTime(countdown, alarms, 30000, events)).toEqual(expected);
  });

  it('fires five-second and zero alarms at exact crossings, including the stop boundary', () => {
    expect(clockTimerAlarmEventsAtTime(countdown, alarms, 20000)).toEqual([
      { id: 'warning', timestamp: 5000, valueMs: 5000, run: 0 },
      { id: 'zero', timestamp: 10000, valueMs: 0, run: 0 },
    ]);
    expect(clockTimerAlarmEventsAtTime(countdown, alarms, 4999)).toEqual([]);
  });

  it('rearms on Reset/Restart while Pause/Resume preserve the same run', () => {
    const events = [
      { timestamp: 6000, command: 'pause' as const },
      { timestamp: 9000, command: 'start' as const },
      { timestamp: 14000, command: 'reset' as const },
      { timestamp: 15000, command: 'start' as const },
      { timestamp: 26000, command: 'restart' as const },
    ];
    expect(
      clockTimerAlarmEventsAtTime(countdown, alarms, 37000, events).map((event) => [
        event.id,
        event.timestamp,
        event.run,
      ]),
    ).toEqual([
      ['warning', 5000, 0],
      ['zero', 13000, 0],
      ['warning', 20000, 1],
      ['zero', 25000, 1],
      ['warning', 31000, 2],
      ['zero', 36000, 2],
    ]);
  });

  it('never depends on arriving at a displayed value and coalesces an expired live jump', () => {
    const tracker = createClockTimerAlarmTracker(countdown, alarms);
    expect(tracker.advanceTo(4000, true)).toEqual([]);
    expect(tracker.advanceTo(12000, true)).toEqual([
      { id: 'zero', timestamp: 10000, valueMs: 0, run: 0 },
    ]);
    expect(tracker.advanceTo(15000, true)).toEqual([]);
    tracker.command({ command: 'restart', timestamp: 16000 });
    expect(tracker.advanceTo(21500, true)).toEqual([
      { id: 'warning', timestamp: 21000, valueMs: 5000, run: 1 },
    ]);
  });

  it('handles external jumps, ignores repeated values, and manual Reset does not rewrite the feed', () => {
    const settings = normalizeClockTimerSettings({
      ...countdown,
      source: 'manual',
      manualValue: 10000,
    });
    const tracker = createClockTimerAlarmTracker(settings, alarms);
    expect(tracker.command({ command: 'set-value', timestamp: 1, value: 4000 })).toMatchObject([
      { id: 'warning', timestamp: 1, run: 0 },
    ]);
    expect(tracker.command({ command: 'set-value', timestamp: 2, value: 4000 })).toEqual([]);
    expect(tracker.command({ command: 'set-value', timestamp: 3, value: 0 })).toMatchObject([
      { id: 'zero', timestamp: 3, run: 0 },
    ]);
    tracker.command({ command: 'reset', timestamp: 4 });
    expect(tracker.command({ command: 'set-value', timestamp: 5, value: 0 })).toEqual([]);
    tracker.command({ command: 'set-value', timestamp: 6, value: 10000 });
    expect(tracker.command({ command: 'set-value', timestamp: 7, value: 3000 })).toMatchObject([
      { id: 'warning', timestamp: 7, run: 1 },
    ]);
  });

  it('coalesces external end-of-round jumps and ignores invalid manual input', () => {
    const tracker = createClockTimerAlarmTracker(
      normalizeClockTimerSettings({
        ...countdown,
        source: 'manual',
        manualValue: 10000,
      }),
      alarms,
    );
    expect(
      tracker
        .command({ timestamp: 1, command: 'set-value', value: 0 }, true)
        .map((event) => event.id),
    ).toEqual(['zero']);
    expect(tracker.command({ timestamp: 2, command: 'set-value', value: 'invalid' }, true)).toEqual(
      [],
    );
    expect(tracker.command({ timestamp: 3, command: 'set-value', value: -10 }, true)).toEqual([]);
  });

  it('orders simultaneous manual crossings by travel, regardless of rule list order', () => {
    const settings = normalizeClockTimerSettings({
      ...countdown,
      source: 'manual',
      manualValue: 6000,
    });
    expect(
      clockTimerAlarmEventsAtTime(settings, [...alarms].reverse(), 1000, [
        { timestamp: 1000, command: 'set-value', value: 0 },
      ]).map((event) => event.id),
    ).toEqual(['warning', 'zero']);
  });

  it('keeps identically named rule IDs on different owners independent', () => {
    const entries = clockTimerAlarmEventsAtTime(
      countdown,
      [
        { id: 'r1', ownerLayerId: 'warning-owner', thresholdMs: 5000, direction: 'down' },
        { id: 'r1', ownerLayerId: 'ending-owner', thresholdMs: 0, direction: 'down' },
      ],
      10000,
    );
    expect(entries.map((event) => [event.id, event.ownerLayerId, event.timestamp])).toEqual([
      ['r1', 'warning-owner', 5000],
      ['r1', 'ending-owner', 10000],
    ]);
  });

  it('releases removed subscription latches while preserving active identities', () => {
    const tracker = createClockTimerAlarmTracker(
      {
        ...countdown,
        source: 'manual',
        manualValue: 10000,
      },
      alarms,
    );
    expect(
      tracker.command({ timestamp: 1, command: 'set-value', value: 4000 }).map((event) => event.id),
    ).toEqual(['warning']);
    tracker.setAlarms(alarms);
    tracker.command({ timestamp: 2, command: 'set-value', value: 10000 });
    expect(tracker.command({ timestamp: 3, command: 'set-value', value: 4000 })).toEqual([]);
    tracker.setAlarms([], true);
    tracker.command({ timestamp: 4, command: 'set-value', value: 10000 });
    tracker.setAlarms(alarms);
    expect(
      tracker.command({ timestamp: 5, command: 'set-value', value: 4000 }).map((event) => event.id),
    ).toEqual(['warning']);
  });

  it('preserves an authored alarm latch across disable/re-enable until Reset', () => {
    const tracker = createClockTimerAlarmTracker(
      {
        ...countdown,
        source: 'manual',
        manualValue: 10000,
      },
      alarms,
    );
    expect(
      tracker.command({ timestamp: 1, command: 'set-value', value: 4000 }).map((event) => event.id),
    ).toEqual(['warning']);
    tracker.setAlarms([]);
    tracker.command({ timestamp: 2, command: 'set-value', value: 10000 });
    tracker.setAlarms(alarms);
    expect(tracker.command({ timestamp: 3, command: 'set-value', value: 4000 })).toEqual([]);
    tracker.command({ timestamp: 4, command: 'reset' });
    tracker.command({ timestamp: 5, command: 'set-value', value: 10000 });
    expect(
      tracker.command({ timestamp: 6, command: 'set-value', value: 4000 }).map((event) => event.id),
    ).toEqual(['warning']);
  });

  it('fires an automatic start exactly on its threshold, but not a manual initial value or Reset', () => {
    const tracker = createClockTimerAlarmTracker(
      { ...countdown, initialValueMs: 5000 },
      alarms,
      true,
    );
    expect(tracker.advanceTo(0)).toEqual([]);
    expect(tracker.command({ timestamp: 1000, command: 'take-in' })).toEqual([
      { id: 'warning', timestamp: 1000, valueMs: 5000, run: 0 },
    ]);
    tracker.command({ timestamp: 2000, command: 'reset' });
    expect(tracker.advanceTo(3000)).toEqual([]);
    expect(tracker.command({ timestamp: 4000, command: 'restart' })).toEqual([
      { id: 'warning', timestamp: 4000, valueMs: 5000, run: 2 },
    ]);
    expect(
      clockTimerAlarmEventsAtTime(
        { ...countdown, source: 'manual', manualValue: 5000 },
        alarms,
        10000,
      ),
    ).toEqual([]);
  });

  it('keeps all time-of-day clock feeds silent and bounds pathological offline loop replay', () => {
    const tracker = createClockTimerAlarmTracker(
      { ...countdown, mode: 'clock', source: 'manual' },
      alarms,
    );
    expect(tracker.command({ timestamp: 1, command: 'set-value', value: 0 })).toEqual([]);
    const loop = { ...countdown, initialValueMs: 1, endBehavior: 'loop' as const };
    const trackerLoop = createClockTimerAlarmTracker(loop, [alarms[1]!]);
    expect(trackerLoop.advanceTo(1_000_000_000, true)).toEqual([
      { id: 'zero', timestamp: 1_000_000_000, valueMs: 0, run: 999_999_999 },
    ]);
    expect(() => clockTimerAlarmEventsAtTime(loop, [alarms[1]!], 20000)).toThrow(
      'Timer alarm replay exceeded 10000 events.',
    );
  });

  it('skips empty loop histories in constant time and retains phase for alarms added later', () => {
    const loop = { ...countdown, initialValueMs: 1, endBehavior: 'loop' as const };
    expect(clockTimerAlarmEventsAtTime(loop, [], 1_000_000_000_000)).toEqual([]);
    const tracker = createClockTimerAlarmTracker(loop, []);
    expect(tracker.advanceTo(1_000_000_000_000)).toEqual([]);
    tracker.setAlarms([{ id: 'half', thresholdMs: 0.5, direction: 'down' }]);
    expect(tracker.advanceTo(1_000_000_000_000.5)).toEqual([
      { id: 'half', timestamp: 1_000_000_000_000.5, valueMs: 0.5, run: 1_000_000_000_000 },
    ]);
    expect(() =>
      clockTimerAlarmEventsAtTime(
        loop,
        [{ id: 'wrong-way', thresholdMs: 0.5, direction: 'up' }],
        1_000_000_000_000,
      ),
    ).toThrow('Timer alarm replay exceeded 10000 events.');
  });

  it('fires independently in each loop and count-up run', () => {
    expect(
      clockTimerAlarmEventsAtTime({ ...countdown, endBehavior: 'loop' }, alarms, 25000).map(
        (event) => [event.id, event.timestamp, event.run],
      ),
    ).toEqual([
      ['warning', 5000, 0],
      ['zero', 10000, 0],
      ['warning', 15000, 1],
      ['zero', 20000, 1],
      ['warning', 25000, 2],
    ]);
    const up = normalizeClockTimerSettings({
      mode: 'count-up',
      initialValueMs: 0,
      limitMs: 10000,
      endBehavior: 'stop',
      autoStart: true,
    });
    expect(
      clockTimerAlarmEventsAtTime(
        up,
        [
          { id: 'five', thresholdMs: 5000, direction: 'up' },
          { id: 'limit', thresholdMs: 10000, direction: 'up' },
        ],
        12000,
      ).map((event) => [event.id, event.timestamp]),
    ).toEqual([
      ['five', 5000],
      ['limit', 10000],
    ]);
  });

  it('is deterministic across repeated and backward timeline samples', () => {
    const events = [{ timestamp: 2000, command: 'take-in' as const }];
    const result = clockTimerAlarmEventsAtTime(countdown, alarms, 13000, events, true);
    expect(result.map((event) => event.timestamp)).toEqual([7000, 12000]);
    expect(clockTimerAlarmEventsAtTime(countdown, alarms, 6000, events, true)).toEqual([]);
    expect(clockTimerAlarmEventsAtTime(countdown, alarms, 13000, events, true)).toEqual(result);
    expect(clockTimerAlarmEventsAtTime({ ...countdown, mode: 'clock' }, alarms, 13000)).toEqual([]);
  });

  it('samples alarms before formatted display changes, keeps instances independent, and silences seeks', () => {
    let now = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const first = vi.fn();
    const second = vi.fn();
    const element = createTextElement({
      clock: normalizeClockTimerSettings({
        ...countdown,
        format: 'mm',
        initialValueMs: 10000,
      }),
    });
    const options = { element, frameRate: 25, alarms, render() {} };
    const a = createClockTimerRuntime({ ...options, onAlarm: first });
    const b = createClockTimerRuntime({ ...options, onAlarm: second });
    a.startRealtime();
    b.startRealtime();
    now = 5500;
    a.configure(element);
    expect(first.mock.calls.map(([event]) => event.id)).toEqual(['warning']);
    expect(second).not.toHaveBeenCalled();
    a.renderAtTime(12000);
    expect(first).toHaveBeenCalledTimes(1);
    a.dispose();
    b.dispose();
    spy.mockRestore();
  });
});
