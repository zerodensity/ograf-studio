import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAsset,
  createFieldDefinition,
  createProject,
  type Project,
} from '@ograf-editor/scene-model';
import {
  addProjectSetTemplate,
  createProjectSet,
  setProjectSetAssetSlotSource,
  setProjectSetControlValue,
  type ProjectSetDocument,
} from './projectSet';

const mocks = vi.hoisted(() => {
  function store<T>(initial: T) {
    let state = initial;
    const subscribers = new Set<(state: T, previous: T) => void>();
    return {
      getState: () => state,
      setState: (patch: Partial<T>) => {
        const previous = state;
        state = { ...state, ...patch };
        subscribers.forEach((subscriber) => subscriber(state, previous));
      },
      subscribe: (callback: (state: T, previous: T) => void) => {
        subscribers.add(callback);
        return () => {
          subscribers.delete(callback);
        };
      },
      reset: (value: T) => {
        state = value;
        subscribers.clear();
      },
    };
  }
  return {
    project: store({ project: null as unknown as Project }),
    set: store({
      projectSet: null as ProjectSetDocument | null,
      activeTemplateId: null as string | null,
    }),
    bridge: store({ connected: true }),
    build: vi.fn(),
    send: vi.fn(),
    types: vi.fn(),
  };
});
vi.mock('./projectStore', () => ({ useProjectStore: mocks.project }));
vi.mock('./projectSetStore', () => ({ useProjectSetStore: mocks.set }));
vi.mock('./agentBridge', () => ({
  sendNodosPreset: mocks.send,
  useAgentBridgeStatus: mocks.bridge,
  requestNodosTypes: mocks.types,
}));
vi.mock('./exportPackage', () => ({ buildNodosPreset: mocks.build }));

