import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTextElement,
  normalizeClockTimerSettings,
  type ClockTimerSettings,
  type TextElement,
} from '@ograf-editor/scene-model';
import {
  clockTimerSettingsAtTime,
  clockTimerStateAtTime,
  clockTimerTextAnimationAtTime,
  createClockTimerRuntime,
  type ClockTimerEvent,
} from './clockTimerRuntime';

function clock(settings: Partial<ClockTimerSettings> = {}): TextElement {
  const element = createTextElement();
  element.clock = normalizeClockTimerSettings({
    mode: 'count-up',
    format: 'mm:ss',
    ...settings,
  });
  element.textAnimation = {
    ...element.textAnimation,
    type: 'roll-up',
    durationFrames: 10,
    replayOnUpdate: true,
  };
  return element;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('timed clock settings history', () => {
  const settings = normalizeClockTimerSettings({
    mode: 'count-down',
    initialValueMs: 30000,
    format: 'ss',
    autoStart: true,
  });

  it('resets a duration at its own timestamp while preserving Pause and backward replay', () => {
    const events: ClockTimerEvent[] = [
      { timestamp: 0, command: 'take-in' },
      { timestamp: 5000, command: 'pause' },
      { timestamp: 10000, command: 'set-settings', settings: { initialValueMs: 60000 } },
      { timestamp: 15000, command: 'start' },
    ];
    expect(clockTimerStateAtTime(settings, 17000, events, true)).toMatchObject({
      valueMs: 58000,
      running: true,
    });
    expect(clockTimerStateAtTime(settings, 12000, events, true)).toMatchObject({
      valueMs: 60000,
      running: false,
    });
    expect(clockTimerStateAtTime(settings, 7000, events, true)).toMatchObject({
      valueMs: 25000,
      running: false,
    });
    expect(clockTimerStateAtTime(settings, 17000, events, true)).toMatchObject({
      valueMs: 58000,
      running: true,
    });
    expect(events[2]).toEqual({
      timestamp: 10000,
      command: 'set-settings',
      settings: { initialValueMs: 60000 },
    });
  });

  it('changes end behavior from its event without reviving an expired timer', () => {
    const events: ClockTimerEvent[] = [
      { timestamp: 0, command: 'take-in' },
      { timestamp: 40000, command: 'set-settings', settings: { endBehavior: 'continue' } },
    ];
    expect(clockTimerStateAtTime(settings, 45000, events, true)).toMatchObject({
      valueMs: 0,
      running: false,
    });
    expect(clockTimerStateAtTime(settings, 10000, events, true)).toMatchObject({
      valueMs: 20000,
      running: true,
    });
    expect(clockTimerSettingsAtTime(settings, 10000, events).endBehavior).toBe('stop');
  });

  it('replays display settings and rolling predecessors at their authored event times', () => {
    const element = clock({ mode: 'count-down', initialValueMs: 30000, format: 'ss' });
    const events: ClockTimerEvent[] = [
      { timestamp: 0, command: 'take-in' },
      { timestamp: 10000, command: 'set-settings', settings: { format: 'mm:ss' } },
    ];
    expect(clockTimerSettingsAtTime(element.clock!, 9000, events).format).toBe('ss');
    expect(clockTimerSettingsAtTime(element.clock!, 11000, events).format).toBe('mm:ss');
    const changed = clockTimerTextAnimationAtTime(element, 10100, 25, events, true);
    expect(changed.previous?.content).toBe('21');
    expect(changed.frame).toBeCloseTo(2.5, 1);
    expect(clockTimerTextAnimationAtTime(element, 9100, 25, events, true).previous?.content).toBe(
      '22',
    );
    expect(clockTimerTextAnimationAtTime(element, 10100, 25, events, true)).toEqual(changed);
  });
});

describe('rolling clock text transitions', () => {
  it('derives the preceding second from time rather than the previous sample', () => {
    const element = clock({ initialValueMs: 59000 });
    const after = clockTimerTextAnimationAtTime(element, 1250, 25);
    expect(after.previous?.content).toBe('00:59');
    expect(after.frame).toBeCloseTo(6.25, 1);
    expect(clockTimerTextAnimationAtTime(element, 2250, 25).previous?.content).toBe('01:00');
    expect(clockTimerTextAnimationAtTime(element, 1250, 25)).toEqual(after);
    expect(clockTimerTextAnimationAtTime(element, 0, 25)).toEqual({ frame: 10, previous: null });
  });

  it('rolls a countdown from its preceding displayed value through zero', () => {
    const element = clock({ mode: 'count-down', initialValueMs: 1000 });
    element.textAnimation = { ...element.textAnimation, type: 'roll-down' };
    expect(clockTimerTextAnimationAtTime(element, 1100, 25).previous?.content).toBe('00:01');
    expect(clockTimerTextAnimationAtTime(element, 1100, 25).frame).toBeCloseTo(2.5, 1);
    expect(clockTimerTextAnimationAtTime(element, 1600, 25)).toEqual({ frame: 10, previous: null });
  });

  it('keeps the prior manual value across identical events and backward seeks', () => {
    const element = clock({ source: 'manual', manualValue: 59000 });
    const events: ClockTimerEvent[] = [
      { timestamp: 1000, command: 'set-value', value: 60000 },
      { timestamp: 1100, command: 'set-value', value: 60000 },
      { timestamp: 2000, command: 'set-value', value: 120000 },
    ];
    const first = clockTimerTextAnimationAtTime(element, 1250, 25, events);
    expect(first).toMatchObject({ frame: 6.25, previous: { content: '00:59' } });
    expect(clockTimerTextAnimationAtTime(element, 2250, 25, events)).toMatchObject({
      frame: 6.25,
      previous: { content: '01:00' },
    });
    expect(clockTimerTextAnimationAtTime(element, 1250, 25, events)).toEqual(first);
    expect(clockTimerTextAnimationAtTime(element, 500, 25, events)).toEqual({
      frame: 10,
      previous: null,
    });
  });

  it('passes realtime displayed values into rolling manual updates without restarting repeats', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const element = clock({ source: 'manual', manualValue: 59000 });
    const frames: Array<{ content: string; frame: number; previous: string | null }> = [];
    const runtime = createClockTimerRuntime({
      element,
      frameRate: 25,
      render: () => {},
      animate: (resolved, frame, previous) =>
        frames.push({ content: resolved.content, frame, previous: previous?.content ?? null }),
    });
    runtime.startRealtime();
    expect(frames.at(-1)).toEqual({ content: '00:59', frame: 10, previous: null });
    now = 1000;
    const updated = clock({ source: 'manual', manualValue: 60000 });
    runtime.configure(updated);
    expect(frames.at(-1)).toEqual({ content: '01:00', frame: 0, previous: '00:59' });
    now = 1200;
    runtime.configure(updated);
    expect(frames.at(-1)).toEqual({ content: '01:00', frame: 5, previous: '00:59' });
    runtime.dispose();
  });

  it('replaces the predecessor even when deterministic samples share a target and frame', () => {
    const frames: Array<{ content: string; previous: string | null }> = [];
    const runtime = createClockTimerRuntime({
      element: clock({ source: 'manual', manualValue: 10000 }),
      frameRate: 25,
      render: () => {},
      animate: (resolved, _frame, previous) =>
        frames.push({ content: resolved.content, previous: previous?.content ?? null }),
    });
    runtime.renderAtTime(1250, [{ timestamp: 1000, command: 'set-value', value: 30000 }]);
    expect(frames.at(-1)).toEqual({ content: '00:30', previous: '00:10' });
    runtime.renderAtTime(1250, [
      { timestamp: 500, command: 'set-value', value: 20000 },
      { timestamp: 1000, command: 'set-value', value: 30000 },
    ]);
    expect(frames.at(-1)).toEqual({ content: '00:30', previous: '00:20' });
    runtime.renderAtTime(500);
    expect(frames.at(-1)).toEqual({ content: '00:10', previous: null });
    runtime.dispose();
  });
});

