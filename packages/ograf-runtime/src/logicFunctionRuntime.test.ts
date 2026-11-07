import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { CompiledLogicFunctionDefinition } from '@ograf-editor/ograf-types';
import type {
  LogicFunctionContext,
  LogicFunctionResult,
  LogicJsonValue,
} from '@ograf-editor/scene-model';
import {
  createLogicFunctionRuntime,
  type LogicFunctionRuntimeOptions,
  type LogicFunctionSandboxHandle,
} from './logicFunctionRuntime';

class FakeDocument extends EventTarget {
  hidden = false;
  defaultView = new EventTarget();
  activeElement: Host | null = null;
  focused = true;
  hasFocus() {
    return this.focused;
  }
}
class Host extends EventTarget {
  nodeType = 1;
  tagName = 'DIV';
  isContentEditable = false;
  ownerDocument = new FakeDocument();
  keyboardScope: Host | null = null;
  children: Host[] = [];
  shadowRoot: { activeElement: Host | null } | null = null;
  closest() {
    return this.keyboardScope;
  }
  contains(node: Host): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  getAttribute() {
    return null;
  }
}
const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function definition(
  patch: Partial<CompiledLogicFunctionDefinition> = {},
): CompiledLogicFunctionDefinition {
  return {
    type: 'javascript',
    version: 1,
    id: 'main',
    name: 'Main',
    enabled: true,
    source: '(ctx) => ({})',
    inputs: { settings: 'config' },
    outputs: { result: 'output' },
    actions: ['go'],
    emits: { notify: 'ui.notice' },
    media: { music: 'music-cue', effect: 'effect-cue' },
    initialState: { count: 0 },
    ...patch,
  };
}
type Handler = (
  ctx: LogicFunctionContext,
  index: number,
) => LogicFunctionResult | Promise<LogicFunctionResult>;
const runtimes: ReturnType<typeof createLogicFunctionRuntime>[] = [];
function fixture(definitions = [definition()]) {
  let data: Record<string, unknown> = {
    config: { value: 1 },
    secret: 'not an input',
    output: 'initial',
  };
  const host = new Host(),
    scope = new Host();
  host.keyboardScope = scope;
  scope.children.push(host);
  let handler: Handler = () => ({});
  const sandboxes: Array<
    LogicFunctionSandboxHandle & {
      invoke: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }
  > = [];
  const creation: Array<{ owner: Document; name: string }> = [];
  const media = {
    play: vi.fn(async () => true),
    restart: vi.fn(async () => true),
    pause: vi.fn(() => true),
    resume: vi.fn(() => true),
    stop: vi.fn(() => true),
    setAudio: vi.fn(() => true),
  };
  const invokeAction = vi.fn<
    (id: string, payload?: LogicJsonValue, depth?: number) => Promise<unknown>
  >(async () => undefined);
  const errors = vi.fn();
  let reflectOutputs = false;
  let registry!: ReturnType<typeof createLogicFunctionRuntime>;
  const commit = vi.fn<LogicFunctionRuntimeOptions['commitData']>((patch) => {
    const previous = data;
    data = { ...data, ...patch };
    if (reflectOutputs) registry.dataChanged(previous, data);
  });
  const create = () => {
    registry = createLogicFunctionRuntime({
      host: host as unknown as HTMLElement,
      definitions,
      readData: () => data,
      commitData: commit,
      invokeAction,
      media: () => media,
      onError: errors,
      clock: {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      },
      sandboxFactory: (owner, options) => {
        const index = sandboxes.length;
        let busy = false;
        const sandbox = {
          ready: Promise.resolve(),
          invoke: vi.fn(async (ctx: LogicFunctionContext) => {
            if (busy) throw new Error('Sandbox is already executing.');
            busy = true;
            try {
              return await handler(ctx, index);
            } finally {
              busy = false;
            }
          }),
          dispose: vi.fn(),
        };
        sandboxes.push(sandbox);
        creation.push({ owner, name: options.name });
        return sandbox;
      },
    });
    runtimes.push(registry);
    return registry;
  };
  return {
    host,
    scope,
    sandboxes,
    creation,
    media,
    invokeAction,
    errors,
    commit,
    create,
    setHandler: (next: Handler) => {
      handler = next;
    },
    data: () => data,
    setData: (patch: Record<string, unknown>) => {
      const previous = data;
      data = { ...data, ...patch };
      registry.dataChanged(previous, data);
    },
    reflectOutputs: () => {
      reflectOutputs = true;
    },
  };
}
function fire(target: EventTarget, type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(properties))
    Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}
function paintDriver(f: ReturnType<typeof fixture>) {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  Object.assign(f.host.ownerDocument.defaultView, {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame: (key: number) => {
      frames.delete(key);
    },
  });
  return async (delay = 16) => {
    await vi.advanceTimersByTimeAsync(delay);
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(Date.now());
    await flush();
  };
}

