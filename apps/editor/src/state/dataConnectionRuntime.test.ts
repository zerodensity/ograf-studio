import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFieldDefinition,
  createProject,
  type DataConnectionDefinition,
} from '@ograf-editor/scene-model';
import type { CoordinatedPlayoutSnapshot } from '@ograf-editor/ograf-types';
import type { ProjectSetDocument } from './projectSet';

const mocks = vi.hoisted(() => ({
  source: null as { sessionId: string; source: ProjectSetDocument } | null,
  read: vi.fn(),
  dispose: vi.fn(),
  factory: vi.fn(),
  update: vi.fn(),
  sourceRead: vi.fn(),
}));
vi.mock('../data/publicMarkets', () => ({
  createPublicMarketsProvider: (...args: unknown[]) => {
    mocks.factory(...args);
    return { fetchSnapshot: mocks.read, dispose: mocks.dispose };
  },
}));
vi.mock('./behaviorPreviewStore', async () => {
  const { create } = await import('zustand');
  return {
    behaviorPreviewDataSource: () => {
      mocks.sourceRead();
      return mocks.source;
    },
    updateBehaviorPreviewSlot: mocks.update,
    useBehaviorPreviewStore: create(() => ({ requestId: null, loading: false, snapshot: null })),
  };
});
const { initializeDataConnectionRuntime, useDataConnectionRuntimeStore, connectionRuntimeKey } =
  await import('./dataConnectionRuntime');
const { useBehaviorPreviewStore } = await import('./behaviorPreviewStore');
const { useProjectStore } = await import('./projectStore');
const { useProjectSetStore } = await import('./projectSetStore');
const { useTestDataStore } = await import('./testDataStore');
const { createProjectSet } = await import('./projectSet');
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
let stop: (() => void) | undefined;

function fixture() {
  const projects = [0, 1].map((index) => {
    const project = createProject({ name: `Markets ${index}` });
    const composition = project.compositions[0]!;
    composition.dataFields = [
      createFieldDefinition('number', { id: `price-${index}`, key: 'price', defaultValue: 10 }),
    ];
    const connection: DataConnectionDefinition = {
      id: `feed-${index}`,
      name: 'Markets',
      source: 'public-markets',
      format: 'json',
      url: '',
      embeddedText: '',
      refreshMs: 1000,
      missing: 'keep-last',
      enabled: true,
      target: 'both',
      mappings: [{ fieldId: `price-${index}`, sourcePath: 'price' }],
    };
    composition.dataConnections = [connection];
    return project;
  });
  const set = createProjectSet('Markets', projects[0]!);
  set.templates.push({
    id: 'second-template',
    name: 'Second ticker',
    project: projects[1]!,
    inheritSettings: true,
  });
  useProjectStore.getState().loadProject(projects[0]!);
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: set.templates[0]!.id });
  mocks.source = { sessionId: 'visible-preview', source: structuredClone(set) };
  const snapshot: CoordinatedPlayoutSnapshot = {
    loaded: true,
    definitionId: 'markets',
    definitionRevision: '1',
    frame: 10,
    frameRate: 50,
    renderType: 'realtime',
    paused: false,
    recordingTruncated: false,
    clockEpochMs: null,
    error: null,
    prepared: {},
    slots: Object.fromEntries(
      set.templates.map((template, i) => {
        const current = {
          stateId: `state-${i}`,
          templateId: template.id,
          instanceId: `on-air-${i}`,
          requestId: `take-${i}`,
          data: { price: 10 },
        };
        return [
          `lane-${i}`,
          {
            slotId: `lane-${i}`,
            name: template.name,
            current,
            desired: current,
            incoming: current,
            outgoing: null,
            pending: null,
            transition: null,
            readiness: 'ready',
            error: null,
          },
        ];
      }),
    ),
  };
  useBehaviorPreviewStore.setState({ requestId: 'visible-preview', loading: false, snapshot });
  return { projects, set, snapshot };
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.read.mockReset().mockResolvedValue({ price: 100 });
  mocks.dispose.mockReset();
  mocks.factory.mockReset();
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.sourceRead.mockReset();
  mocks.source = null;
  useTestDataStore.getState().resetAll();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  mocks.source = null;
  useProjectSetStore.setState({ projectSet: null, activeTemplateId: null });
  useBehaviorPreviewStore.setState({ requestId: null, snapshot: null });
  vi.useRealTimers();
});

