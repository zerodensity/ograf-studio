/// <reference types="node" />
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogicFunctionContext } from '@ograf-editor/scene-model';
import {
  createLogicFunctionSandbox,
  isLogicFunctionExecutionTimeout,
} from './logicFunctionSandbox';

const channel = 'ograf-logic-function-v1';
const context: LogicFunctionContext = {
  state: { count: 1 },
  data: { amount: 2 },
  event: { type: 'tick' },
  nowMs: 10,
};
class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(packet: Record<string, unknown>) => void>();
  start = vi.fn();
  close = vi.fn();
}
function environment(
  source = '(ctx) => ({ state: ctx.state })',
  timeoutMs = 50,
  listeners = new Map<string, Set<(event: unknown) => void>>(),
) {
  const frameWindow = { postMessage: vi.fn() };
  const attributes = new Map<string, string>();
  const port = new FakePort();
  const cleanupPort = new FakePort();
  const frame = {
    srcdoc: '',
    contentWindow: frameWindow,
    hidden: false,
    tabIndex: 0,
    referrerPolicy: '',
    title: '',
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    remove: vi.fn(),
  };
  const owner = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.get(type)?.delete(listener),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const document = {
    defaultView: owner,
    createElement: () => frame,
    body: { appendChild: vi.fn() },
  } as unknown as Document;
  const sandbox = createLogicFunctionSandbox(document, { source, name: 'Test logic', timeoutMs });
  const marker = '/*ograf-config*/';
  const config = JSON.parse(
    frame.srcdoc.slice(
      frame.srcdoc.indexOf(marker) + marker.length,
      frame.srcdoc.lastIndexOf(');</script>'),
    ),
  ) as {
    token: string;
    source: string;
    kernel: string;
    supervisor: string;
    timeoutMs: number;
  };
  let autoAck = true;
  const message = (
    packet: Record<string, unknown>,
    source: unknown = frameWindow,
    ports: FakePort[] = [],
  ) => {
    for (const listener of listeners.get('message') ?? [])
      listener({ source, data: packet, ports });
  };
  const send = (kind: string, id: number, rest: Record<string, unknown> = {}) => {
    const packet = { channel, token: config.token, kind, id, ...rest };
    if (kind === 'frame-ready') message(packet, frameWindow, [port, cleanupPort]);
    else port.onmessage?.({ data: packet });
  };
  port.postMessage.mockImplementation((packet) => {
    if (autoAck && packet.kind === 'dispose') send('disposed', 0);
  });
  const prepare = async () => {
    send('frame-ready', 0);
    send('supervisor-ready', 0);
    send('started', 1);
    send('ready', 1, { elapsedMs: 1 });
    await sandbox.ready;
  };
  return {
    sandbox,
    frame,
    frameWindow,
    attributes,
    listeners,
    config,
    message,
    send,
    prepare,
    requests: port.postMessage,
    port,
    cleanupPort,
    setAutoAck: (value: boolean) => {
      autoAck = value;
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('isolated function host protocol', () => {
  it('uses a cryptographic 128-bit supervisor token when randomUUID is unavailable', async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0x0a));
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      const env = environment();
      expect(getRandomValues).toHaveBeenCalledOnce();
      expect(getRandomValues.mock.calls[0]![0]).toHaveLength(16);
      expect(env.config.token).toBe('0a'.repeat(16));
      await env.prepare();
      env.sandbox.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses an opaque fixed-scaffold frame, denies capabilities and escapes embedded source', async () => {
    const source = '() => ({ state: "</script><script>bad()</script>" })';
    const env = environment(source);
    expect(env.attributes.get('sandbox')).toBe('allow-scripts');
    expect(env.frame.srcdoc.match(/<script>/g)).toHaveLength(1);
    expect(env.frame.srcdoc.match(/<\/script>/g)).toHaveLength(1);
    expect(env.frame.srcdoc).toContain('<script>"use strict";');
    expect(env.config.source).toBe(source);
    expect(env.frame.srcdoc).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'",
    );
    expect(env.frame.srcdoc).not.toContain("script-src 'unsafe-inline' blob:");
    expect(env.attributes.get('allow')).toContain("camera 'none'");
    await env.prepare();
    const probe = env.requests.mock.calls[0]![0];
    expect(probe.kind).toBe('probe');
    expect(JSON.stringify(probe)).not.toContain(env.config.token);
    expect(probe.context).toBeUndefined();
    env.sandbox.dispose();
  });

  it('ignores other windows and accepts only matching frame, token, request and lifecycle', async () => {
    const env = environment();
    env.message({ channel, token: env.config.token, kind: 'frame-ready', id: 0 }, {});
    expect(env.port.start).not.toHaveBeenCalled();
    await env.prepare();
    const result = env.sandbox.invoke(context);
    await Promise.resolve();
    const request = env.requests.mock.calls.at(-1)![0];
    expect(JSON.parse(request.context as string)).toEqual(context);
    expect(request).not.toHaveProperty('token');
    env.send('started', 2);
    env.send('result', 2, { elapsedMs: 2, json: '{"state":{"count":2},"data":{"amount":3}}' });
    await expect(result).resolves.toEqual({ state: { count: 2 }, data: { amount: 3 } });
    env.sandbox.dispose();
  });

  it("keeps simultaneous Functions in one owner from consuming or closing each other's ports", async () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const first = environment(undefined, undefined, listeners);
    const second = environment(undefined, undefined, listeners);
    await first.prepare();
    await second.prepare();
    expect(first.port.start).toHaveBeenCalledOnce();
    expect(second.port.start).toHaveBeenCalledOnce();
    for (const port of [first.port, first.cleanupPort, second.port, second.cleanupPort])
      expect(port.close).not.toHaveBeenCalled();
    first.sandbox.dispose();
    expect(second.port.close).not.toHaveBeenCalled();
    expect(second.cleanupPort.close).not.toHaveBeenCalled();
    const invocation = second.sandbox.invoke(context);
    await Promise.resolve();
    second.send('started', 2);
    second.send('result', 2, { elapsedMs: 1, json: '{}' });
    await expect(invocation).resolves.toEqual({});
    second.sandbox.dispose();
  });

  it('rejects wrong tokens and malformed owned transfers before starting a probe', async () => {
    for (const count of [0, 1, 3]) {
      const env = environment();
      const ports = Array.from({ length: count }, () => new FakePort());
      const rejected = expect(env.sandbox.ready).rejects.toThrow(
        'Invalid isolated supervisor connection',
      );
      env.message(
        { channel, token: env.config.token, kind: 'frame-ready', id: 0 },
        env.frameWindow,
        ports,
      );
      await rejected;
      expect(env.requests).not.toHaveBeenCalled();
      for (const port of ports) expect(port.close).toHaveBeenCalledOnce();
      expect(env.frame.remove).toHaveBeenCalledOnce();
    }
    const duplicate = environment();
    const port = new FakePort();
    const rejectedDuplicate = expect(duplicate.sandbox.ready).rejects.toThrow(
      'Invalid isolated supervisor connection',
    );
    duplicate.message(
      { channel, token: duplicate.config.token, kind: 'frame-ready', id: 0 },
      duplicate.frameWindow,
      [port, port],
    );
    await rejectedDuplicate;
    expect(port.start).not.toHaveBeenCalled();

    const forged = environment();
    const ports = [new FakePort(), new FakePort()];
    const rejectedToken = expect(forged.sandbox.ready).rejects.toThrow(
      'Invalid sandbox bootstrap message',
    );
    forged.message(
      { channel, token: 'wrong', kind: 'frame-ready', id: 0 },
      forged.frameWindow,
      ports,
    );
    await rejectedToken;
    for (const port of ports) {
      expect(port.start).not.toHaveBeenCalled();
      expect(port.close).toHaveBeenCalledOnce();
    }
  });

  it('uses the independent bootstrap cleanup capability if the supervisor transport fails', async () => {
    const env = environment();
    await env.prepare();
    env.setAutoAck(false);
    env.requests.mockImplementation(() => {
      throw new Error('closed supervisor channel');
    });
    env.sandbox.dispose();
    expect(env.cleanupPort.postMessage).toHaveBeenCalledExactlyOnceWith({
      channel,
      kind: 'dispose',
    });
    expect(env.frameWindow.postMessage).not.toHaveBeenCalled();
    expect(env.frame.remove).not.toHaveBeenCalled();
    env.message({ channel, token: env.config.token, kind: 'disposed', id: 0 });
    expect(env.frame.remove).toHaveBeenCalledOnce();
    expect(env.port.close).toHaveBeenCalledOnce();
    expect(env.cleanupPort.close).toHaveBeenCalledOnce();
  });

  it('rejects concurrent invocations without cancelling the first one', async () => {
    const env = environment();
    await env.prepare();
    const first = env.sandbox.invoke(context);
    await expect(env.sandbox.invoke(context)).rejects.toThrow('already running');
    await Promise.resolve();
    env.send('started', 2);
    env.send('result', 2, { elapsedMs: 1, json: '{}' });
    await expect(first).resolves.toEqual({});
    env.sandbox.dispose();
  });

  it('checks a delayed completion without retrying user code or treating delivery delay as execution time', async () => {
    const env = environment();
    await env.prepare();
    const invocation = env.sandbox.invoke(context);
    await Promise.resolve();
    env.send('started', 2);
    await vi.advanceTimersByTimeAsync(50);
    expect(env.requests.mock.calls.at(-1)![0]).toMatchObject({ kind: 'check', id: 2 });
    expect(env.requests.mock.calls.filter(([packet]) => packet.kind === 'invoke')).toHaveLength(1);
    // Only the trusted supervisor can supply this receipt, after native child termination.
    env.send('result', 2, { elapsedMs: 2, json: '{"state":{"count":2}}' });
    await expect(invocation).resolves.toEqual({ state: { count: 2 } });
    env.send('result', 2, { elapsedMs: 2, json: '{"state":{"count":2}}' });
    const next = env.sandbox.invoke(context);
    await Promise.resolve();
    env.send('started', 3);
    env.send('result', 3, { elapsedMs: 1, json: '{}' });
    await expect(next).resolves.toEqual({});
    expect(env.frame.remove).not.toHaveBeenCalled();
    env.sandbox.dispose();
  });

  it('bounds an unanswered completion check and waits for disposal acknowledgment before removing the owner frame', async () => {
    const env = environment();
    await env.prepare();
    const invocation = env.sandbox.invoke(context);
    const failed = expect(invocation).rejects.toThrow('completion delivery timed out');
    await Promise.resolve();
    env.send('started', 2);
    await vi.advanceTimersByTimeAsync(2050);
    await failed;
    expect(env.frame.remove).toHaveBeenCalledOnce();

    const disposed = environment();
    await disposed.prepare();
    disposed.setAutoAck(false);
    disposed.sandbox.dispose();
    expect(disposed.requests.mock.calls.at(-1)![0]).toMatchObject({ kind: 'dispose' });
    expect(disposed.frame.remove).not.toHaveBeenCalled();
    disposed.send('disposed', 0);
    expect(disposed.frame.remove).toHaveBeenCalledOnce();
    expect(disposed.port.close).toHaveBeenCalledOnce();
  });

  it('fails closed on forged or stale messages from the frame itself', async () => {
    const env = environment();
    const rejected = expect(env.sandbox.ready).rejects.toThrow(
      'Test logic: Invalid sandbox bootstrap message',
    );
    env.message({ channel, token: 'wrong', kind: 'frame-ready', id: 0 });
    await rejected;
    expect(env.frame.remove).toHaveBeenCalledOnce();
    expect(env.listeners.get('message')!.size).toBe(0);
    const stale = environment();
    await stale.prepare();
    const result = stale.sandbox.invoke(context);
    const failed = expect(result).rejects.toThrow('Unexpected supervisor response');
    await Promise.resolve();
    stale.send('result', 100, { json: '{}', elapsedMs: 1 });
    await failed;
  });

  it('bounds startup, execution and measured CPU even when the parent timer has not fired', async () => {
    const boot = environment();
    const failedBoot = expect(boot.sandbox.ready).rejects.toThrow('frame did not start');
    await vi.advanceTimersByTimeAsync(2000);
    await failedBoot;
    const timed = environment();
    await timed.prepare();
    const invocation = timed.sandbox.invoke(context);
    const failed = expect(invocation).rejects.toThrow('Execution timed out');
    await Promise.resolve();
    timed.send('started', 2);
    await vi.advanceTimersByTimeAsync(50);
    expect(timed.requests.mock.calls.at(-1)![0]).toMatchObject({ kind: 'check', id: 2 });
    timed.send('error', 2, { message: 'Execution timed out.' });
    await failed;
    const slow = environment();
    await slow.prepare();
    const late = slow.sandbox.invoke(context);
    const failedLate = expect(late).rejects.toThrow('execution deadline');
    await Promise.resolve();
    slow.send('started', 2);
    slow.send('result', 2, { elapsedMs: 90, json: '{}' });
    await failedLate;
  });

  it('marks only authenticated execution deadline failures, never matching user error text', async () => {
    const timed = environment();
    await timed.prepare();
    const failed = timed.sandbox.invoke(context).catch((cause: unknown) => cause);
    await Promise.resolve();
    timed.send('started', 2);
    timed.send('error', 2, {
      message: 'Function execution timed out.',
      code: 'execution-timeout',
      diagnostics: {
        phase: 'execution',
        eventType: 'tick',
        budgetMs: 50,
        payload: 'must not appear',
      },
    });
    const cause = await failed;
    expect(isLogicFunctionExecutionTimeout(cause)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(cause, 'code')?.writable).toBe(false);
    expect(cause).toMatchObject({
      diagnostics: { phase: 'execution', eventType: 'tick', budgetMs: 50 },
    });
    expect((cause as { diagnostics: unknown }).diagnostics).toEqual({
      phase: 'execution',
      eventType: 'tick',
      budgetMs: 50,
    });

    const user = environment();
    await user.prepare();
    const userFailure = user.sandbox.invoke(context).catch((error: unknown) => error);
    await Promise.resolve();
    user.send('started', 2);
    user.send('error', 2, { message: 'Function execution timed out.' });
    expect(isLogicFunctionExecutionTimeout(await userFailure)).toBe(false);
  });

  it('independently rejects oversized or malformed result data from the frame', async () => {
    for (const json of [
      '{"state":NaN}',
      JSON.stringify({ data: { value: 'a'.repeat(65536) } }),
      '{"state":{"__proto__":{}}}',
    ]) {
      const env = environment();
      await env.prepare();
      const invocation = env.sandbox.invoke(context);
      const rejected = expect(invocation).rejects.toThrow('Test logic');
      await Promise.resolve();
      env.send('started', 2);
      env.send('result', 2, { elapsedMs: 2, json });
      await rejected;
      expect(env.frame.remove).toHaveBeenCalledOnce();
    }
  });

  it('rejects accessor input without running getters and disposes pending work idempotently', async () => {
    const env = environment();
    await env.prepare();
    const getter = vi.fn(() => 1);
    const state = Object.defineProperty({}, 'count', { get: getter, enumerable: true });
    await expect(env.sandbox.invoke({ ...context, state })).rejects.toThrow(
      'Test logic: JSON accessors',
    );
    expect(getter).not.toHaveBeenCalled();
    const pending = environment();
    await pending.prepare();
    const invocation = pending.sandbox.invoke(context);
    const rejected = expect(invocation).rejects.toThrow('Runtime disposed');
    await Promise.resolve();
    pending.sandbox.dispose();
    pending.sandbox.dispose();
    await rejected;
    expect(pending.frame.remove).toHaveBeenCalledOnce();
    expect(pending.listeners.get('message')!.size).toBe(0);
    expect(pending.listeners.get('pagehide')!.size).toBe(0);
    await expect(pending.sandbox.invoke(context)).rejects.toThrow('Runtime disposed');
  });

  it('rejects sparse input arrays and extra array properties instead of silently normalizing them', async () => {
    const sparse: number[] = [];
    sparse.length = 2;
    for (const state of [sparse, Object.assign([1], { extra: 'lost during JSON.stringify' })]) {
      const env = environment();
      await env.prepare();
      await expect(env.sandbox.invoke({ ...context, state })).rejects.toThrow(
        'JSON arrays cannot contain',
      );
      expect(env.requests.mock.calls.some(([packet]) => packet.kind === 'invoke')).toBe(false);
      expect(env.frame.remove).toHaveBeenCalledOnce();
    }
  });
});