describe('interactive function paint lifecycle', () => {
  it('paces mouse ticks on paint, suspends only pointer entries, and recovers state/latest data after healthy frames', async () => {
    const f = fixture([
      definition({ pointer: true }),
      definition({ id: 'legacy', name: 'Legacy', outputs: {}, media: { music: 'legacy-cue' } }),
    ]);
    const paint = paintDriver(f);
    f.setHandler((ctx, index) => {
      if (index === 1)
        return ['play', 'tick'].includes(ctx.event.type) ? { wakeAt: ctx.nowMs + 16 } : {};
      if (ctx.event.type === 'play')
        return { state: { mode: 'playing', score: 7 }, wakeAt: ctx.nowMs + 16 };
      if (ctx.event.type === 'tick')
        return { state: { ...(ctx.state as object), score: 8 }, wakeAt: ctx.nowMs + 16 };
      if (ctx.event.type === 'blur')
        return { state: { ...(ctx.state as object), mode: 'paused' }, wakeAt: null };
      if (ctx.event.type === 'focus') return { wakeAt: ctx.nowMs + 16 };
      return {};
    });
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    await paint();
    const first = f.sandboxes[0]!;
    expect(first.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'tick')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(first.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'tick')).toHaveLength(1);
    expect(f.sandboxes[1]!.dispose).not.toHaveBeenCalled();
    expect(f.sandboxes[1]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'tick')).toBe(true);
    expect(f.media.pause).not.toHaveBeenCalledWith('legacy-cue');
    f.setData({ config: { value: 2 } });
    f.setData({ config: { value: 3 } });
    await flush();
    await paint();
    await paint();
    await paint();
    await paint();
    const restored = f.sandboxes[2]!;
    expect(restored.invoke.mock.calls.map(([ctx]) => ctx.event.type)).toEqual([
      'blur',
      'data',
      'focus',
    ]);
    expect(restored.invoke.mock.calls[0]![0].state).toEqual({ mode: 'playing', score: 8 });
    expect(restored.invoke.mock.calls[1]![0].event.changed).toEqual({ settings: { value: 3 } });
    expect(restored.invoke.mock.lastCall![0].state).toEqual({ mode: 'paused', score: 8 });
    expect(f.media.resume).not.toHaveBeenCalled();
    expect(f.errors).not.toHaveBeenCalled();
  });

  it('replays deferred Out before Play so retaking can restart a stopped music cue', async () => {
    const f = fixture([definition({ pointer: true, initialState: { music: 'playing' } })]);
    const paint = paintDriver(f);
    f.setHandler((ctx) =>
      ctx.event.type === 'out'
        ? { state: { music: 'stopped' }, data: { result: 'out' } }
        : ctx.event.type === 'custom-action'
          ? {
              media: [
                {
                  name: 'music',
                  command: (ctx.state as { music: string }).music === 'stopped' ? 'play' : 'resume',
                },
              ],
            }
          : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    await vi.advanceTimersByTimeAsync(200);
    await runtime.setOnAir(false);
    await runtime.setOnAir(true);
    await paint();
    await paint();
    await paint();
    expect(f.sandboxes[1]!.invoke.mock.calls.map(([ctx]) => ctx.event.type)).toEqual([
      'blur',
      'out',
      'play',
      'focus',
    ]);
    expect(f.commit).toHaveBeenCalledWith({ output: 'out' }, 0, {
      event: { type: 'out' },
      onAir: false,
    });
    await runtime.customAction('go');
    expect(f.media.play).toHaveBeenCalledWith('music-cue');
    expect(f.media.resume).not.toHaveBeenCalled();
  });

  it('treats a trusted timeout during stale paint as killed/suspended, while healthy-paint timeout remains fatal', async () => {
    const f = fixture([definition({ pointer: true })]);
    paintDriver(f);
    const pending = deferred<LogicFunctionResult>();
    f.setHandler((ctx) => (ctx.event.type === 'custom-action' ? pending.promise : {}));
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    const action = runtime.customAction('go');
    await flush();
    vi.setSystemTime(Date.now() + 300); // The direct worker response arrives before a throttled main-window watchdog.
    pending.reject(Object.assign(new Error('Timed out'), { code: 'execution-timeout' }));
    await action;
    expect(f.sandboxes[0]!.dispose).toHaveBeenCalledOnce();
    expect(f.errors).not.toHaveBeenCalled();
    const g = fixture([definition({ pointer: true })]);
    const paint = paintDriver(g);
    const rejected = deferred<LogicFunctionResult>();
    g.setHandler((ctx) => (ctx.event.type === 'custom-action' ? rejected.promise : {}));
    const other = g.create();
    await other.ready;
    await other.setOnAir(true);
    const bad = other.customAction('go');
    await flush();
    await paint();
    const failure = expect(bad).rejects.toThrow('Timed out');
    rejected.reject(Object.assign(new Error('Timed out'), { code: 'execution-timeout' }));
    await failure;
    expect(g.errors).toHaveBeenCalledOnce();
  });

  it('suppresses remaining async effects from a suspended sandbox', async () => {
    const f = fixture([definition({ pointer: true })]);
    paintDriver(f);
    const playing = deferred<boolean>();
    f.media.play.mockImplementationOnce(() => playing.promise);
    f.setHandler((ctx) =>
      ctx.event.type === 'custom-action'
        ? {
            media: [
              { name: 'music', command: 'play' },
              { name: 'effect', command: 'restart' },
            ],
            actions: [{ name: 'notify' }],
          }
        : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    const action = runtime.customAction('go');
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    playing.resolve(true);
    await action;
    expect(f.media.restart).not.toHaveBeenCalled();
    expect(f.invokeAction).not.toHaveBeenCalled();
    expect(f.errors).not.toHaveBeenCalled();
  });
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});

