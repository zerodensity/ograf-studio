import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedGraphicInput } from '@ograf-editor/ograf-types';
import { createSharedInput, type SharedInputEntry } from './shared-input.js';

function inputGraphic() {
  let handler: ((input: SharedGraphicInput) => void) | null = null;
  return {
    setSharedInputHandler(next: typeof handler) {
      handler = next;
    },
    applySharedInput: vi.fn(() => true),
    native(input: SharedGraphicInput) {
      handler?.(input);
    },
  };
}

const move = (x: number): SharedGraphicInput => ({
  type: 'pointer-move',
  position: { x, y: 0.5 },
});
const click: SharedGraphicInput = { type: 'click', target: { layerId: 'button' } };
const key: SharedGraphicInput = { type: 'key-down', key: 'ArrowLeft' };

describe('shared browser input', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces moves at 30 Hz and posts the latest position before discrete edges in order', async () => {
    vi.useFakeTimers();
    const graphic = inputGraphic();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const relay = createSharedInput({ url: './input', fetchImpl });
    relay.setSession({
      publicationId: 'set',
      syncVersion: 3,
      syncViewers: true,
      canSend: true,
      graphic,
    });

    graphic.native(move(0.1));
    graphic.native(move(0.2));
    await vi.advanceTimersByTimeAsync(30);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5);
    graphic.native(move(0.3));
    graphic.native(move(0.4));
    graphic.native(click);
    graphic.native(key);
    await vi.advanceTimersByTimeAsync(100);

    const sent = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(sent.map((entry) => entry.input)).toEqual([move(0.2), move(0.4), click, key]);
    expect(new Set(sent.map((entry) => entry.requestId)).size).toBe(4);
    expect(sent[0]).toMatchObject({ publicationId: 'set', syncVersion: 3 });
    relay.receive({ ...sent[3], sequence: 4 });
    expect(graphic.applySharedInput).not.toHaveBeenCalled();
    relay.dispose();
  });

  it('drops stale sequences and only applies input in the current synced session', () => {
    const graphic = inputGraphic();
    const onPointer = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    const relay = createSharedInput({ url: './input', onPointer, fetchImpl });
    const session = {
      publicationId: 'set',
      syncVersion: 3,
      syncViewers: true,
      canSend: false,
      graphic,
    };
    const entry: SharedInputEntry = {
      publicationId: 'set',
      syncVersion: 3,
      clientId: 'operator',
      sequence: 1,
      input: move(0.5),
    };
    relay.setSession(session);
    graphic.native(key);
    relay.receive(entry);
    relay.receive(entry);
    relay.receive({ ...entry, sequence: 2, syncVersion: 2 });
    relay.receive({ ...entry, sequence: 2, publicationId: 'old' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(graphic.applySharedInput).toHaveBeenCalledExactlyOnceWith(entry.input);
    expect(onPointer).toHaveBeenLastCalledWith({ x: 0.5, y: 0.5 });

    relay.setSession({ ...session, syncViewers: false, syncVersion: 4 });
    relay.receive({ ...entry, sequence: 2, syncVersion: 4 });
    expect(graphic.applySharedInput).toHaveBeenCalledTimes(1);
    expect(onPointer).toHaveBeenLastCalledWith(null);

    relay.setSession({ ...session, syncVersion: 5 });
    relay.receive({ ...entry, sequence: 3, syncVersion: 5, input: key });
    expect(graphic.applySharedInput).toHaveBeenLastCalledWith(key);
    relay.dispose();
  });

  it('cancels an in-flight send and clears queued input when the mode changes', async () => {
    vi.useFakeTimers();
    const graphic = inputGraphic();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const relay = createSharedInput({ url: './input', fetchImpl });
    const session = {
      publicationId: 'set',
      syncVersion: 3,
      syncViewers: true,
      canSend: true,
      graphic,
    };
    relay.setSession(session);
    graphic.native(click);
    graphic.native(key);
    graphic.native(move(0.2));
    const firstSignal = fetchImpl.mock.calls[0][1]?.signal;

    relay.setSession({ ...session, syncViewers: false, syncVersion: 4 });
    expect(firstSignal?.aborted).toBe(true);
    graphic.native(click);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    relay.setSession({ ...session, syncVersion: 5 });
    graphic.native(key);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1]?.body as string)).toMatchObject({
      syncVersion: 5,
      input: key,
    });
    relay.dispose();
  });
});