describe('frame-originated transport for detached owners', () => {
  function bootstrap(failTransfer = false) {
    const env = environment();
    const channels: Array<{ port1: FakePort; port2: FakePort }> = [];
    const handlers = new Map<string, (event: unknown) => void>();
    class Channel {
      port1 = new FakePort();
      port2 = new FakePort();
      constructor() {
        channels.push(this);
      }
    }
    const workers: Worker[] = [];
    class Worker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        workers.push(this);
      }
    }
    const parentPost = vi.fn(
      (packet: Record<string, unknown>, _target: string, ports: FakePort[]) => {
        if (failTransfer && packet.kind === 'frame-ready') throw new Error('Transfer failed');
        // This is the frame's actual parent, distinct from the VM running the test/runtime.
        env.message(packet, env.frameWindow, ports);
      },
    );
    const revoke = vi.fn();
    const script = env.frame.srcdoc.slice(
      env.frame.srcdoc.indexOf('<script>') + 8,
      env.frame.srcdoc.lastIndexOf('</script>'),
    );
    runInNewContext(script, {
      parent: { postMessage: parentPost },
      MessageChannel: Channel,
      Worker,
      Blob,
      URL: { createObjectURL: () => 'blob:supervisor', revokeObjectURL: revoke },
      addEventListener: (type: string, callback: (event: unknown) => void) =>
        handlers.set(type, callback),
    });
    const send = (kind: string, id: number, rest: Record<string, unknown> = {}) =>
      channels[0]!.port1.onmessage?.({
        data: { channel, token: env.config.token, kind, id, ...rest },
      });
    return { ...env, channels, workers, parentPost, revoke, handlers, supervisorSend: send };
  }

  it('connects directly from the fixed frame and transfers authenticated capabilities to its owner', async () => {
    const env = bootstrap();
    const [control, cleanup] = env.channels;
    expect(env.channels).toHaveLength(2);
    expect(env.workers[0]!.postMessage).toHaveBeenCalledExactlyOnceWith(
      { channel, kind: 'connect' },
      [control!.port2],
    );
    expect(env.parentPost).toHaveBeenCalledExactlyOnceWith(
      { channel, token: env.config.token, kind: 'frame-ready', id: 0 },
      '*',
      [control!.port1, cleanup!.port1],
    );
    expect(env.frameWindow.postMessage).not.toHaveBeenCalled();
    expect(control!.port1.start).toHaveBeenCalledOnce();
    expect(cleanup!.port2.start).toHaveBeenCalledOnce();
    expect(control!.port1.postMessage).not.toHaveBeenCalled();
    env.supervisorSend('supervisor-ready', 0);
    expect(control!.port1.postMessage.mock.calls[0]![0]).toMatchObject({ kind: 'probe', id: 1 });
    env.supervisorSend('started', 1);
    env.supervisorSend('ready', 1, { elapsedMs: 1 });
    await env.sandbox.ready;

    env.sandbox.dispose();
    expect(control!.port1.postMessage.mock.calls.at(-1)![0]).toMatchObject({ kind: 'dispose' });
    expect(cleanup!.port1.postMessage).toHaveBeenCalledExactlyOnceWith({
      channel,
      kind: 'dispose',
    });
    expect(env.frame.remove).not.toHaveBeenCalled();
    cleanup!.port2.onmessage!({ data: { channel, kind: 'dispose' } });
    expect(env.workers[0]!.postMessage.mock.calls.at(-1)![0]).toMatchObject({ kind: 'dispose' });
    env.workers[0]!.onmessage!({
      data: { channel, token: env.config.token, kind: 'disposed', id: 0 },
    });
    expect(env.workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(env.revoke).toHaveBeenCalledExactlyOnceWith('blob:supervisor');
    expect(env.frame.remove).toHaveBeenCalledOnce();
    expect(env.workers[0]!.terminate.mock.invocationCallOrder[0]).toBeLessThan(
      env.frame.remove.mock.invocationCallOrder[0]!,
    );
  });

  it('terminates the scaffold supervisor and closes both channels if its transfer fails', async () => {
    const env = bootstrap(true);
    await expect(env.sandbox.ready).rejects.toThrow('Could not start isolated supervisor');
    expect(env.workers[0]!.terminate).toHaveBeenCalledOnce();
    for (const pair of env.channels) {
      expect(pair.port1.close).toHaveBeenCalled();
      expect(pair.port2.close).toHaveBeenCalled();
    }
    expect(env.frame.remove).toHaveBeenCalledOnce();
    expect(env.workers[0]!.postMessage.mock.calls).toHaveLength(1);
  });
});

