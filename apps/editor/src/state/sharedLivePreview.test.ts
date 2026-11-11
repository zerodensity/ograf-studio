import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSharedLivePreview } from './sharedLivePreview';

const { mountGraphic } = vi.hoisted(() => ({ mountGraphic: vi.fn() }));
vi.mock('../../../../packages/ograf-web-player/ograf-player.js', () => ({
  mountOGrafGraphic: mountGraphic,
  dataFromSchemaDefaults: () => ({}),
}));

class TestEventSource {
  static OPEN = 1;
  static CLOSED = 2;
  readyState = TestEventSource.OPEN;
  private listeners = new Map<string, (event: { data: string }) => void>();

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.readyState = TestEventSource.CLOSED;
  }
  emit(type: string, payload: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) });
  }
}

const seed = { revision: 1, command: { kind: 'play' } };
const snapshot = (publicationId: string) => ({
  publicationId,
  manifestUrl: `/api/shared-playout/packages/${publicationId}/graphic.ograf.json`,
  revision: 1,
  commands: [seed],
  syncViewers: true,
  syncVersion: 0,
});

function renderer() {
  return {
    element: {},
    manifest: { name: 'Signal Blue' },
    play: vi.fn().mockResolvedValue({ statusCode: 200, currentStep: 0 }),
    stop: vi.fn().mockResolvedValue({ statusCode: 200 }),
    update: vi.fn(),
    action: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe('shared native preview', () => {
  let source: TestEventSource;
  let fetchStub: ReturnType<typeof vi.fn>;
  let controller: ReturnType<typeof createSharedLivePreview>;
  const onState = vi.fn<Parameters<typeof createSharedLivePreview>[1]>();

  beforeEach(() => {
    mountGraphic.mockReset();
    source = new TestEventSource();
    fetchStub = vi.fn();
    onState.mockClear();
    vi.stubGlobal('fetch', fetchStub);
    vi.stubGlobal(
      'EventSource',
      Object.assign(
        function () {
          return source;
        },
        { OPEN: TestEventSource.OPEN, CLOSED: TestEventSource.CLOSED },
      ),
    );
    controller = createSharedLivePreview({} as HTMLElement, onState, () => false);
  });

  afterEach(() => {
    controller.dispose();
    vi.unstubAllGlobals();
  });

  it('waits for the accepted native command and applies its journal entry only once', async () => {
    const player = renderer();
    const result = { statusCode: 200, currentStep: 4 };
    player.play
      .mockResolvedValueOnce({ statusCode: 200, currentStep: 0 })
      .mockResolvedValueOnce(result);
    mountGraphic.mockResolvedValue(player);
    type Receipt = { ok: boolean; json(): unknown };
    let resolveReceipt!: (value: Receipt) => void;
    const receipt = new Promise<Receipt>((resolve) => {
      resolveReceipt = resolve;
    });
    fetchStub.mockReturnValue(receipt);
    source.emit('snapshot', snapshot('published'));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true })),
    );

    const sent = controller.send({ kind: 'play', goto: 4 });
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchStub.mock.calls[0]![1].body)).toMatchObject({
      publicationId: 'published',
      expectedRevision: 1,
      command: { kind: 'play', goto: 4 },
    });
    const entry = { publicationId: 'published', revision: 2, command: { kind: 'play', goto: 4 } };
    source.emit('command', entry);
    source.emit('command', entry);
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ currentStep: 4 })),
    );
    resolveReceipt({ ok: true, json: () => ({ revision: 2 }) });
    await expect(sent).resolves.toEqual(result);
    expect(player.play.mock.calls).toEqual([[{ delta: 1, skipAnimation: true }], [{ goto: 4 }]]);
  });

  it('rejects an in-flight native command when the publication changes', async () => {
    const oldPlayer = renderer();
    const newPlayer = renderer();
    mountGraphic.mockResolvedValueOnce(oldPlayer).mockResolvedValueOnce(newPlayer);
    fetchStub.mockResolvedValue({ ok: true, json: () => ({ revision: 2 }) });
    source.emit('snapshot', snapshot('old'));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true })),
    );

    const rejected = expect(controller.send({ kind: 'stop' })).rejects.toThrow(
      'The shared publication changed.',
    );
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
    source.emit('snapshot', snapshot('replacement'));
    source.emit('command', { publicationId: 'old', revision: 2, command: { kind: 'stop' } });
    await rejected;
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({ publicationId: 'replacement', ready: true }),
      ),
    );
    expect(oldPlayer.dispose).toHaveBeenCalledOnce();
    expect(oldPlayer.stop).not.toHaveBeenCalled();
    expect(newPlayer.stop).not.toHaveBeenCalled();
  });

  it('changes viewer sync without remounting or adding a playback command', async () => {
    const player = renderer();
    mountGraphic.mockResolvedValue(player);
    source.emit('snapshot', snapshot('published'));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({ ready: true, syncViewers: true }),
      ),
    );
    fetchStub.mockResolvedValue({ ok: true, json: () => ({ syncViewers: false, syncVersion: 1 }) });
    await controller.setSyncViewers(false);
    expect(fetchStub).toHaveBeenCalledWith(
      '/api/shared-playout/mode',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ syncViewers: false }),
      }),
    );
    source.emit('snapshot', snapshot('published'));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({ syncViewers: false, syncPending: false }),
      ),
    );
    expect(mountGraphic).toHaveBeenCalledOnce();
    expect(player.play).toHaveBeenCalledOnce();
  });

  it('applies the saved feed after command replay and follows later feed events once', async () => {
    const player = renderer();
    mountGraphic.mockResolvedValue(player);
    const feed = (sequence: number, source: string) => ({
      publicationId: 'published',
      sequence,
      target: { kind: 'graphic' },
      data: { source },
    });
    source.emit('snapshot', { ...snapshot('published'), feeds: [feed(3, 'Latest on reconnect')] });
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ready: true,
          data: { source: 'Latest on reconnect' },
        }),
      ),
    );
    source.emit('feed', feed(4, 'Live update'));
    source.emit('feed', feed(4, 'Duplicate'));
    source.emit('feed', feed(2, 'Stale'));
    await vi.waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: { source: 'Live update' },
        }),
      ),
    );
    expect(player.update.mock.calls).toEqual([
      [{ source: 'Latest on reconnect' }, { skipAnimation: true }],
      [{ source: 'Live update' }, {}],
    ]);
    expect(player.play.mock.invocationCallOrder[0]).toBeLessThan(
      player.update.mock.invocationCallOrder[0]!,
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