describe('native connection routing to Studio', () => {
  it('preserves fields from two concurrent connection patches targeting one lane', async () => {
    const { projects, set, snapshot } = fixture();
    const next = structuredClone(projects[0]!);
    const comp = next.compositions[0]!;
    comp.dataFields.push(
      createFieldDefinition('number', { id: 'volume-field', key: 'volume', defaultValue: 1 }),
    );
    comp.dataConnections.push({
      ...comp.dataConnections[0]!,
      id: 'volume-feed',
      mappings: [{ fieldId: 'volume-field', sourcePath: 'volume' }],
    });
    const nextSet = structuredClone(set);
    nextSet.templates[0]!.project = next;
    useProjectStore.getState().loadProject(next);
    useProjectSetStore.setState({ projectSet: nextSet });
    mocks.source = { sessionId: 'visible-preview', source: structuredClone(nextSet) };
    snapshot.slots['lane-0']!.current!.data.volume = 1;
    useBehaviorPreviewStore.setState({ snapshot });
    mocks.read.mockResolvedValue({ price: 100, volume: 200 });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.update.mockImplementation(async (slotId: string, patch: Record<string, unknown>) => {
      const before = useBehaviorPreviewStore.getState().snapshot!.slots[slotId]!.current!.data;
      const merged = { ...before, ...patch };
      if (slotId === 'lane-0' && 'price' in patch) await gate;
      const latest = structuredClone(useBehaviorPreviewStore.getState().snapshot!);
      latest.slots[slotId]!.current!.data = merged;
      useBehaviorPreviewStore.setState({ snapshot: latest });
    });
    stop = initializeDataConnectionRuntime();
    await flush();
    expect(mocks.update.mock.calls.filter(([slot]) => slot === 'lane-0')).toHaveLength(1);
    finish();
    await flush();
    expect(useBehaviorPreviewStore.getState().snapshot!.slots['lane-0']!.current!.data).toEqual({
      price: 100,
      volume: 200,
    });
    expect(mocks.update.mock.calls.filter(([slot]) => slot === 'lane-0')).toHaveLength(2);
    expect(mocks.update.mock.calls.every(([, , , mode]) => mode === 'in-place')).toBe(true);
    expect(useBehaviorPreviewStore.getState().requestId).toBe('visible-preview');
    expect(useBehaviorPreviewStore.getState().snapshot!.slots['lane-0']!.current).toMatchObject({
      instanceId: 'on-air-0',
      requestId: 'take-0',
      stateId: 'state-0',
    });
  });
  it('does not rebuild source mappings during ordinary animation frames or same-state data acknowledgements', async () => {
    const { snapshot } = fixture();
    stop = initializeDataConnectionRuntime();
    await flush();
    mocks.sourceRead.mockClear();
    for (let frame = 11; frame < 30; frame++) {
      const next = structuredClone(snapshot);
      next.frame = frame;
      next.slots['lane-0']!.current!.data.price = frame;
      useBehaviorPreviewStore.setState({ snapshot: next });
      await flush();
    }
    expect(mocks.sourceRead).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it('allows a preview-only connection to refresh before combined output is opened', async () => {
    const { projects } = fixture();
    mocks.source = null;
    useBehaviorPreviewStore.setState({ requestId: null, snapshot: null });
    const connection = projects[0]!.compositions[0]!.dataConnections[0]!;
    useProjectStore
      .getState()
      .updateDataConnection(connection.id, { target: 'coordinated-preview' });
    stop = initializeDataConnectionRuntime();
    await flush();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(useTestDataStore.getState().values['price-0']).toBeUndefined();
  });
  it('updates the active canvas and both independent on-air lanes from one poll without changing source', async () => {
    const { projects } = fixture();
    const before = structuredClone(useProjectStore.getState().project);
    stop = initializeDataConnectionRuntime();
    await flush();
    expect(mocks.factory).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(useTestDataStore.getState().values['price-0']).toBe(100);
    expect(mocks.update).toHaveBeenCalledWith('lane-0', { price: 100 }, 'state-0', 'in-place');
    expect(mocks.update).toHaveBeenCalledWith('lane-1', { price: 100 }, 'state-1', 'in-place');
    expect(useProjectStore.getState().project).toEqual(before);
    const comp = projects[0]!.compositions[0]!;
    expect(
      useDataConnectionRuntimeStore.getState().statuses[
        connectionRuntimeKey(projects[0]!.id, comp.id, 'feed-0')
      ]?.phase,
    ).toBe('live');
  });
  it('holds preview updates while paused then applies latest values without taking or resuming anything', async () => {
    const { snapshot } = fixture();
    useBehaviorPreviewStore.setState({ snapshot: { ...snapshot, paused: true } });
    stop = initializeDataConnectionRuntime();
    await flush();
    expect(mocks.update).not.toHaveBeenCalled();
    useBehaviorPreviewStore.setState({ snapshot: { ...snapshot, paused: false } });
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it('defers a transitioning lane while continuing unrelated lanes, then flushes its latest data', async () => {
    const { snapshot } = fixture();
    const entering = structuredClone(snapshot);
    entering.slots['lane-0']!.transition = {
      id: 'entering',
      requestId: 'take-0',
      transitionId: 'in',
      startFrame: 0,
      endFrame: 50,
      progress: 0.2,
    };
    useBehaviorPreviewStore.setState({ snapshot: entering });
    stop = initializeDataConnectionRuntime();
    await flush();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      'lane-1',
      { price: 100 },
      'state-1',
      'in-place',
    );
    useBehaviorPreviewStore.setState({ snapshot });
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith('lane-0', { price: 100 }, 'state-0', 'in-place');
  });
  it('releases sources and prevents old preview updates after opening a different document', async () => {
    fixture();
    stop = initializeDataConnectionRuntime();
    await flush();
    mocks.update.mockClear();
    useProjectSetStore.setState({ projectSet: null, activeTemplateId: null });
    useProjectStore.getState().loadProject(createProject({ name: 'New document' }));
    await flush();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it('reports degraded provider snapshots while still delivering their last-good values and clears on recovery', async () => {
    const { projects, snapshot } = fixture();
    mocks.read.mockResolvedValueOnce({
      price: 90,
      status: 'DEGRADED',
      errors: { crypto: { message: 'HTTP 429' } },
    });
    stop = initializeDataConnectionRuntime();
    await flush();
    const comp = projects[0]!.compositions[0]!;
    const key = connectionRuntimeKey(projects[0]!.id, comp.id, 'feed-0');
    expect(mocks.update).toHaveBeenCalledWith('lane-0', { price: 90 }, 'state-0', 'in-place');
    expect(useDataConnectionRuntimeStore.getState().statuses[key]).toMatchObject({
      phase: 'error',
      message: expect.stringContaining('HTTP 429'),
    });
    useBehaviorPreviewStore.setState({ snapshot: { ...snapshot, frame: 20 } });
    await flush();
    expect(useDataConnectionRuntimeStore.getState().statuses[key]?.phase).toBe('error');
    await vi.advanceTimersByTimeAsync(1000);
    expect(useDataConnectionRuntimeStore.getState().statuses[key]?.phase).toBe('live');
  });
});