function kernelResult(source: string, probe = false) {
  const env = environment(source, 1000);
  const packets: Array<Record<string, unknown>> = [];
  const scope: Record<string, unknown> = {
    TextEncoder,
    performance: { now: () => 1 },
    postMessage: (value: Record<string, unknown>) => packets.push(value),
  };
  scope.self = scope;
  runInNewContext(
    `(${env.config.kernel})(${JSON.stringify({ token: 'private-token', id: 7, source, probe, budget: 1000 })});`,
    scope,
  );
  const onmessage = scope.onmessage as (event: { data: { context: string } }) => void;
  onmessage({ data: { id: 7, probe, context: JSON.stringify(context) } } as never);
  env.sandbox.dispose();
  return packets;
}

describe('actual one-shot Worker kernel', () => {
  it('does not charge native parsing/descheduling time to the later user-code deadline', () => {
    const source = '(ctx) => ({ state: ctx.state })';
    const env = environment(source, 50);
    const packets: Array<Record<string, unknown>> = [];
    const times = [0, 350, 350, 352];
    const scope: Record<string, unknown> = {
      TextEncoder,
      performance: { now: () => times.shift() ?? 352 },
      postMessage: (value: Record<string, unknown>) => packets.push(value),
    };
    runInNewContext(
      `"use strict";(${env.config.kernel})(${JSON.stringify({ token: 'private', source, budget: 50 })});`,
      scope,
    );
    expect(packets[0]).toMatchObject({ kind: 'prepared', compileMs: 350 });
    (scope.onmessage as (event: unknown) => void)({
      data: { id: 1, context: JSON.stringify(context) },
    });
    expect(packets.at(-1)).toMatchObject({ kind: 'result', elapsedMs: 2 });
    env.sandbox.dispose();
  });

  it('prepares without evaluating the user expression and never executes a worker twice', () => {
    const source =
      '(() => { globalThis.expressionRuns = (globalThis.expressionRuns || 0) + 1; return () => ({ state: globalThis.expressionRuns }); })()';
    const env = environment(source, 1000);
    const packets: Array<Record<string, unknown>> = [];
    const scope: Record<string, unknown> = {
      TextEncoder,
      performance: { now: () => 1 },
      postMessage: (value: Record<string, unknown>) => packets.push(value),
    };
    runInNewContext(
      `"use strict";(${env.config.kernel})(${JSON.stringify({ token: 'private', source, budget: 1000 })});`,
      scope,
    );
    expect(packets.map((packet) => packet.kind)).toEqual(['prepared']);
    expect(scope.expressionRuns).toBeUndefined();
    const invoke = scope.onmessage as (event: unknown) => void;
    invoke({ data: { id: 1, context: JSON.stringify(context) } });
    expect(scope.expressionRuns).toBe(1);
    expect(packets.at(-1)!.kind).toBe('result');
    invoke({ data: { id: 2, context: JSON.stringify(context) } });
    expect(scope.expressionRuns).toBe(1);
    expect(packets.at(-1)).toMatchObject({
      kind: 'error',
      id: 1,
      message: 'A worker can execute only one invocation.',
    });
    env.sandbox.dispose();
  });

  it('does not let user code revoke the shared immutable script URL or retain Blob URLs', () => {
    class WorkerUrl {
      static createObjectURL = vi.fn();
      static revokeObjectURL = vi.fn();
    }
    const source =
      '() => ({ data: { create: typeof URL.createObjectURL, revoke: typeof URL.revokeObjectURL } })';
    const env = environment(source, 1000);
    const packets: Array<Record<string, unknown>> = [];
    const scope: Record<string, unknown> = {
      URL: WorkerUrl,
      TextEncoder,
      performance: { now: () => 1 },
      postMessage: (value: Record<string, unknown>) => packets.push(value),
    };
    runInNewContext(
      `"use strict";(${env.config.kernel})(${JSON.stringify({ token: 'private', source, budget: 1000 })});`,
      scope,
    );
    (scope.onmessage as (event: unknown) => void)({
      data: { id: 1, context: JSON.stringify(context) },
    });
    expect(JSON.parse(packets.at(-1)!.json as string)).toEqual({
      data: { create: 'undefined', revoke: 'undefined' },
    });
    env.sandbox.dispose();
  });

  it('compiles a probe without invoking the returned function', () => {
    const packets = kernelResult('() => { throw new Error("invoked"); }', true);
    expect(packets.map((packet) => packet.kind)).toEqual(['prepared', 'started', 'ready']);
  });

  it('returns bounded JSON and keeps its private token out of user context/global state', () => {
    const packets = kernelResult(
      '(ctx) => ({state:ctx.state, data:{value:ctx.data.amount+1, token:typeof token, post:typeof postMessage}})',
    );
    expect(packets.at(-1)!.kind).toBe('result');
    expect(JSON.parse(packets.at(-1)!.json as string)).toEqual({
      state: { count: 1 },
      data: { value: 3, token: 'undefined', post: 'undefined' },
    });
  });

  it.each([
    ['() => Promise.resolve({})', 'Promise'],
    ['() => ({ get state() { throw new Error("getter executed"); } })', 'accessors'],
    ['() => { const state={}; state.self=state; return {state}; }', 'cycles'],
    ['() => ({state:Infinity})', 'finite JSON'],
    ['() => ({data:{text:"x".repeat(65536)}})', 'size limit'],
    ['() => ({state:"é".repeat(131072)})', 'size limit'],
    ['() => ({data:"€".repeat(21845)})', 'size limit'],
    ['() => ({other:"x".repeat(524288)})', 'size limit'],
  ])('rejects invalid results inside the Worker: %s', (source, expected) => {
    const result = kernelResult(source).at(-1)!;
    expect(result.kind).toBe('error');
    expect(result.message).toContain(expected);
    expect(result.message).not.toContain('getter executed');
  });

  it('preserves exact result JSON while enforcing state/data byte caps in the first traversal', () => {
    const expected = {
      state: { count: 42, list: [null, true, -1.5, 'é\n"'] },
      data: { status: 'valid', nested: { value: 3 } },
      wakeAt: 16,
    };
    const result = kernelResult(`() => (${JSON.stringify(expected)})`).at(-1)!;
    expect(result.kind).toBe('result');
    expect(result.json).toBe(JSON.stringify(expected));
  });

  it('does not trust user replacements of serialization helpers or inherited toJSON methods', () => {
    const result = kernelResult(
      '() => { Object.prototype.toJSON = () => ({leak:true}); JSON.stringify = () => "forged"; Object.getOwnPropertyDescriptors = () => ({}); return {state:{safe:1}}; }',
    ).at(-1)!;
    expect(result.kind).toBe('result');
    expect(JSON.parse(result.json as string)).toEqual({ state: { safe: 1 } });
  });

  it('caps thrown messages using captured native slicing despite user prototype changes', () => {
    const result = kernelResult(
      '() => { String.prototype.slice = () => "x".repeat(1048576); throw "z".repeat(2000); }',
    ).at(-1)!;
    expect(result.kind).toBe('error');
    expect(result.message).toBe('z'.repeat(1000));
  });

  it('does not forward a user-thrown timeout code as a trusted supervisor failure', () => {
    const packet = kernelResult(
      '() => { const error = new Error("Function execution timed out."); error.code="execution-timeout"; throw error; }',
    ).at(-1)!;
    expect(packet.kind).toBe('error');
    expect(packet).not.toHaveProperty('code');
  });
});