describe('opt-in function pointer snapshots', () => {
  it('notifies focus once after blur for Mouse input only, allowing Ready ticks without unpausing state', async () => {
    const f = fixture([
      definition({ pointer: true }),
      definition({ id: 'legacy', name: 'Legacy', outputs: { result: 'legacy' } }),
    ]);
    f.setHandler((ctx, index) => {
      if (index === 1)
        return ctx.event.type === 'play' || ctx.event.type === 'tick'
          ? { wakeAt: ctx.nowMs + 50 }
          : {};
      if (ctx.event.type === 'play')
        return { state: { paused: true, focused: true }, wakeAt: ctx.nowMs + 50 };
      if (ctx.event.type === 'blur')
        return { state: { paused: true, focused: false }, wakeAt: null };
      if (ctx.event.type === 'focus')
        return { state: { ...(ctx.state as object), focused: true }, wakeAt: ctx.nowMs + 50 };
      return ctx.event.type === 'tick' ? { wakeAt: ctx.nowMs + 50 } : {};
    });
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    fire(f.host.ownerDocument.defaultView, 'blur');
    await flush();
    const pointerTicks = () =>
      f.sandboxes[0]!.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'tick').length;
    await vi.advanceTimersByTimeAsync(100);
    expect(pointerTicks()).toBe(0);
    expect(f.sandboxes[1]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'tick')).toBe(true);
    fire(f.host.ownerDocument.defaultView, 'focus');
    fire(f.scope, 'focusin');
    fire(f.host.ownerDocument, 'visibilitychange');
    await flush();
    expect(
      f.sandboxes[0]!.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'focus'),
    ).toHaveLength(1);
    expect(f.sandboxes[1]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'focus')).toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(pointerTicks()).toBe(1);
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].state).toMatchObject({
      paused: true,
      focused: true,
    });
    expect(f.media.resume).not.toHaveBeenCalled();
    expect(f.media.play).not.toHaveBeenCalled();
  });

  it('keeps typing/shadow inputs blurred and ignores focus while hidden, unfocused or off air', async () => {
    const f = fixture([definition({ pointer: true })]);
    const runtime = f.create();
    await runtime.ready;
    fire(f.host.ownerDocument.defaultView, 'focus');
    await flush();
    expect(f.sandboxes[0]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'focus')).toBe(
      false,
    );
    await runtime.setOnAir(true);
    const input = new Host();
    input.tagName = 'INPUT';
    const shadow = new Host();
    shadow.shadowRoot = { activeElement: input };
    f.host.ownerDocument.activeElement = shadow;
    fire(f.scope, 'focusin', { target: shadow, composedPath: () => [input, shadow, f.scope] });
    await flush();
    fire(f.host.ownerDocument.defaultView, 'focus');
    fire(f.host.ownerDocument, 'visibilitychange');
    await flush();
    expect(f.sandboxes[0]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'focus')).toBe(
      false,
    );
    f.host.ownerDocument.activeElement = f.host;
    f.host.ownerDocument.hidden = true;
    fire(f.host.ownerDocument.defaultView, 'focus');
    await flush();
    f.host.ownerDocument.hidden = false;
    f.host.ownerDocument.focused = false;
    fire(f.host.ownerDocument, 'visibilitychange');
    await flush();
    expect(f.sandboxes[0]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'focus')).toBe(
      false,
    );
    f.host.ownerDocument.focused = true;
    fire(f.scope, 'focusin', { target: f.host });
    await flush();
    expect(
      f.sandboxes[0]!.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'focus'),
    ).toHaveLength(1);
    await runtime.setOnAir(false);
    fire(f.host.ownerDocument.defaultView, 'focus');
    await flush();
    expect(
      f.sandboxes[0]!.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'focus'),
    ).toHaveLength(1);
  });

  it('cancels a pending focus gain when another blur occurs and can focus on a later Take', async () => {
    const f = fixture([definition({ pointer: true })]);
    const blur = deferred<LogicFunctionResult>();
    f.setHandler((ctx) => (ctx.event.type === 'blur' ? blur.promise : {}));
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    fire(f.host.ownerDocument.defaultView, 'blur');
    await flush();
    fire(f.host.ownerDocument.defaultView, 'focus');
    fire(f.host.ownerDocument.defaultView, 'blur');
    blur.resolve({ wakeAt: null });
    await flush();
    expect(f.sandboxes[0]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'focus')).toBe(
      false,
    );
    fire(f.host.ownerDocument.defaultView, 'focus');
    await flush();
    expect(
      f.sandboxes[0]!.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'focus'),
    ).toHaveLength(1);
    await runtime.setOnAir(false);
    await runtime.setOnAir(true);
    expect(
      f.sandboxes[0]!.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'focus'),
    ).toHaveLength(2);
  });
  it('samples only opted-in functions and coalesces movement without enqueuing invocations', async () => {
    const f = fixture([
      definition({ pointer: true }),
      definition({ id: 'other', name: 'Other', outputs: { result: 'otherOutput' } }),
    ]);
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    const counts = f.sandboxes.map((sandbox) => sandbox.invoke.mock.calls.length);
    for (let index = 0; index < 1000; index++) runtime.pointerChanged({ x: index, y: index / 2 });
    await flush();
    expect(f.sandboxes.map((sandbox) => sandbox.invoke.mock.calls.length)).toEqual(counts);
    await runtime.customAction('go');
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].pointer).toEqual({ x: 999, y: 499.5 });
    expect(f.sandboxes[1]!.invoke.mock.lastCall![0]).not.toHaveProperty('pointer');
    const position = { x: 24, y: 48 };
    runtime.pointerChanged(position);
    position.x = 999;
    await runtime.customAction('go');
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].pointer).toEqual({ x: 24, y: 48 });
    runtime.pointerChanged(null);
    await runtime.customAction('go');
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].pointer).toBeNull();
  });

  it('samples the newest position when queued work actually starts rather than when it was requested', async () => {
    const f = fixture([definition({ pointer: true })]);
    const first = deferred<LogicFunctionResult>();
    let actionCount = 0;
    f.setHandler((ctx) =>
      ctx.event.type === 'custom-action' && ++actionCount === 1 ? first.promise : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    runtime.pointerChanged({ x: 1, y: 2 });
    const a = runtime.customAction('go');
    await flush();
    const b = runtime.customAction('go');
    await flush();
    runtime.pointerChanged({ x: 30, y: 40 });
    first.resolve({});
    await Promise.all([a, b]);
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].pointer).toEqual({ x: 30, y: 40 });
  });

  it('clears the snapshot on blur, Out, owner adoption and disposal, and rejects nonfinite positions', async () => {
    const f = fixture([definition({ pointer: true })]);
    const runtime = f.create();
    runtime.pointerChanged({ x: 1, y: 2 });
    await runtime.ready;
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].pointer).toBeNull();
    await runtime.setOnAir(true);
    runtime.pointerChanged({ x: 10, y: 20 });
    fire(f.host.ownerDocument.defaultView, 'blur');
    await flush();
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0]).toMatchObject({
      event: { type: 'blur' },
      pointer: null,
    });
    await runtime.customAction('go');
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].pointer).toBeNull();
    runtime.pointerChanged({ x: 10, y: 20 });
    await runtime.setOnAir(false);
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0]).toMatchObject({
      event: { type: 'out' },
      pointer: null,
    });
    runtime.pointerChanged({ x: 10, y: 20 });
    await runtime.setOnAir(true);
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].pointer).toBeNull();
    runtime.pointerChanged({ x: NaN, y: 20 });
    await runtime.customAction('go');
    expect(f.sandboxes[0]!.invoke.mock.lastCall![0].pointer).toBeNull();
    runtime.pointerChanged({ x: 10, y: 20 });
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    await runtime.ready;
    expect(f.sandboxes.at(-1)!.invoke.mock.lastCall![0]).toMatchObject({
      event: { type: 'blur' },
      pointer: null,
    });
    runtime.dispose();
    runtime.pointerChanged({ x: 10, y: 20 });
    expect(await runtime.customAction('go')).toBe(false);
  });
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('generic function runtime state and capability boundaries', () => {
  it('initializes only declared inputs/outputs, with private cloned state and no load effects or off-air ticks', async () => {
    const f = fixture();
    f.setHandler((ctx) => ({
      state: { count: 1 },
      data: { result: ctx.event.type },
      actions: [{ name: 'notify', payload: { secret: 'only a payload' } }],
      media: [{ name: 'music', command: 'play' }],
      wakeAt: 0,
    }));
    const runtime = f.create();
    await runtime.ready;
    expect(f.sandboxes[0]!.invoke.mock.calls[0]![0]).toEqual({
      state: { count: 0 },
      data: { settings: { value: 1 } },
      event: { type: 'load' },
      nowMs: 0,
    });
    expect(f.commit).toHaveBeenCalledExactlyOnceWith({ output: 'load' }, 0, {
      event: { type: 'load' },
      onAir: false,
    });
    expect(f.data().secret).toBe('not an input');
    expect(f.media.play).not.toHaveBeenCalled();
    expect(f.invokeAction).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.sandboxes[0]!.invoke).toHaveBeenCalledTimes(1);
    expect(await runtime.customAction('go')).toBe(false);
    await runtime.setOnAir(true);
    expect(f.sandboxes[0]!.invoke.mock.calls[1]![0].state).toEqual({ count: 1 });
    expect(f.media.play).toHaveBeenCalledWith('music-cue');
    expect(f.invokeAction).toHaveBeenCalledWith('ui.notice', { secret: 'only a payload' }, 1);
  });

  it('keeps state when omitted, skips unchanged output patches, and coalesces input changes to latest aliases', async () => {
    const f = fixture();
    f.setHandler((ctx) =>
      ctx.event.type === 'load'
        ? { state: { count: 7 }, data: { result: 'same' } }
        : { data: { result: 'same' } },
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    await runtime.customAction('go');
    expect(f.commit).toHaveBeenCalledTimes(1);
    f.setData({ config: { value: 2 } });
    f.setData({ config: { value: 3 }, secret: 'unchanged capability' });
    await flush();
    const dataCalls = f.sandboxes[0]!.invoke.mock.calls.map(
      ([ctx]) => ctx as LogicFunctionContext,
    ).filter((ctx) => ctx.event.type === 'data');
    expect(dataCalls).toHaveLength(1);
    expect(dataCalls[0]).toMatchObject({
      state: { count: 7 },
      data: { settings: { value: 3 } },
      event: { changed: { settings: { value: 3 } } },
    });
    const count = f.sandboxes[0]!.invoke.mock.calls.length;
    f.setData({ secret: 'private again' });
    await flush();
    expect(f.sandboxes[0]!.invoke).toHaveBeenCalledTimes(count);
  });

  it.each(['output', 'action', 'media', 'state', 'wake'] as const)(
    'validates the whole %s result before any data or effect commits',
    async (kind) => {
      const f = fixture();
      const runtime = f.create();
      await runtime.ready;
      await runtime.setOnAir(true);
      f.commit.mockClear();
      f.media.play.mockClear();
      const invalid: LogicFunctionResult = {
        state: { count: 99 },
        data: { result: 'must not commit' },
        media: [{ name: 'music', command: 'play' }],
      };
      if (kind === 'output') invalid.data = { unapproved: 'no' };
      if (kind === 'action') invalid.actions = [{ name: 'unapproved' }];
      if (kind === 'media') invalid.media = [{ name: 'unapproved', command: 'play' }];
      if (kind === 'state') invalid.state = 'x'.repeat(257 * 1024);
      if (kind === 'wake') invalid.wakeAt = Infinity;
      f.setHandler(() => invalid);
      await expect(runtime.customAction('go')).rejects.toThrow();
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.media.play).not.toHaveBeenCalled();
      expect(f.data().output).toBe('initial');
      expect(f.errors).toHaveBeenCalledTimes(1);
      expect(f.media.stop).toHaveBeenCalledWith('music-cue');
      expect(await runtime.customAction('go')).toBe(false);
    },
  );

  it('dispatches recursive approved actions outside the invoke gate and bounds action cycles', async () => {
    const f = fixture([definition({ emits: { again: 'go' } })]);
    f.setHandler((ctx) =>
      ctx.event.type === 'custom-action' ? { actions: [{ name: 'again' }] } : {},
    );
    const runtime = f.create();
    f.invokeAction.mockImplementation((id, payload, depth) =>
      runtime.customAction(id, payload, depth),
    );
    await runtime.ready;
    await runtime.setOnAir(true);
    await expect(runtime.customAction('go')).rejects.toThrow('cycle limit');
    expect(f.sandboxes[0]!.invoke.mock.calls.length).toBeLessThanOrEqual(20);
    expect(f.errors).toHaveBeenCalledTimes(1);
  });

  it('bounds an output-to-input feedback loop without exposing unrelated data', async () => {
    const f = fixture([definition({ inputs: { value: 'output' } })]);
    f.reflectOutputs();
    f.setHandler((ctx) => ({
      data: { result: typeof ctx.data.value === 'number' ? ctx.data.value + 1 : 1 },
    }));
    const runtime = f.create();
    await runtime.ready;
    for (let attempt = 0; attempt < 10 && !f.errors.mock.calls.length; attempt++) await flush();
    expect(f.errors).toHaveBeenCalledTimes(1);
    expect(String(f.errors.mock.calls[0]![0])).toContain('cycle limit');
    expect(f.sandboxes[0]!.invoke.mock.calls.length).toBeLessThanOrEqual(18);
  });

  it('passes causal depth and lifecycle context to atomic output commits and propagates rejection', async () => {
    const f = fixture();
    f.setHandler((ctx) =>
      ctx.event.type === 'custom-action'
        ? { data: { result: 'new' }, media: [{ name: 'music', command: 'play' }] }
        : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    f.commit.mockRejectedValueOnce(new Error('Invalid bound output.'));
    await expect(runtime.customAction('go', undefined, 7)).rejects.toThrow('Invalid bound output');
    expect(f.commit).toHaveBeenCalledWith({ output: 'new' }, 7, {
      event: { type: 'custom-action', actionId: 'go' },
      onAir: true,
    });
    expect(f.data().output).toBe('initial');
    expect(f.media.play).not.toHaveBeenCalled();
    expect(f.errors).toHaveBeenCalledTimes(1);
  });
});

