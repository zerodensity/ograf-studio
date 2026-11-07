import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomActionParams, ReturnPayload } from '@ograf-editor/ograf-types';
import { playTransitionStageSchedule } from './transitionStagePlayback';
import type { stageSchedule } from './transitionsDesign';

type Schedule = ReturnType<typeof stageSchedule>;
const take = (timestamp: number, stateId: string, skipAnimation = false): Schedule[number] => ({
  timestamp,
  action: {
    type: 'customAction',
    params: {
      id: 'transition.take',
      payload: { slotId: stateId === 'ticker' ? 'ticker' : 'lower-third', stateId },
      ...(skipAnimation ? { skipAnimation: true } : {}),
    },
  },
});
const out = (timestamp: number): Schedule[number] => ({
  timestamp,
  action: {
    type: 'customAction',
    params: { id: 'transition.out', payload: { slotId: 'ticker' } },
  },
});
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ok = { statusCode: 200 };

afterEach(() => vi.useRealTimers());

describe('transition stage real-time schedule', () => {
  it('prepares the lower third before the clock, then keeps ticker in/out at separate authored times', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const dispatched: Array<{ id: string; at: number }> = [];
    const started = vi.fn();
    const graphic = {
      async customAction(params: CustomActionParams): Promise<ReturnPayload> {
        dispatched.push({ id: params.id, at: performance.now() });
        if (params.skipAnimation) await sleep(120);
        // Deliberately keep ticker-in pending beyond ticker-out's authored timestamp. A
        // scheduler must dispatch the out on time rather than await the earlier animation.
        if (params.id === 'transition.take' && !params.skipAnimation) await sleep(1600);
        return ok;
      },
    };
    const run = playTransitionStageSchedule({
      graphic,
      schedule: [out(1040), take(0, 'name', true), take(40, 'ticker')],
      durationMs: 2200,
      signal: new AbortController().signal,
      onStart: started,
    });
    await vi.advanceTimersByTimeAsync(159);
    expect(started).toHaveBeenCalledWith(120);
    expect(dispatched.map((entry) => entry.id)).toEqual(['transition.clear', 'transition.take']);
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatched.at(-1)).toEqual({ id: 'transition.take', at: 160 });
    await vi.advanceTimersByTimeAsync(999);
    expect(dispatched).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatched.at(-1)).toEqual({ id: 'transition.out', at: 1160 });
    await vi.runAllTimersAsync();
    await run;
  });

  it('keeps the preview running until a slow grow-back action has completed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let restored = false;
    const run = playTransitionStageSchedule({
      graphic: {
        async customAction(params) {
          if (params.id === 'transition.out') {
            await sleep(1500);
            restored = true;
          }
          return ok;
        },
      },
      schedule: [take(0, 'name', true), take(0, 'ticker', true), out(40)],
      durationMs: 1000,
      signal: new AbortController().signal,
      onStart: () => undefined,
    });
    const completed = vi.fn();
    void run.then(completed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(restored).toBe(false);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(540);
    await run;
    expect(restored).toBe(true);
    expect(completed).toHaveBeenCalledOnce();
  });

  it('reports rejected transition actions instead of silently displaying a successful preview', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const run = playTransitionStageSchedule({
      graphic: {
        async customAction(params) {
          return params.id === 'transition.out'
            ? { statusCode: 400, statusMessage: 'Invalid restoration target.' }
            : ok;
        },
      },
      schedule: [take(0, 'ticker', true), out(40)],
      durationMs: 2000,
      signal: new AbortController().signal,
      onStart: () => undefined,
    });
    const result = expect(run).rejects.toThrow('Invalid restoration target.');
    await vi.advanceTimersByTimeAsync(40);
    await result;
  });

  it('does not dispatch a later ticker action after pausing or switching the preview', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const abort = new AbortController();
    const action = vi.fn(async (_params: CustomActionParams) => ok);
    const run = playTransitionStageSchedule({
      graphic: { customAction: action },
      schedule: [take(0, 'name', true), take(40, 'ticker'), out(1040)],
      durationMs: 2000,
      signal: abort.signal,
      onStart: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(200);
    abort.abort();
    await run;
    await vi.runAllTimersAsync();
    expect(action.mock.calls.map(([params]) => params.id)).toEqual([
      'transition.clear',
      'transition.take',
      'transition.take',
    ]);
  });
});
