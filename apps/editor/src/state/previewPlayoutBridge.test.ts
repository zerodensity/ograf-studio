import { beforeEach, describe, expect, it, vi } from 'vitest';

const preview = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
vi.mock('./behaviorPreviewStore', () => ({
  readBehaviorPreviewPlayout: preview.read,
  updateBehaviorPreviewSlot: preview.update,
}));
const { handlePreviewPlayoutRequest } = await import('./previewPlayoutBridge');

const read = () => handlePreviewPlayoutRequest({ action: 'read', target: 'preview' });
function fixture() {
  return {
    target: 'preview',
    sessionId: crypto.randomUUID(),
    loading: false,
    snapshot: {
      loaded: true,
      frame: 50,
      paused: false,
      slots: {
        headline: {
          current: { stateId: 'headline-on', data: { text: 'Keep me' } },
          incoming: null,
          transition: null,
        },
        ticker: {
          current: { stateId: 'ticker-on', data: { quotes: ['Old'] } },
          incoming: null,
          transition: null,
        },
      },
    },
    templates: [
      { id: 'ticker-template', fields: [{ key: 'quotes', type: 'array', label: 'Quotes' }] },
    ],
  };
}
let state = fixture();
beforeEach(() => {
  state = fixture();
  preview.read.mockReset().mockImplementation(() => structuredClone(state));
  preview.update.mockReset().mockResolvedValue(undefined);
});

async function request(data: Record<string, unknown> = { quotes: ['New'] }) {
  return {
    action: 'command',
    target: 'preview',
    expectedRevision: (await read()).revision,
    requestId: crypto.randomUUID(),
    operation: { type: 'update', slotId: 'ticker', stateId: 'ticker-on', data },
  };
}

describe('MCP visible preview data bridge', () => {
  it('reports target fields without invalidating revisions on ordinary animation frames', async () => {
    const before = await read();
    state.snapshot.frame += 50;
    const after = await read();
    expect(after.revision).toBe(before.revision);
    expect(after.templates).toEqual(state.templates);
    expect(after.target).toBe('preview');
  });

  it('updates only the requested lane and makes uncertain retries idempotent', async () => {
    let finish!: () => void;
    preview.update.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const input = await request();
    const first = await handlePreviewPlayoutRequest(input);
    expect(first.accepted).toBe(true);
    expect(first.request).toMatchObject({ status: 'running' });
    expect(preview.update).toHaveBeenCalledWith(
      'ticker',
      { quotes: ['New'] },
      'ticker-on',
      'transition',
    );
    expect(state.snapshot.slots.headline.current.data).toEqual({ text: 'Keep me' });
    await handlePreviewPlayoutRequest(input);
    expect(preview.update).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    expect((await handlePreviewPlayoutRequest(input)).request).toMatchObject({
      status: 'completed',
    });
    await expect(
      handlePreviewPlayoutRequest({
        ...input,
        operation: { ...input.operation, data: { quotes: ['Different'] } },
      }),
    ).rejects.toThrow('different preview update');
  });

  it('forwards an explicit in-place mode and keeps its idempotent receipt separate from transition mode', async () => {
    const base = await request();
    const input = { ...base, operation: { ...base.operation, mode: 'in-place' } };
    await handlePreviewPlayoutRequest(input);
    expect(preview.update).toHaveBeenCalledExactlyOnceWith(
      'ticker',
      { quotes: ['New'] },
      'ticker-on',
      'in-place',
    );
    await handlePreviewPlayoutRequest(input);
    expect(preview.update).toHaveBeenCalledTimes(1);
    await expect(
      handlePreviewPlayoutRequest({
        ...input,
        operation: { ...input.operation, mode: 'transition' },
      }),
    ).rejects.toThrow('different preview update');
  });

  it('rejects stale output and on-air state guards without dispatching', async () => {
    const input = await request();
    state.snapshot.slots.ticker.current.stateId = 'replacement';
    await expect(handlePreviewPlayoutRequest(input)).rejects.toThrow('revision changed');
    input.expectedRevision = (await read()).revision;
    await expect(handlePreviewPlayoutRequest(input)).rejects.toThrow('on-air state changed');
    expect(preview.update).not.toHaveBeenCalled();
  });

  it('cannot take an Off lane on air or dispatch live controls', async () => {
    delete (state.snapshot.slots as Record<string, unknown>).ticker;
    await expect(handlePreviewPlayoutRequest(await request())).rejects.toThrow('no on-air state');
    await expect(
      handlePreviewPlayoutRequest({
        ...(await request()),
        operation: { type: 'take', slotId: 'ticker', stateId: 'ticker-on' },
      }),
    ).rejects.toThrow('data updates only');
    await expect(handlePreviewPlayoutRequest({ action: 'read' })).rejects.toThrow(
      'explicitly target preview',
    );
    expect(preview.update).not.toHaveBeenCalled();
  });

  it('publishes update failures rather than reporting them as completed', async () => {
    preview.update.mockRejectedValue(new Error('Invalid ticker payload'));
    const input = await request();
    await handlePreviewPlayoutRequest(input);
    await Promise.resolve();
    expect((await handlePreviewPlayoutRequest(input)).request).toMatchObject({
      status: 'failed',
      error: 'Invalid ticker payload',
    });
  });
});
