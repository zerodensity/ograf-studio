/// <reference types="node" />
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogicFunctionSandbox } from './logicFunctionSandbox';

const channel = 'ograf-logic-function-v1';
type Packet = Record<string, unknown>;
class Port {
  onmessage: ((event: { data: Packet }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(packet: Packet) => void>();
  start = vi.fn();
  close = vi.fn();
}

/** Obtain the actual serialized supervisor, without exporting privileged implementation APIs. */
function generatedConfig() {
  const frame = {
    srcdoc: '',
    contentWindow: { postMessage: vi.fn() },
    setAttribute: vi.fn(),
    remove: vi.fn(),
  };
  class Channel {
    port1 = new Port();
    port2 = new Port();
  }
  const owner = {
    MessageChannel: Channel,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: () => 0,
    clearTimeout: vi.fn(),
  };
  const document = {
    defaultView: owner,
    createElement: () => frame,
    body: { appendChild: vi.fn() },
  } as unknown as Document;
  const sandbox = createLogicFunctionSandbox(document, {
    name: 'Supervisor test',
    source: '(ctx)=>({state:ctx.state})',
    timeoutMs: 50,
  });
  const marker = '/*ograf-config*/';
  const config = JSON.parse(
    frame.srcdoc.slice(
      frame.srcdoc.indexOf(marker) + marker.length,
      frame.srcdoc.lastIndexOf(');</script>'),
    ),
  ) as { token: string; source: string; timeoutMs: number; kernel: string; supervisor: string };
  sandbox.dispose();
  return config;
}

function fixture() {
  const config = generatedConfig();
  const order: string[] = [],
    packets: Packet[] = [],
    fallback: Packet[] = [];
  const children: Child[] = [];
  let peakLive = 0;
  class Child {
    id = children.length;
    stopped = false;
    onmessage: ((event: { data: Packet }) => void) | null = null;
    onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn((..._args: unknown[]) => {
      order.push(`invoke:${this.id}`);
    });
    terminate = vi.fn(() => {
      this.stopped = true;
      order.push(`terminate:${this.id}`);
    });
    constructor(readonly url: string) {
      children.push(this);
      peakLive = Math.max(peakLive, children.filter((child) => !child.stopped).length);
    }
    emit(kind: string, id = 0, extra: Packet = {}) {
      this.onmessage?.({ data: { channel, token: config.token, kind, id, ...extra } });
    }
  }
  const port = new Port();
  port.postMessage.mockImplementation((packet) => {
    packets.push(packet);
    order.push(`port:${packet.kind}:${packet.id}`);
  });
  port.close.mockImplementation(() => {
    order.push('port:close');
  });
  const revoke = vi.fn(() => {
    order.push('revoke');
  });
  const scope: Record<string, unknown> = {
    Worker: Child,
    Blob,
    URL: {
      createObjectURL: vi.fn(() => 'blob:opaque-private-child-script'),
      revokeObjectURL: revoke,
    },
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    postMessage: (packet: Packet) => {
      fallback.push(packet);
      order.push(`fallback:${packet.kind}:${packet.id}`);
    },
    close: () => {
      order.push('supervisor:close');
    },
  };
  runInNewContext(`"use strict";(${config.supervisor})(${JSON.stringify(config)});`, scope);
  const receiveOwner = scope.onmessage as (event: { data: Packet; ports?: Port[] }) => void;
  receiveOwner({ data: { channel, kind: 'connect' }, ports: [port] });
  const request = (kind: string, id?: number, extra: Packet = {}) =>
    port.onmessage?.({ data: { channel, kind, ...(id === undefined ? {} : { id }), ...extra } });
  // The host submits its probe after the connection acknowledgment. Completing
  // the probe leaves the supervisor with the same idle spare as a ready sandbox.
  request('probe', 1);
  const probe = children[0]!;
  probe.emit('prepared', 0, { compileMs: 1 });
  probe.emit('started', 1);
  probe.emit('ready', 1, { elapsedMs: 1 });
  const invoke = (id: number) => {
    const child = children.find(
      (candidate) => !candidate.stopped && candidate.postMessage.mock.calls.length === 0,
    )!;
    child.emit('prepared', 0, { compileMs: 1 });
    request('invoke', id, {
      context: JSON.stringify({ state: { id }, data: {}, event: { type: 'tick' }, nowMs: id }),
    });
    child.emit('started', id);
    return child;
  };
  return {
    config,
    children,
    order,
    packets,
    fallback,
    port,
    revoke,
    receiveOwner,
    request,
    invoke,
    peakLive: () => peakLive,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('trusted Function supervisor', () => {
  it('terminates a consumed child before forwarding its accepted result through the private port', () => {
    const f = fixture();
    expect(f.port.start).toHaveBeenCalledOnce();
    expect(f.packets[0]!.kind).toBe('supervisor-ready');
    expect(f.children[0]!.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 1,
      probe: true,
      context: undefined,
    });
    const child = f.invoke(2);
    child.emit('result', 2, { json: '{"state":{"ok":true}}', elapsedMs: 2 });
    expect(child.terminate).toHaveBeenCalledOnce();
    expect(f.order.indexOf(`terminate:${child.id}`)).toBeLessThan(f.order.indexOf('port:result:2'));
    expect(f.fallback).toEqual([]);
    expect(f.children.filter((entry) => !entry.stopped)).toHaveLength(1);
  });

  it('never transfers the parent port to a child and never reuses an executed realm', () => {
    const f = fixture();
    for (let id = 2; id <= 13; id++) {
      const child = f.invoke(id);
      expect(child.postMessage).toHaveBeenCalledOnce();
      const args = child.postMessage.mock.calls[0]!;
      expect(args).toHaveLength(1);
      expect(args[0]).toMatchObject({ id, probe: false });
      expect(Object.keys(args[0] as object).sort()).toEqual(['context', 'id', 'probe']);
      expect(args).not.toContain(f.port);
      expect(JSON.stringify(args)).not.toContain(f.config.token);
      child.emit('result', id, { json: '{}', elapsedMs: 1 });
    }
    expect(f.peakLive()).toBe(2);
    expect(f.children).toHaveLength(14);
    expect(
      f.children
        .slice(0, 13)
        .every((child) => child.stopped && child.postMessage.mock.calls.length === 1),
    ).toBe(true);
    const otherPort = new Port();
    f.receiveOwner({ data: { channel, kind: 'connect' }, ports: [otherPort] });
    expect(otherPort.start).not.toHaveBeenCalled();
  });

  it('kills active and idle children before acknowledging disposal and revokes its cached URL', () => {
    const f = fixture();
    const active = f.invoke(2);
    const spare = f.children.at(-1)!;
    expect(f.children.filter((child) => !child.stopped)).toHaveLength(2);
    f.order.length = 0;
    f.request('dispose');
    expect(f.children.every((child) => child.stopped)).toBe(true);
    expect(f.order).toEqual([
      `terminate:${active.id}`,
      `terminate:${spare.id}`,
      'revoke',
      'port:disposed:0',
      'fallback:disposed:0',
      'port:close',
      'supervisor:close',
    ]);
    expect(f.revoke).toHaveBeenCalledExactlyOnceWith('blob:opaque-private-child-script');
  });

  it('replays a verified terminated completion on a delayed timeout check without invoking again', async () => {
    const f = fixture();
    const child = f.invoke(2);
    // The next unused realm can remain prepared while the parent event loop is delayed.
    f.children.at(-1)!.emit('prepared', 0, { compileMs: 1 });
    child.emit('result', 2, { json: '{"data":{"score":1}}', elapsedMs: 2 });
    const original = f.packets.at(-1)!;
    await vi.advanceTimersByTimeAsync(500);
    f.request('check', 2);
    expect(f.packets.at(-1)).toEqual(original);
    expect(f.packets.filter((packet) => packet.kind === 'result')).toHaveLength(2);
    expect(child.postMessage).toHaveBeenCalledOnce();
    expect(child.terminate).toHaveBeenCalledOnce();
    expect(f.children).toHaveLength(3);
    expect(f.packets.some((packet) => packet.kind === 'error')).toBe(false);
  });

  it('enforces real execution timeouts and terminates all children before reporting failure', async () => {
    const f = fixture();
    const child = f.invoke(2);
    const spare = f.children.at(-1)!;
    await vi.advanceTimersByTimeAsync(50);
    expect(child.stopped).toBe(true);
    expect(f.children.every((entry) => entry.stopped)).toBe(true);
    const errorIndex = f.order.indexOf('port:error:2');
    expect(errorIndex).toBeGreaterThan(f.order.indexOf(`terminate:${child.id}`));
    expect(errorIndex).toBeGreaterThan(f.order.indexOf(`terminate:${spare.id}`));
    expect(f.packets.at(-1)).toMatchObject({
      kind: 'error',
      id: 2,
      message: 'Function execution timed out.',
    });
  });

  it('rejects late over-budget results and aborts a still-running child on an explicit check', () => {
    const f = fixture();
    const child = f.invoke(2);
    child.emit('result', 2, { json: '{}', elapsedMs: 51 });
    expect(f.packets.at(-1)).toMatchObject({ kind: 'error', id: 2 });
    expect(f.packets.some((packet) => packet.kind === 'result')).toBe(false);
    expect(f.children.every((entry) => entry.stopped)).toBe(true);
    const other = fixture();
    other.invoke(2);
    other.request('check', 2);
    expect(other.children.every((entry) => entry.stopped)).toBe(true);
    expect(other.packets.at(-1)).toMatchObject({ kind: 'error', id: 2 });
  });
});
