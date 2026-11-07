import { describe, expect, it, vi } from 'vitest';
import type { CoordinatedPreviewRuntime } from './coordinatedPreviewRuntime';
import { runCoordinatedPreviewCommand } from './coordinatedPreviewCommands';

function fixture() {
  const customAction = vi.fn().mockResolvedValue({ statusCode: 200 });
  const snapshot = {
    frame: 250,
    slots: {
      ticker: {
        current: {
          stateId: 'quotes',
          instanceId: 'instance-quotes',
          requestId: 'take-original',
          data: { price: 10, volume: 20 },
        },
        incoming: null,
        transition: null,
      },
    },
  };
  return {
    customAction,
    snapshot,
    runtime: {
      graphic: { customAction, getPlayoutSnapshot: () => snapshot },
    } as unknown as CoordinatedPreviewRuntime,
  };
}

describe('coordinated operator command dispatch', () => {
  it('patches native feed values without resending unrelated data or taking the lane again', async () => {
    const f = fixture();
    await runCoordinatedPreviewCommand(f.runtime, {
      type: 'update',
      mode: 'in-place',
      slotId: 'ticker',
      stateId: 'quotes',
      data: { price: 11 },
    });
    expect(f.customAction).toHaveBeenCalledExactlyOnceWith({
      id: 'transition.patch',
      payload: { slotId: 'ticker', stateId: 'quotes', data: { price: 11 } },
    });
  });

  it.each([undefined, 'transition'] as const)(
    'keeps authored same-state transitions for update mode %s',
    async (mode) => {
      const f = fixture();
      await runCoordinatedPreviewCommand(f.runtime, {
        type: 'update',
        ...(mode ? { mode } : {}),
        slotId: 'ticker',
        data: { price: 11 },
      });
      expect(f.customAction).toHaveBeenCalledExactlyOnceWith({
        id: 'transition.take',
        payload: { slotId: 'ticker', stateId: 'quotes', data: { price: 11, volume: 20 } },
      });
    },
  );

  it('delivers independent concurrent sources as patches so the later completion cannot restore stale values', async () => {
    const f = fixture();
    let release!: () => void;
    const priceGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.customAction.mockImplementation(
      async (action: { id: string; payload: { data: Record<string, number> } }) => {
        expect(action.id).toBe('transition.patch');
        if ('price' in action.payload.data) await priceGate;
        Object.assign(f.snapshot.slots.ticker.current.data, action.payload.data);
        return { statusCode: 200 };
      },
    );
    const price = runCoordinatedPreviewCommand(f.runtime, {
      type: 'update',
      mode: 'in-place',
      slotId: 'ticker',
      data: { price: 11 },
    });
    const volume = runCoordinatedPreviewCommand(f.runtime, {
      type: 'update',
      mode: 'in-place',
      slotId: 'ticker',
      data: { volume: 30 },
    });
    await volume;
    release();
    await price;
    expect(f.snapshot.slots.ticker.current).toEqual({
      stateId: 'quotes',
      instanceId: 'instance-quotes',
      requestId: 'take-original',
      data: { price: 11, volume: 30 },
    });
    expect(f.customAction).toHaveBeenCalledTimes(2);
    expect(f.snapshot.frame).toBe(250);
  });

  it('refuses an in-place patch after its state guard changes', async () => {
    const f = fixture();
    await expect(
      runCoordinatedPreviewCommand(f.runtime, {
        type: 'update',
        mode: 'in-place',
        slotId: 'ticker',
        stateId: 'replaced',
        data: { price: 11 },
      }),
    ).rejects.toThrow('on-air state changed');
    expect(f.customAction).not.toHaveBeenCalled();
  });
  it('routes the MCP and preview template action to exactly the named lane', async () => {
    const f = fixture();
    await runCoordinatedPreviewCommand(f.runtime, {
      type: 'template-action',
      slotId: 'main',
      actionId: 'show-ad',
      data: { mode: 'advertising' },
    });
    expect(f.customAction).toHaveBeenCalledExactlyOnceWith({
      id: 'template.action',
      payload: { slotId: 'main', actionId: 'show-ad', data: { mode: 'advertising' } },
    });
  });
  it('omits optional data to retain the runtime lane data', async () => {
    const f = fixture();
    await runCoordinatedPreviewCommand(f.runtime, {
      type: 'template-action',
      slotId: 'main',
      actionId: 'return-to-program',
    });
    expect(f.customAction).toHaveBeenCalledExactlyOnceWith({
      id: 'template.action',
      payload: { slotId: 'main', actionId: 'return-to-program' },
    });
  });
  it('surfaces an inactive-lane rejection without issuing an additional Take', async () => {
    const f = fixture();
    f.customAction.mockResolvedValue({
      statusCode: 409,
      statusMessage: 'Take the template first.',
    });
    await expect(
      runCoordinatedPreviewCommand(f.runtime, {
        type: 'template-action',
        slotId: 'main',
        actionId: 'show-ad',
      }),
    ).rejects.toThrow('Take the template first.');
    expect(f.customAction).toHaveBeenCalledTimes(1);
  });
});
