import { describe, expect, it, vi } from 'vitest';
import { createDataConnectionUpdateQueue } from './dataConnectionUpdateQueue';
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

describe('native feed lane update queue', () => {
  it('leaves data pending when the shared publication no longer accepts it', async () => {
    const queue = createDataConnectionUpdateQueue();
    await expect(
      queue.enqueue({
        slotId: 'markets',
        identity: 'old-publication',
        data: { price: 20 },
        valid: () => true,
        update: async () => false,
      }),
    ).resolves.toBe(false);
    queue.dispose();
  });

  it('merges later source patches after the preceding coordinator update commits', async () => {
    const queue = createDataConnectionUpdateQueue();
    let data = { price: 10, volume: 1, label: 'Old' };
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const update = vi.fn(async (patch) => {
      const merged = { ...data, ...patch };
      if ('price' in patch) await gate;
      data = merged;
    });
    const base = {
      slotId: 'markets',
      identity: 'session:state:instance',
      valid: () => true,
      update,
    };
    const price = queue.enqueue({ ...base, data: { price: 100 } });
    const volume = queue.enqueue({ ...base, data: { volume: 200 } });
    const label = queue.enqueue({ ...base, data: { label: 'Fresh' } });
    expect(update).toHaveBeenCalledTimes(1);
    finish();
    expect(await Promise.all([price, volume, label])).toEqual([true, true, true]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({ volume: 200, label: 'Fresh' });
    expect(data).toEqual({ price: 100, volume: 200, label: 'Fresh' });
    queue.dispose();
  });
  it('keeps other lanes independent and discards work invalidated by pause, disable or replacement', async () => {
    const queue = createDataConnectionUpdateQueue();
    let finish!: () => void;
    let valid = true;
    const update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = queue.enqueue({
      slotId: 'main',
      identity: 'old',
      data: { a: 1 },
      valid: () => true,
      update,
    });
    const pendingUpdate = vi.fn(async () => {});
    const pending = queue.enqueue({
      slotId: 'main',
      identity: 'old',
      data: { b: 2 },
      valid: () => valid,
      update: pendingUpdate,
    });
    const other = vi.fn(async () => {});
    expect(
      await queue.enqueue({
        slotId: 'ticker',
        identity: 'ticker',
        data: { c: 3 },
        valid: () => true,
        update: other,
      }),
    ).toBe(true);
    valid = false;
    finish();
    expect(await first).toBe(true);
    expect(await pending).toBe(false);
    expect(pendingUpdate).not.toHaveBeenCalled();
    queue.dispose();
  });
  it('releases queued updates when the runtime is destroyed', async () => {
    const queue = createDataConnectionUpdateQueue();
    let finish!: () => void;
    const active = queue.enqueue({
      slotId: 'main',
      identity: 'one',
      data: { a: 1 },
      valid: () => true,
      update: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const update = vi.fn(async () => {});
    const pending = queue.enqueue({
      slotId: 'main',
      identity: 'one',
      data: { b: 2 },
      valid: () => true,
      update,
    });
    queue.dispose();
    expect(await pending).toBe(false);
    finish();
    await active;
    await flush();
    expect(update).not.toHaveBeenCalled();
  });
});