let storage: Map<string, string>;
const STORAGE_KEY = 'ograf-studio:nodos:v1';
type Sync = typeof import('./nodosSync');
function built() {
  return {
    preset: { name: 'candidate' },
    files: [{ path: 'main.js', base64: 'eA==' }],
    compatibility: { valid: true },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let index = 0; index < 15; index++) await Promise.resolve();
}
async function setupSet() {
  const first = createProject({ name: 'Same name' });
  const second = createProject({ name: 'Same_name' });
  second.compositions[0]!.dataFields.push(
    createFieldDefinition('text', { id: 'child-title', key: 'title', defaultValue: 'fallback' }),
  );
  second.compositions[0]!.assets.push(
    createAsset({
      id: 'child-logo',
      name: 'Child logo',
      kind: 'image',
      dataUri: 'data:image/png;base64,AQID',
      mimeType: 'image/png',
      byteSize: 3,
    }),
  );
  let set = createProjectSet('Broadcast', first);
  set = addProjectSetTemplate(set, second);
  mocks.project.setState({ project: first });
  mocks.set.setState({ projectSet: set, activeTemplateId: set.templates[0]!.id });
  const sync = await import('./nodosSync');
  await flush();
  return { sync, set, first, second };
}
function choose(sync: Sync, index = 0) {
  const template = sync.openTemplates()[index]!;
  sync.chooseNodosTemplate(template, true);
  return template;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  mocks.project.reset({ project: createProject({ name: 'Single' }) });
  mocks.set.reset({ projectSet: null, activeTemplateId: null });
  mocks.bridge.reset({ connected: true });
  mocks.build.mockReset().mockResolvedValue(built());
  mocks.send.mockReset().mockResolvedValue({ ok: true, message: 'ok' });
  mocks.types.mockReset().mockResolvedValue({ ok: true, objects: [], enums: [] });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Nodos template synchronization', () => {
  it('uses the current Nodos Editor API port when no address is saved', async () => {
    const sync = await import('./nodosSync');
    expect(sync.useNodos.getState().address).toBe('localhost:11003');
  });

  it.each(['localhost:50052', '192.168.1.20:50052'])(
    'preserves an existing Nodos address (%s)',
    async (address) => {
      storage.set(STORAGE_KEY, JSON.stringify({ address }));
      const sync = await import('./nodosSync');
      expect(sync.useNodos.getState().address).toBe(address);
    },
  );

  it('repairs oversized persisted assignments without losing selection or valid legacy classes', async () => {
    const project = mocks.project.getState().project;
    const oversized = `ograf.template_${project.id
      .split('')
      .map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
      .join('')}`;
    expect(oversized.length).toBeGreaterThan(128);
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        presets: { [project.id]: oversized, valid: 'ograf.Valid_old_class' },
        assignedPresets: { [project.id]: oversized, valid: 'ograf.Valid_old_class' },
      }),
    );
    const sync = await import('./nodosSync');
    await flush();
    const preferences = sync.useNodos.getState();
    expect(preferences.presets[project.id]).toHaveLength(79);
    expect(preferences.assignedPresets[project.id]).toBe(preferences.presets[project.id]);
    expect(preferences.presets.valid).toBe('ograf.Valid_old_class');
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]![0].preset.name).toBe(preferences.presets[project.id]);
    sync.chooseNodosTemplate(sync.openTemplates()[0]!, false);
    expect(JSON.parse(storage.get(STORAGE_KEY)!).assignedPresets[project.id]).toHaveLength(79);
  });
  it('assigns distinct stable classes to colliding names and retains them through rename and re-selection', async () => {
    const { sync, set } = await setupSet();
    const first = choose(sync),
      second = choose(sync, 1);
    const names = { ...sync.useNodos.getState().presets };
    expect(names[first.id]).not.toBe(names[second.id]);
    sync.updateNodosPreferences({ enabled: true });
    await flush();
    sync.chooseNodosTemplate(first, false);
    mocks.set.setState({
      projectSet: {
        ...set,
        templates: set.templates.map((template, index) =>
          index ? template : { ...template, name: 'Renamed' },
        ),
      },
    });
    sync.chooseNodosTemplate(sync.openTemplates()[0]!, true);
    await flush();
    expect(sync.useNodos.getState().presets).toEqual(names);
    expect(mocks.send.mock.calls.at(-1)![0].preset.name).toBe(names[first.id]);
    expect(mocks.build.mock.calls.at(-1)![2].displayName).toBe('Renamed');
  });

  it('loads legacy selections without renaming unique classes and safely separates duplicate legacy slugs', async () => {
    const project = mocks.project.getState().project;
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        presets: { [project.id]: 'ograf.Legacy', another: 'ograf.Legacy', unique: 'ograf.Keep' },
      }),
    );
    const sync = await import('./nodosSync');
    await flush();
    const preferences = sync.useNodos.getState();
    expect(preferences.presets[project.id]).toBe('ograf.Legacy');
    expect(preferences.presets.unique).toBe('ograf.Keep');
    expect(new Set(Object.values(preferences.presets)).size).toBe(3);
    expect(mocks.send).toHaveBeenCalledOnce();
    sync.chooseNodosTemplate(sync.openTemplates()[0]!, false);
    expect(JSON.parse(storage.get(STORAGE_KEY)!).assignedPresets[project.id]).toBe('ograf.Legacy');
    vi.resetModules();
    mocks.project.reset({ project: { ...project, name: 'New label' } });
    mocks.set.reset({ projectSet: null, activeTemplateId: null });
    mocks.bridge.reset({ connected: true });
    const restored = await import('./nodosSync');
    await flush();
    restored.chooseNodosTemplate(restored.openTemplates()[0]!, true);
    await flush();
    expect(restored.useNodos.getState().presets[project.id]).toBe('ograf.Legacy');
  });

  it('sends resolved inactive templates when shared controls or asset slots change', async () => {
    const { sync, set } = await setupSet();
    const inactive = set.templates[1]!;
    const composition = inactive.project.compositions[0]!;
    const asset1 = createAsset({
      id: 'shared-one',
      name: 'One',
      kind: 'image',
      dataUri: 'data:image/png;base64,AQID',
      mimeType: 'image/png',
      byteSize: 3,
    });
    const asset2 = createAsset({
      ...asset1,
      id: 'shared-two',
      dataUri: 'data:image/png;base64,BAUG',
    });
    const shared = {
      ...set,
      controls: [
        {
          field: createFieldDefinition('text', { id: 'shared-title', key: 'title' }),
          value: 'First',
          bindings: [
            {
              templateId: inactive.id,
              compositionId: composition.id,
              fieldId: 'child-title',
              inherit: true,
            },
          ],
        },
      ],
      assets: [asset1, asset2],
      assetSlots: [
        {
          id: 'logo-slot',
          key: 'logo',
          label: 'Logo',
          kind: 'image' as const,
          required: false,
          assetId: asset1.id,
          bindings: [
            {
              id: 'logo-binding',
              templateId: inactive.id,
              compositionId: composition.id,
              templateAssetId: 'child-logo',
              inherit: true,
            },
          ],
        },
      ],
    };
    mocks.set.setState({ projectSet: shared });
    choose(sync, 1);
    sync.updateNodosPreferences({ enabled: true });
    await flush();
    expect(mocks.build.mock.calls.at(-1)![0].compositions[0].dataFields[0].defaultValue).toBe(
      'First',
    );
    const next = setProjectSetAssetSlotSource(
      setProjectSetControlValue(shared, 'shared-title', 'Second'),
      'logo-slot',
      asset2.id,
    );
    expect(next.templates[1]!.project).toBe(inactive.project);
    mocks.build.mockClear();
    mocks.send.mockClear();
    mocks.set.setState({ projectSet: next });
    expect(mocks.build).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.send).toHaveBeenCalledOnce();
    const exported = mocks.build.mock.calls[0]![0].compositions[0];
    expect(exported.dataFields[0].defaultValue).toBe('Second');
    expect(exported.assets.find((asset: { id: string }) => asset.id === 'child-logo').dataUri).toBe(
      asset2.dataUri,
    );
  });

  it('debounces consecutive edits and publishes only the latest snapshot', async () => {
    const sync = await import('./nodosSync');
    await flush();
    choose(sync);
    sync.updateNodosPreferences({ enabled: true });
    await flush();
    mocks.send.mockClear();
    mocks.build.mockClear();
    const original = mocks.project.getState().project;
    mocks.project.setState({ project: { ...original, name: 'First edit' } });
    await vi.advanceTimersByTimeAsync(1000);
    mocks.project.setState({ project: { ...original, name: 'Final edit' } });
    await vi.advanceTimersByTimeAsync(1499);
    expect(mocks.build).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(mocks.build.mock.calls[0]![0].name).toBe('Final edit');
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each(['disable', 'untick', 'document'] as const)(
    'discards preparation after %s',
    async (change) => {
      const sync = await import('./nodosSync');
      await flush();
      const wait = deferred<ReturnType<typeof built>>();
      mocks.build.mockReturnValueOnce(wait.promise);
      const template = choose(sync);
      sync.updateNodosPreferences({ enabled: true });
      if (change === 'disable') sync.updateNodosPreferences({ enabled: false });
      if (change === 'untick') sync.chooseNodosTemplate(template, false);
      if (change === 'document')
        mocks.project.setState({ project: createProject({ name: 'Other document' }) });
      wait.resolve(built());
      await flush();
      await vi.advanceTimersByTimeAsync(2000);
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it('coalesces changes during preparation, keeps their debounce, and uses the new engine address', async () => {
    const sync = await import('./nodosSync');
    await flush();
    const wait = deferred<ReturnType<typeof built>>();
    mocks.build.mockReturnValueOnce(wait.promise);
    choose(sync);
    sync.updateNodosPreferences({ enabled: true });
    sync.updateNodosPreferences({ address: 'localhost:50053' });
    const project = mocks.project.getState().project;
    mocks.project.setState({ project: { ...project, name: 'Newest' } });
    await vi.advanceTimersByTimeAsync(500);
    wait.resolve(built());
    await flush();
    expect(mocks.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.build.mock.calls[1]![0].name).toBe('Newest');
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]![0].address).toBe('localhost:50053');
  });

  it('discards stale bridge work and resends only the current document after reconnect', async () => {
    const sync = await import('./nodosSync');
    await flush();
    const wait = deferred<ReturnType<typeof built>>();
    mocks.build.mockReturnValueOnce(wait.promise);
    const template = choose(sync);
    sync.updateNodosPreferences({ enabled: true });
    mocks.bridge.setState({ connected: false });
    expect(sync.useNodos.getState().status[template.id]).toBe('Waiting for Studio server…');
    wait.resolve(built());
    await flush();
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.bridge.setState({ connected: true });
    await flush();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('does not let a late server result replace the status of a new destination', async () => {
    const sync = await import('./nodosSync');
    await flush();
    const wait = deferred<{ ok: boolean; message: string }>();
    mocks.send.mockReturnValueOnce(wait.promise);
    const template = choose(sync);
    sync.updateNodosPreferences({ enabled: true });
    await flush();
    sync.updateNodosPreferences({ address: 'localhost:50053' });
    wait.resolve({ ok: false, message: 'Old engine failed' });
    await flush();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(sync.useNodos.getState().status[template.id]).toBe(
      `In Nodos as ${sync.useNodos.getState().presets[template.id]}`,
    );
  });

  it('never pairs an old active project with a newly selected template', async () => {
    const { sync, set, second } = await setupSet();
    mocks.set.setState({ activeTemplateId: set.templates[1]!.id });
    expect(sync.openTemplates()[1]!.project.id).toBe(second.id);
  });
});
