import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import type { TickerUpdateStatus } from '@ograf-editor/ograf-runtime';
import type { CoordinatedPreviewRuntime } from './coordinatedPreviewRuntime';
import { createProjectSet } from './projectSet';
import { createDefaultTransitionLogic } from './transitionLogicEditing';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';

const runtimeMocks = vi.hoisted(() => ({ create: vi.fn(), command: vi.fn() }));
vi.mock('./coordinatedPreviewRuntime', () => ({
  createCoordinatedPreviewRuntime: runtimeMocks.create,
  runCoordinatedPreviewCommand: runtimeMocks.command,
}));
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});

const playout = await import('./livePlayoutStore');

afterEach(async () => {
  await playout.unloadLivePlayout();
  useProjectSetStore.getState().clearProjectSet();
  vi.clearAllMocks();
});

describe('MCP live ticker update status', () => {
  it('reports an empty queue when no live runtime is loaded', async () => {
    const result = await playout.handleLivePlayoutRequest({ action: 'read' });
    expect(result.tickerUpdates).toEqual([]);
  });

  it('reads the actual pending queue without changing revision, timing or playout', async () => {
    const project = createProject({ name: 'Ticker status fixture' });
    const set = createProjectSet('Ticker status set', project);
    set.transitionLogic = createDefaultTransitionLogic(set);
    useProjectSetStore.setState({ projectSet: set, activeTemplateId: set.templates[0]!.id });
    useProjectStore.getState().loadProject(project);
    let updates: TickerUpdateStatus[] = [
      {
        id: 'ticker-instance-1',
        layerId: 'ticker-news',
        name: 'News ticker',
        pendingCount: 3,
        updatedCount: 1,
        addedCount: 1,
        removedCount: 1,
        preparingCount: 0,
        policy: 'next-appearance',
      },
    ];
    const getTickerUpdates = vi.fn(() => updates);
    const graphic = {
      getPlayoutSnapshot: vi.fn(() => ({ loaded: true, frame: 300, slots: {} })),
      getTickerUpdates,
      subscribePlayout: vi.fn(() => () => {}),
    };
    runtimeMocks.create.mockResolvedValue({
      graphic,
      descriptor: { width: 1920, height: 1080 },
      definition: set.transitionLogic,
      templates: [],
      attach: vi.fn(),
      park: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as unknown as CoordinatedPreviewRuntime);
    await playout.loadLivePlayout();
    const revision = playout.useLivePlayoutStore.getState().revision;
    const first = await playout.handleLivePlayoutRequest({ action: 'read' });
    expect(first.tickerUpdates).toEqual(updates);
    expect(first.tickerUpdates).not.toBe(updates);
    updates = [];
    const next = await playout.handleLivePlayoutRequest({ action: 'read' });
    expect(next.tickerUpdates).toEqual([]);
    expect(next.revision).toBe(revision);
    expect((next.snapshot as { frame: number }).frame).toBe(300);
    expect(getTickerUpdates).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.command).not.toHaveBeenCalled();
  });
});
