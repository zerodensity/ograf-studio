import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type SampleResult = { statusCode: number; statusMessage?: string };
type SampleGraphic = {
  goToTime(params: { timestamp: number }): Promise<SampleResult>;
  setActionsSchedule(params: unknown): Promise<SampleResult>;
};

async function flushSamples() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}

function sampleHarness(graphic: SampleGraphic, onRendered = vi.fn<() => void>()) {
  const callbacks: Array<(time: number) => void> = [];
  let now = 0;
  const errors = vi.fn();
  const source = readFileSync(new URL('./offlinePreviewScheduler.js', import.meta.url), 'utf8');
  const create = runInNewContext(`${source}\ncreateOfflinePreviewScheduler`, {
    performance: { now: () => now },
    requestAnimationFrame: (callback: (time: number) => void) => callbacks.push(callback),
  }) as (
    instance: SampleGraphic,
    fps: number,
    check: (result: SampleResult) => SampleResult,
    reportError: (error: unknown) => void,
    rendered?: () => void,
  ) => {
    call(type: string, params: object): Promise<unknown>;
    stop(): Promise<unknown>;
  };
  const scheduler = create(
    graphic,
    25,
    (result) => {
      if (result.statusCode >= 400) throw new Error(result.statusMessage || 'Render failed.');
      return result;
    },
    errors,
    onRendered,
  );
  return {
    scheduler,
    callbacks,
    errors,
    onRendered,
    async tick(time: number) {
      now = time;
      callbacks.shift()!(time);
      await flushSamples();
    },
  };
}