describe('settings driven by data on air', () => {
  function onAirTimer(settings: Partial<ClockTimerSettings>) {
    let shown = '';
    const runtime = createClockTimerRuntime({
      element: clock(settings),
      frameRate: 25,
      lifecycleDriven: true,
      render: (resolved) => {
        shown = resolved.content;
      },
    });
    runtime.startRealtime();
    runtime.setOnAir(true);
    return { runtime, shown: () => shown };
  }

  it('applies a new duration without undoing the operator pause', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { runtime, shown } = onAirTimer({ mode: 'count-down', initialValueMs: 30000 });
    now = 1000;
    runtime.command('pause');
    expect(shown()).toBe('00:29');
    now = 2000;
    runtime.configure(clock({ mode: 'count-down', initialValueMs: 300000 }));
    expect(shown()).toBe('05:00');
    now = 5000;
    runtime.configure(clock({ mode: 'count-down', initialValueMs: 300000 }));
    expect(shown()).toBe('05:00');
    runtime.dispose();
  });

  it('keeps a running timer running through a new duration', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { runtime, shown } = onAirTimer({ mode: 'count-down', initialValueMs: 30000 });
    now = 1000;
    runtime.configure(clock({ mode: 'count-down', initialValueMs: 60000 }));
    expect(shown()).toBe('01:00');
    now = 3000;
    runtime.configure(clock({ mode: 'count-down', initialValueMs: 60000 }));
    expect(shown()).toBe('00:58');
    runtime.dispose();
  });

  it('turns on overtime without rewinding the timer', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { runtime, shown } = onAirTimer({ mode: 'count-down', initialValueMs: 30000 });
    now = 10000;
    runtime.configure(
      clock({ mode: 'count-down', initialValueMs: 30000, endBehavior: 'continue' }),
    );
    expect(shown()).toBe('00:20');
    runtime.dispose();
  });

  it('changes a time zone and hour cycle on the running clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 0, 15, 15, 4, 5));
    const base = { mode: 'clock', format: 'hh:mm:ss' } as const;
    const { runtime, shown } = onAirTimer({ ...base, timeZone: 'UTC' });
    expect(shown()).toBe('15:04:05');
    runtime.configure(clock({ ...base, timeZone: 'Asia/Tokyo' }));
    expect(shown()).toBe('00:04:05');
    runtime.configure(clock({ ...base, timeZone: 'UTC', hourCycle: '12' }));
    expect(shown()).toBe('03:04:05');
    runtime.dispose();
  });
});