describe('function wake, lifecycle and document ownership', () => {
  it('counts execution time toward the tick interval instead of adding it to every frame', async () => {
    const f = fixture();
    const starts: number[] = [];
    f.setHandler(async (ctx) => {
      if (ctx.event.type === 'load') return {};
      starts.push(ctx.nowMs);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return { wakeAt: ctx.nowMs + 16 };
    });
    const runtime = f.create();
    await runtime.ready;
    const play = runtime.setOnAir(true);
    await flush();
    await vi.advanceTimersByTimeAsync(5);
    await play;
    await vi.advanceTimersByTimeAsync(43);
    expect(starts).toEqual([0, 16, 32, 48]);
    expect(f.errors).not.toHaveBeenCalled();
  });

  it('rounds fractional deadlines up once instead of waking early and adding another minimum wait', async () => {
    const f = fixture();
    const starts: number[] = [];
    f.setHandler(async (ctx) => {
      if (ctx.event.type === 'load') return {};
      starts.push(ctx.nowMs);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return { wakeAt: ctx.nowMs + 1000 / 60 };
    });
    const runtime = f.create();
    await runtime.ready;
    const play = runtime.setOnAir(true);
    await flush();
    await vi.advanceTimersByTimeAsync(5);
    await play;
    await vi.advanceTimersByTimeAsync(46);
    expect(starts).toEqual([0, 17, 34, 51]);
  });

  it('honors minimum wake delay, retained omitted deadlines and consumed tick omission', async () => {
    const f = fixture();
    f.setHandler((ctx) =>
      ctx.event.type === 'load'
        ? { wakeAt: 0 }
        : ctx.event.type === 'tick'
          ? { data: { result: ctx.nowMs }, ...(ctx.nowMs < 32 ? { wakeAt: ctx.nowMs } : {}) }
          : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    await vi.advanceTimersByTimeAsync(8);
    await runtime.customAction('go');
    await vi.advanceTimersByTimeAsync(7);
    expect(f.commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.data().output).toBe(16);
    await vi.advanceTimersByTimeAsync(16);
    expect(f.data().output).toBe(32);
    const calls = f.sandboxes[0]!.invoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.sandboxes[0]!.invoke).toHaveBeenCalledTimes(calls);
  });

  it('stops media and discards an in-flight result on Out, applying Out state without play effects', async () => {
    const f = fixture(),
      delayed = deferred<LogicFunctionResult>();
    f.setHandler((ctx) =>
      ctx.event.type === 'load'
        ? { state: { count: 1 } }
        : ctx.event.type === 'custom-action'
          ? delayed.promise
          : ctx.event.type === 'out'
            ? {
                state: { paused: true },
                data: { result: 'paused' },
                media: [
                  { name: 'music', command: 'restart' },
                  { name: 'music', command: 'pause' },
                ],
                wakeAt: null,
              }
            : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    const old = runtime.customAction('go');
    await flush();
    const stopping = runtime.setOnAir(false);
    await flush();
    expect(f.media.stop).toHaveBeenCalledWith('music-cue');
    expect(f.media.restart).not.toHaveBeenCalled();
    expect(f.sandboxes[0]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'out')).toBe(false);
    delayed.resolve({
      state: { count: 99 },
      data: { result: 'late' },
      media: [{ name: 'music', command: 'play' }],
      wakeAt: 0,
    });
    await old;
    await stopping;
    expect(f.data().output).toBe('paused');
    expect(f.errors).not.toHaveBeenCalled();
    expect(f.media.play).not.toHaveBeenCalled();
    await runtime.setOnAir(true);
    expect(f.sandboxes[0]!.invoke.mock.calls.at(-1)![0].state).toEqual({ paused: true });
  });

  it('does not accidentally turn On after a later Out while initialization is still pending', async () => {
    const f = fixture(),
      load = deferred<LogicFunctionResult>();
    f.setHandler((ctx) => (ctx.event.type === 'load' ? load.promise : {}));
    const runtime = f.create();
    const playing = runtime.setOnAir(true);
    const stopped = runtime.setOnAir(false);
    load.resolve({ state: { ready: true } });
    await playing;
    await stopped;
    expect(f.sandboxes[0]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'play')).toBe(
      false,
    );
    expect(await runtime.customAction('go')).toBe(false);
  });

  it("queues blur behind an active worker while discarding that worker's obsolete output", async () => {
    const f = fixture(),
      pendingResult = deferred<LogicFunctionResult>();
    f.setHandler((ctx) =>
      ctx.event.type === 'custom-action'
        ? pendingResult.promise
        : ctx.event.type === 'blur'
          ? { data: { result: 'paused' }, wakeAt: null }
          : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    const active = runtime.customAction('go');
    await flush();
    fire(f.host.ownerDocument.defaultView, 'blur');
    await flush();
    expect(f.media.pause).toHaveBeenCalledWith('music-cue');
    expect(f.sandboxes[0]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'blur')).toBe(
      false,
    );
    pendingResult.resolve({ data: { result: 'obsolete' } });
    await active;
    await flush();
    expect(f.data().output).toBe('paused');
    expect(f.errors).not.toHaveBeenCalled();
    expect(f.commit.mock.calls.some(([patch]) => patch.output === 'obsolete')).toBe(false);
  });

  it('pauses on external/input focus and window visibility, without double-pausing internal buttons', async () => {
    const f = fixture();
    f.setHandler((ctx) =>
      ctx.event.type === 'blur'
        ? {
            state: { paused: true },
            wakeAt: null,
            media: [
              { name: 'music', command: 'pause' },
              { name: 'music', command: 'play' },
            ],
            actions: [{ name: 'notify' }],
          }
        : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    const button = new Host();
    button.tagName = 'BUTTON';
    f.scope.children.push(button);
    fire(f.scope, 'focusout', { relatedTarget: button });
    fire(f.scope, 'focusin', { target: button });
    await flush();
    expect(f.sandboxes[0]!.invoke.mock.calls.some(([ctx]) => ctx.event.type === 'blur')).toBe(
      false,
    );
    const input = new Host();
    input.tagName = 'INPUT';
    f.scope.children.push(input);
    fire(f.scope, 'focusout', { relatedTarget: input });
    fire(f.scope, 'focusin', { target: input });
    await flush();
    expect(
      f.sandboxes[0]!.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'blur'),
    ).toHaveLength(1);
    expect(f.media.pause).toHaveBeenCalledWith('music-cue');
    expect(f.media.play).not.toHaveBeenCalled();
    expect(f.invokeAction).not.toHaveBeenCalled();
    f.host.ownerDocument.hidden = true;
    fire(f.host.ownerDocument, 'visibilitychange');
    fire(f.host.ownerDocument.defaultView, 'blur');
    await flush();
    expect(
      f.sandboxes[0]!.invoke.mock.calls.filter(([ctx]) => ctx.event.type === 'blur'),
    ).toHaveLength(2);
    runtime.dispose();
    const calls = f.sandboxes[0]!.invoke.mock.calls.length;
    fire(f.scope, 'focusout');
    fire(f.host.ownerDocument.defaultView, 'blur');
    await flush();
    expect(f.sandboxes[0]!.invoke).toHaveBeenCalledTimes(calls);
  });

  it('recreates an adopted sandbox with committed state and monotonic time, ignoring old-owner replies', async () => {
    const f = fixture(),
      delayed = deferred<LogicFunctionResult>();
    f.setHandler((ctx, index) =>
      ctx.event.type === 'load'
        ? { state: { count: 7 } }
        : ctx.event.type === 'custom-action' && index === 0
          ? delayed.promise
          : ctx.event.type === 'blur'
            ? {
                state: { ...(ctx.state as object), paused: true },
                data: { result: 'adopted' },
                wakeAt: null,
              }
            : {},
    );
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    const old = runtime.customAction('go');
    await flush();
    const oldDocument = f.host.ownerDocument;
    await vi.advanceTimersByTimeAsync(50);
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    await runtime.ready;
    expect(f.creation).toHaveLength(2);
    expect(f.sandboxes[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(f.sandboxes[1]!.invoke.mock.calls[0]![0]).toMatchObject({
      state: { count: 7 },
      event: { type: 'blur' },
      nowMs: 50,
    });
    delayed.resolve({ state: { count: 99 }, data: { result: 'old document' } });
    await old;
    expect(f.data().output).toBe('adopted');
    const count = f.sandboxes[1]!.invoke.mock.calls.length;
    fire(oldDocument.defaultView, 'blur');
    await flush();
    expect(f.sandboxes[1]!.invoke).toHaveBeenCalledTimes(count);
    runtime.dispose();
    expect(f.sandboxes[1]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('preserves committed state across pagehide before adoption and pauses until an explicit action', async () => {
    const f = fixture(),
      delayed = deferred<LogicFunctionResult>();
    f.setHandler((ctx, index) => {
      if (ctx.event.type === 'load') return { state: { count: 7 }, data: { result: 'playing' } };
      if (ctx.event.type === 'custom-action' && index === 0) return delayed.promise;
      if (ctx.event.type === 'blur')
        return {
          state: { ...(ctx.state as object), paused: true },
          data: { result: 'paused' },
          wakeAt: null,
          media: [{ name: 'music', command: 'resume' }], // Blur can never resume playback.
        };
      if (ctx.event.type === 'custom-action')
        return {
          state: { count: 8, paused: false },
          data: { result: 'resumed' },
          media: [{ name: 'music', command: 'resume' }],
        };
      return {};
    });
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    const oldCall = runtime.customAction('go');
    await flush();
    // Native sandbox teardown rejects its pending call synchronously during pagehide.
    f.sandboxes[0]!.dispose.mockImplementation(() =>
      delayed.reject(new Error('Runtime disposed.')),
    );
    const oldDocument = f.host.ownerDocument;
    fire(oldDocument.defaultView, 'pagehide');
    await oldCall;
    expect(f.errors).not.toHaveBeenCalled();
    expect(f.data().output).toBe('playing');
    expect(f.sandboxes[0]!.dispose).toHaveBeenCalledOnce();
    expect(f.media.pause).toHaveBeenCalledWith('music-cue');
    expect(await runtime.customAction('go')).toBe(false);

    await vi.advanceTimersByTimeAsync(50);
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    await runtime.ready;
    expect(f.creation).toHaveLength(2);
    expect(f.sandboxes[1]!.invoke.mock.calls[0]![0]).toMatchObject({
      state: { count: 7 },
      event: { type: 'blur' },
      nowMs: 50,
    });
    expect(f.data().output).toBe('paused');
    expect(f.media.play).not.toHaveBeenCalled();
    expect(f.media.resume).not.toHaveBeenCalled();
    expect(f.errors).not.toHaveBeenCalled();
    fire(oldDocument.defaultView, 'pagehide');
    await flush();
    expect(f.sandboxes[1]!.dispose).not.toHaveBeenCalled();
    await runtime.customAction('go');
    expect(f.data().output).toBe('resumed');
    expect(f.media.resume).toHaveBeenCalledExactlyOnceWith('music-cue');
  });

  it('retains latest data and explicit Out/Play while a closing owner awaits adoption', async () => {
    const f = fixture();
    f.setHandler((ctx) => (ctx.event.type === 'load' ? { state: { count: 7 } } : {}));
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    fire(f.host.ownerDocument.defaultView, 'pagehide');
    f.setData({ config: { value: 2 } });
    f.setData({ config: { value: 3 } });
    await runtime.setOnAir(false);
    await runtime.setOnAir(true);
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    await runtime.ready;
    expect(f.sandboxes[1]!.invoke.mock.calls.map(([ctx]) => ctx.event.type)).toEqual([
      'blur',
      'out',
      'play',
      'data',
    ]);
    expect(f.sandboxes[1]!.invoke.mock.calls.at(-1)![0]).toMatchObject({
      state: { count: 7 },
      event: { type: 'data', changed: { settings: { value: 3 } } },
    });
    expect(f.errors).not.toHaveBeenCalled();
  });

  it('never revives a genuine source failure when its window is subsequently closed', async () => {
    const f = fixture();
    f.setHandler((ctx) => {
      if (ctx.event.type === 'custom-action') throw new Error('Runtime disposed.');
      return {};
    });
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    await expect(runtime.customAction('go')).rejects.toThrow('Runtime disposed');
    expect(f.errors).toHaveBeenCalledOnce();
    fire(f.host.ownerDocument.defaultView, 'pagehide');
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    await runtime.ready;
    expect(f.creation).toHaveLength(1);
    expect(await runtime.customAction('go')).toBe(false);
    expect(f.errors).toHaveBeenCalledOnce();
  });

  it('does not let a superseded adoption consume deferred lifecycle or latest data', async () => {
    const f = fixture(),
      delayedOut = deferred<LogicFunctionResult>();
    f.setHandler((ctx, index) => {
      if (ctx.event.type === 'load') return { state: { count: 7 } };
      if (ctx.event.type === 'out' && index === 1) return delayedOut.promise;
      return {};
    });
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    fire(f.host.ownerDocument.defaultView, 'pagehide');
    f.setData({ config: { value: 2 } });
    await runtime.setOnAir(false);
    await runtime.setOnAir(true);
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    const firstAdoption = runtime.ready;
    await flush();
    expect(f.sandboxes[1]!.invoke.mock.calls.at(-1)![0].event.type).toBe('out');
    fire(f.host.ownerDocument.defaultView, 'pagehide');
    f.setData({ config: { value: 3 } });
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    await runtime.ready;
    expect(f.sandboxes[2]!.invoke.mock.calls.map(([ctx]) => ctx.event.type)).toEqual([
      'blur',
      'out',
      'play',
      'data',
    ]);
    expect(f.sandboxes[2]!.invoke.mock.calls.at(-1)![0]).toMatchObject({
      state: { count: 7 },
      event: { changed: { settings: { value: 3 } } },
    });
    delayedOut.resolve({ state: { count: 99 }, data: { result: 'obsolete' } });
    await firstAdoption;
    expect(f.data().output).not.toBe('obsolete');
    expect(f.sandboxes[2]!.invoke.mock.calls.map(([ctx]) => ctx.event.type)).toEqual([
      'blur',
      'out',
      'play',
      'data',
    ]);
    expect(f.errors).not.toHaveBeenCalled();
  });

  it('lets the final Out cancel a deferred Play instead of replaying it on a later adoption', async () => {
    const f = fixture();
    const runtime = f.create();
    await runtime.ready;
    await runtime.setOnAir(true);
    fire(f.host.ownerDocument.defaultView, 'pagehide');
    await runtime.setOnAir(false);
    await runtime.setOnAir(true);
    await runtime.setOnAir(false);
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    await runtime.ready;
    expect(f.sandboxes[1]!.invoke.mock.calls.map(([ctx]) => ctx.event.type)).toEqual([
      'blur',
      'out',
    ]);
    await runtime.setOnAir(true);
    expect(f.sandboxes[1]!.invoke.mock.calls.map(([ctx]) => ctx.event.type)).toEqual([
      'blur',
      'out',
      'play',
    ]);
    f.host.ownerDocument = new FakeDocument();
    runtime.rebindOwnerDocument();
    await runtime.ready;
    expect(f.sandboxes[2]!.invoke.mock.calls.map(([ctx]) => ctx.event.type)).toEqual(['blur']);
    expect(f.errors).not.toHaveBeenCalled();
  });
});