describe('trusted supervisor worker ownership', () => {
  function frameEnvironment() {
    const env = environment();
    const handlers = new Map<string, (event: unknown) => void>();
    const workers: FakeWorker[] = [];
    const workerSources: string[] = [];
    class FakeWorker {
      url: string;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: unknown = null;
      onmessageerror: unknown = null;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor(url: string) {
        this.url = url;
        workers.push(this);
      }
    }
    const parent = new FakePort();
    class FakeBlob {
      source: string;
      constructor(parts: string[]) {
        this.source = parts.join('');
      }
    }
    const urls = {
      createObjectURL: vi.fn((blob: FakeBlob) => {
        workerSources.push(blob.source);
        return `blob:worker-${workers.length}`;
      }),
      revokeObjectURL: vi.fn(),
    };
    const scope: Record<string, unknown> = {
      postMessage: vi.fn(),
      close: vi.fn(),
      Worker: FakeWorker,
      Blob: FakeBlob,
      URL: urls,
      performance: { now: () => Date.now() },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: (name: string, callback: (event: unknown) => void) =>
        handlers.set(name, callback),
    };
    const script =
      '"use strict";(' +
      env.config.supervisor +
      ')(' +
      JSON.stringify({
        token: env.config.token,
        source: env.config.source,
        timeoutMs: env.config.timeoutMs,
        kernel: env.config.kernel,
      }) +
      ');';
    runInNewContext(script, scope);
    const ownerMessage = scope.onmessage as (event: unknown) => void;
    ownerMessage({ data: { channel, kind: 'connect' }, ports: [parent] });
    handlers.set('pagehide', () => ownerMessage({ data: { channel, kind: 'dispose' }, ports: [] }));
    void env.prepare().catch(() => undefined);
    const invoke = (id: number, source: unknown = parent) =>
      source === parent
        ? parent.onmessage!({ data: { channel, kind: 'invoke', id, context: '{}' } })
        : undefined;
    const send = (
      worker: FakeWorker,
      kind: string,
      id: number,
      extra: Record<string, unknown> = {},
    ) => worker.onmessage!({ data: { channel, token: env.config.token, kind, id, ...extra } });
    return { ...env, workers, workerSources, parent, urls, handlers, invoke, sendWorker: send };
  }

  it('rejects other senders and terminates/revokes immediately on invalid Worker traffic', () => {
    const env = frameEnvironment();
    const initialWorkers = env.workers.length;
    env.invoke(8, {});
    expect(env.workers).toHaveLength(initialWorkers);
    env.invoke(8);
    const worker = env.workers[0]!;
    worker.onmessage!({ data: { channel, token: 'forged', kind: 'result', id: 8 } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(env.workers.every((candidate) => candidate.terminate.mock.calls.length === 1)).toBe(
      true,
    );
    expect(env.urls.revokeObjectURL).toHaveBeenCalledOnce();
    expect(env.parent.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      kind: 'error',
      id: 8,
      message: 'Invalid function worker message.',
    });
    expect(worker.onmessage).toBeNull();
    env.sandbox.dispose();
  });

  it('keeps only one unused prepared worker and shares immutable script bytes without reusing globals', () => {
    const env = frameEnvironment();
    const first = env.workers[0]!;
    expect(env.workers).toHaveLength(1);
    env.sendWorker(first, 'prepared', 0, { compileMs: 2 });
    expect(first.postMessage).not.toHaveBeenCalled();
    env.invoke(8);
    expect(env.workers).toHaveLength(2);
    const second = env.workers[1]!;
    env.sendWorker(second, 'prepared', 0, { compileMs: 1 });
    expect(second.postMessage).not.toHaveBeenCalled();
    expect(first.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 8,
      probe: false,
      context: '{}',
    });
    // Remains strict even if an ESM minifier removes directives from function.toString().
    expect(env.workerSources[0]).toMatch(/^"use strict";/);
    env.sendWorker(first, 'started', 8);
    expect(env.parent.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      kind: 'started',
      remainingMs: 50,
    });
    env.sendWorker(first, 'result', 8, { json: '{}', elapsedMs: 3 });
    expect(first.terminate).toHaveBeenCalledOnce();
    const resultIndex = env.parent.postMessage.mock.calls.findIndex(
      ([packet]) => packet.kind === 'result' && packet.id === 8,
    );
    expect(first.terminate.mock.invocationCallOrder[0]).toBeLessThan(
      env.parent.postMessage.mock.invocationCallOrder[resultIndex]!,
    );
    expect(first.postMessage.mock.calls[0]).toHaveLength(1);
    expect(env.workers.filter((worker) => !worker.terminate.mock.calls.length)).toHaveLength(1);
    env.invoke(9);
    expect(env.workers.filter((worker) => !worker.terminate.mock.calls.length)).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(second.url).toBe(first.url);
    expect(env.urls.createObjectURL).toHaveBeenCalledOnce();
    expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 9,
      probe: false,
      context: '{}',
    });
    env.handlers.get('pagehide')!({});
    expect(env.workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    const disposedIndex = env.parent.postMessage.mock.calls.findIndex(
      ([packet]) => packet.kind === 'disposed',
    );
    const acknowledgedAt = env.parent.postMessage.mock.invocationCallOrder[disposedIndex]!;
    for (const worker of env.workers)
      expect(worker.terminate.mock.invocationCallOrder[0]).toBeLessThan(acknowledgedAt);
    expect(env.urls.revokeObjectURL).toHaveBeenCalledOnce();
    env.sandbox.dispose();
  });

  it('preserves the authored execution deadline after bounded native preparation and still times out user code', async () => {
    const env = frameEnvironment();
    env.invoke(9);
    const second = env.workers[0]!;
    env.sendWorker(second, 'prepared', 0, { compileMs: 350 });
    env.sendWorker(second, 'started', 9);
    expect(env.parent.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      kind: 'started',
      remainingMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(second.terminate).toHaveBeenCalledOnce();
    expect(env.parent.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      kind: 'error',
      id: 9,
      message: 'Function execution timed out.',
      code: 'execution-timeout',
    });
    expect(env.workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(env.urls.revokeObjectURL).toHaveBeenCalledOnce();
    env.sandbox.dispose();
  });

  it('discards an expired unused spare without faulting the function or starting a retry loop', async () => {
    const env = frameEnvironment();
    env.sendWorker(env.workers[0]!, 'prepared', 0, { compileMs: 1 });
    env.invoke(8);
    env.sendWorker(env.workers[0]!, 'started', 8);
    env.sendWorker(env.workers[0]!, 'result', 8, { json: '{}', elapsedMs: 1 });
    const count = env.workers.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(env.workers).toHaveLength(count);
    expect(env.workers[1]!.terminate).toHaveBeenCalledOnce();
    expect(env.parent.postMessage.mock.calls.some(([packet]) => packet.kind === 'error')).toBe(
      false,
    );
    expect(env.urls.revokeObjectURL).not.toHaveBeenCalled();
    env.invoke(9);
    const fresh = env.workers[2]!;
    env.sendWorker(fresh, 'prepared', 0, { compileMs: 1 });
    expect(fresh.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 9,
      probe: false,
      context: '{}',
    });
    env.handlers.get('pagehide')!({});
    env.sandbox.dispose();
  });

  it('replaces a consumed stale preparation at most once before any user code starts', async () => {
    const env = frameEnvironment();
    await vi.advanceTimersByTimeAsync(1900);
    env.invoke(8);
    await vi.advanceTimersByTimeAsync(100);
    expect(env.workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(env.workers[0]!.postMessage).not.toHaveBeenCalled();
    const replacement = env.workers[1]!;
    env.sendWorker(replacement, 'prepared', 0, { compileMs: 30 });
    expect(replacement.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 8,
      probe: false,
      context: '{}',
    });
    env.sendWorker(replacement, 'started', 8);
    env.sendWorker(replacement, 'result', 8, { json: '{}', elapsedMs: 1 });
    expect(env.parent.postMessage.mock.calls.some(([packet]) => packet.kind === 'error')).toBe(
      false,
    );
    expect(env.workers.filter((worker) => !worker.terminate.mock.calls.length)).toHaveLength(1);
    env.handlers.get('pagehide')!({});
    env.sandbox.dispose();
  });

  it('never extends the original two-second request startup deadline during recovery', async () => {
    const env = frameEnvironment();
    await vi.advanceTimersByTimeAsync(1900);
    env.invoke(8);
    await vi.advanceTimersByTimeAsync(2000);
    expect(env.parent.postMessage.mock.calls.at(-1)![0]).toMatchObject({ kind: 'error', id: 8 });
    expect(env.workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(env.workers.every((worker) => worker.postMessage.mock.calls.length === 0)).toBe(true);
    expect(env.urls.revokeObjectURL).toHaveBeenCalledOnce();
    const count = env.workers.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(env.workers).toHaveLength(count);
    env.sandbox.dispose();
  });
});