describe('offline non-realtime preview scheduling', () => {
  it('reports successful completed frame and action samples, not skipped RAF callbacks', async () => {
    const graphic = {
      goToTime: vi.fn(async (_params: { timestamp: number }) => ({ statusCode: 200 })),
      setActionsSchedule: vi.fn(async (_params: unknown) => ({ statusCode: 200 })),
    };
    const harness = sampleHarness(graphic);
    await harness.tick(0);
    expect(harness.onRendered).toHaveBeenCalledTimes(1);
    await harness.tick(20);
    expect(harness.onRendered).toHaveBeenCalledTimes(1);
    await harness.scheduler.call('playAction', { delta: 1 });
    expect(harness.onRendered).toHaveBeenCalledTimes(2);
    expect(graphic.setActionsSchedule).toHaveBeenCalledOnce();
    expect(harness.errors).not.toHaveBeenCalled();
    await harness.scheduler.stop();
    await harness.tick(100);
    expect(harness.onRendered).toHaveBeenCalledTimes(2);
  });

  it('does not report rejected or unsuccessful seeks and retains action rollback', async () => {
    const graphic = {
      goToTime: vi
        .fn(async (_params: { timestamp: number }): Promise<SampleResult> => ({ statusCode: 200 }))
        .mockRejectedValueOnce(new Error('Automatic render failed.')),
      setActionsSchedule: vi.fn(async (_params: unknown) => ({ statusCode: 200 })),
    };
    const harness = sampleHarness(graphic);
    await harness.tick(0);
    expect(harness.onRendered).not.toHaveBeenCalled();
    expect(harness.errors).toHaveBeenCalledOnce();
    await harness.tick(40);
    expect(harness.onRendered).toHaveBeenCalledOnce();
    graphic.goToTime.mockResolvedValueOnce({ statusCode: 550, statusMessage: 'Action failed.' });
    await expect(harness.scheduler.call('playAction', { delta: 1 })).rejects.toThrow(
      'Action failed.',
    );
    expect(harness.onRendered).toHaveBeenCalledOnce();
    expect(graphic.setActionsSchedule.mock.calls.map(([params]) => params)).toEqual([
      { schedule: [{ timestamp: 40, action: { type: 'playAction', params: { delta: 1 } } }] },
      { schedule: [] },
    ]);
    await harness.scheduler.stop();
  });

  it('does not notify when an in-flight seek finishes after the scheduler stops', async () => {
    let finish!: (result: SampleResult) => void;
    const pending = new Promise<SampleResult>((resolve) => {
      finish = resolve;
    });
    const graphic = {
      goToTime: vi.fn((_params: { timestamp: number }) => pending),
      setActionsSchedule: vi.fn(async (_params: unknown) => ({ statusCode: 200 })),
    };
    const harness = sampleHarness(graphic);
    await harness.tick(0);
    expect(graphic.goToTime).toHaveBeenCalledOnce();
    expect(harness.onRendered).not.toHaveBeenCalled();
    const stopped = harness.scheduler.stop();
    finish({ statusCode: 200 });
    await stopped;
    await harness.tick(40);
    expect(harness.onRendered).not.toHaveBeenCalled();
    expect(graphic.goToTime).toHaveBeenCalledOnce();
    expect(harness.errors).not.toHaveBeenCalled();
  });

  it('reports only the operator sample when a queued automatic sample yields to its action', async () => {
    const graphic = {
      goToTime: vi.fn(async (_params: { timestamp: number }) => ({ statusCode: 200 })),
      setActionsSchedule: vi.fn(async (_params: unknown) => ({ statusCode: 200 })),
    };
    const harness = sampleHarness(graphic);
    harness.callbacks.shift()!(0);
    await harness.scheduler.call('playAction', { delta: 1 });
    await flushSamples();
    expect(graphic.goToTime).toHaveBeenCalledOnce();
    expect(harness.onRendered).toHaveBeenCalledOnce();
    expect(graphic.setActionsSchedule).toHaveBeenCalledOnce();
    await harness.scheduler.stop();
  });

  it('ignores diagnostic callback failures without changing frame or action results', async () => {
    const graphic = {
      goToTime: vi.fn(async (_params: { timestamp: number }) => ({ statusCode: 200 })),
      setActionsSchedule: vi.fn(async (_params: unknown) => ({ statusCode: 200 })),
    };
    const rendered = vi.fn(() => {
      throw new Error('Diagnostic callback failed.');
    });
    const harness = sampleHarness(graphic, rendered);
    await harness.tick(0);
    await expect(harness.scheduler.call('playAction', { delta: 1 })).resolves.toEqual({
      statusCode: 200,
    });
    expect(rendered).toHaveBeenCalledTimes(2);
    expect(graphic.setActionsSchedule).toHaveBeenCalledOnce();
    expect(harness.errors).not.toHaveBeenCalled();
    await harness.scheduler.stop();
  });

  it('bounds slow frame sampling and keeps operator actions in order', async () => {
    const callbacks: Array<(time: number) => void> = [];
    let now = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const graphic = {
      goToTime: vi.fn(async () => {
        calls.push('seek');
        if (calls.length === 1) await pending;
        return { statusCode: 200 };
      }),
      setActionsSchedule: vi.fn(async (_params: unknown) => {
        calls.push('schedule');
        return { statusCode: 200 };
      }),
    };
    const source = readFileSync(new URL('./offlinePreviewScheduler.js', import.meta.url), 'utf8');
    const create = runInNewContext(`${source}\ncreateOfflinePreviewScheduler`, {
      performance: { now: () => now },
      requestAnimationFrame: (callback: (time: number) => void) => callbacks.push(callback),
    }) as (
      instance: typeof graphic,
      fps: number,
      check: (result: unknown) => unknown,
      onError: (error: unknown) => void,
    ) => { call: (type: string, params: object) => Promise<unknown>; stop: () => Promise<unknown> };
    const scheduler = create(
      graphic,
      25,
      (value) => value,
      (error) => {
        throw error;
      },
    );
    now = 100;
    callbacks.shift()!(now);
    await Promise.resolve();
    for (let i = 1; i <= 40; i++) {
      now = 100 + i * 40;
      callbacks.shift()!(now);
    }
    expect(graphic.goToTime).toHaveBeenCalledTimes(1);
    const action = scheduler.call('playAction', { delta: 1 });
    expect(graphic.setActionsSchedule).not.toHaveBeenCalled();
    release();
    await action;
    expect(calls).toEqual(['seek', 'schedule', 'seek']);
    expect(graphic.setActionsSchedule.mock.calls[0]![0]).toEqual({
      schedule: [{ timestamp: now, action: { type: 'playAction', params: { delta: 1 } } }],
    });
    await scheduler.stop();
    callbacks.shift()!(now + 40);
    await Promise.resolve();
    expect(graphic.goToTime).toHaveBeenCalledTimes(2);
  });

  it.each([
    { cost: 0, next: 40 },
    { cost: 200, next: 600 },
  ])(
    'adapts to a $cost ms seek and samples the current wall-clock time',
    async ({ cost, next }) => {
      const callbacks: Array<(time: number) => void> = [];
      let now = 0;
      const timestamps: number[] = [];
      const graphic = {
        goToTime: vi.fn(async ({ timestamp }: { timestamp: number }) => {
          timestamps.push(timestamp);
          now += cost;
          return { statusCode: 200 };
        }),
        setActionsSchedule: vi.fn(async (_params: unknown) => ({ statusCode: 200 })),
      };
      const source = readFileSync(new URL('./offlinePreviewScheduler.js', import.meta.url), 'utf8');
      const create = runInNewContext(`${source}\ncreateOfflinePreviewScheduler`, {
        performance: { now: () => now },
        requestAnimationFrame: (callback: (time: number) => void) => callbacks.push(callback),
      }) as (
        instance: typeof graphic,
        fps: number,
        check: (result: unknown) => unknown,
        report: (error: unknown) => void,
      ) => { stop: () => Promise<unknown> };
      const scheduler = create(
        graphic,
        25,
        (value) => value,
        (error) => {
          throw error;
        },
      );
      callbacks.shift()!(0);
      for (let i = 0; i < 8; i++) await Promise.resolve();
      now = next - 1;
      callbacks.shift()!(now);
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(timestamps).toEqual([0]);
      now = next;
      callbacks.shift()!(now);
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(timestamps).toEqual([0, next]);
      await scheduler.stop();
    },
  );

  it('does not queue sampling ahead of an operator action already pending', async () => {
    const callbacks: Array<(time: number) => void> = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const graphic = {
      goToTime: vi.fn(async (_params: unknown) => ({ statusCode: 200 })),
      setActionsSchedule: vi.fn(async (_params: unknown) => {
        await pending;
        return { statusCode: 200 };
      }),
    };
    const source = readFileSync(new URL('./offlinePreviewScheduler.js', import.meta.url), 'utf8');
    const create = runInNewContext(`${source}\ncreateOfflinePreviewScheduler`, {
      performance: { now: () => 0 },
      requestAnimationFrame: (callback: (time: number) => void) => callbacks.push(callback),
    }) as (
      instance: typeof graphic,
      fps: number,
      check: (result: unknown) => unknown,
      report: (error: unknown) => void,
    ) => { call: (type: string, params: object) => Promise<unknown>; stop: () => Promise<unknown> };
    const scheduler = create(
      graphic,
      25,
      (value) => value,
      (error) => {
        throw error;
      },
    );
    const action = scheduler.call('playAction', { delta: 1 });
    for (let i = 0; i < 20; i++) callbacks.shift()!(i * 40);
    expect(graphic.goToTime).not.toHaveBeenCalled();
    release();
    await action;
    expect(graphic.goToTime).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });
});
