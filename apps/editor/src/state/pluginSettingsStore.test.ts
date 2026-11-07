import { afterEach, describe, expect, it } from 'vitest';
import {
  createRendererPluginSnapshot,
  createChartLayer,
  createProject,
  rendererPluginKey,
  type RendererPluginSnapshot,
  createAnimationPresetPluginSnapshot,
  type RendererPluginReference,
  createShaderPackPluginSnapshot,
  createShaderPaint,
} from '@ograf-editor/scene-model';
import {
  assertStudioRendererPluginsAllowed,
  attachRendererPluginSettingsSync,
  createRendererPluginSettingsStore,
  rendererPluginAllowed,
  rendererPluginReference,
  isInstalledChartPlugin,
  isInstalledShaderPackPlugin,
  studioPluginAllowed,
  assertStudioPluginsAllowed,
  useRendererPluginSettingsStore,
  type RendererPluginCatalogEntry,
  type RendererPluginCatalogStorage,
} from './pluginSettingsStore';
import { useProjectStore } from './projectStore';

function snapshot(version = '1.0.0', source = 'export default { apiVersion: 1, create() {} };') {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version,
      name: 'Test chart',
      license: 'MIT',
      presets: ['bar', 'pie'],
    },
    source,
    licenseText: 'MIT license text',
  });
}

function storage() {
  const entries = new Map<string, RendererPluginCatalogEntry>();
  const preferences = new Map<string, string>();
  const catalog: RendererPluginCatalogStorage = {
    list: async () => [...entries.values()].map((entry) => structuredClone(entry)),
    save: async (entry) => {
      entries.set(
        rendererPluginKey(rendererPluginReference(entry.snapshot)),
        structuredClone(entry),
      );
    },
    remove: async (key) => {
      entries.delete(key);
    },
  };
  return {
    entries,
    catalog,
    preferences: {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => {
        preferences.set(key, value);
      },
    },
  };
}

afterEach(() => {
  useRendererPluginSettingsStore.setState({ installed: [], defaultProvider: null });
  useProjectStore.getState().newProject();
});

function animationSnapshot(version = '1.0.0', id = 'example.motion') {
  return createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id,
      version,
      name: 'Motion presets',
      license: 'MIT',
    },
    presets: [
      {
        id: 'fade',
        name: 'Fade',
        tracks: {
          in: [
            {
              property: 'opacity',
              mode: 'factor',
              keys: [
                { at: 0, value: 0 },
                { at: 1, value: 'on-air' },
              ],
            },
          ],
        },
      },
    ],
    licenseText: 'MIT data pack',
  });
}
describe('one multi-kind local plugin catalog', () => {
  it('stores shader packs without execution, filters chart defaults, and removes only installed bytes', async () => {
    const pack = createShaderPackPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'shader-pack',
        id: 'example.shaders',
        version: '1.0.0',
        name: 'Shaders',
        license: 'CC0-1.0',
      },
      shaders: [{ id: '01', name: 'White', targets: ['fill'], paint: createShaderPaint() }],
      licenseText: 'CC0 fixture',
    });
    const backend = storage(),
      store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    await store.getState().install(snapshot());
    await store.getState().install(pack);
    expect(store.getState().installed.filter(isInstalledShaderPackPlugin)).toHaveLength(1);
    expect(store.getState().installed.filter(isInstalledChartPlugin)).toHaveLength(1);
    expect(() => store.getState().setDefaultProvider(rendererPluginReference(pack))).toThrow(
      /default chart provider/,
    );
    useRendererPluginSettingsStore.setState({ installed: store.getState().installed });
    expect(studioPluginAllowed(pack)).toBe(true);
    expect(rendererPluginAllowed(pack as unknown as RendererPluginSnapshot)).toBe(false);
    await store.getState().remove(rendererPluginReference(pack));
    expect(store.getState().installed).toHaveLength(1);
    expect(pack.shaders[0]!.paint.fragmentSource).toBeTruthy();
  });
  it('does not approve project preset data until these exact local bytes have been reviewed', () => {
    const animation = animationSnapshot();
    useRendererPluginSettingsStore.setState({ installed: [] });
    expect(studioPluginAllowed(animation)).toBe(false);
    expect(() => assertStudioPluginsAllowed([animation])).toThrow(/reviewed and enabled/);
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: animation, installedAt: '', enabled: true, trusted: true }],
    });
    expect(studioPluginAllowed(animation)).toBe(true);
    expect(rendererPluginAllowed(animation as unknown as RendererPluginSnapshot)).toBe(false);
    const altered = {
      ...animation,
      presets: [{ ...animation.presets[0]!, name: 'Changed recipe' }],
    };
    expect(studioPluginAllowed(altered)).toBe(false);
    expect(() => assertStudioPluginsAllowed([altered])).toThrow(/integrity|sha256/i);
  });
  it('installs chart and JSON packs in one store while restricting chart defaults', async () => {
    const backend = storage(),
      store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const chart = snapshot(),
      animation = animationSnapshot();
    await store.getState().install(chart);
    await store.getState().install(animation);
    expect(store.getState().installed).toHaveLength(2);
    expect(store.getState().installed.filter(isInstalledChartPlugin)).toHaveLength(1);
    expect(() => store.getState().setDefaultProvider(rendererPluginReference(animation))).toThrow(
      /default chart provider/,
    );
    store.getState().setDefaultProvider(rendererPluginReference(chart));
    store.getState().setEnabled(rendererPluginReference(animation), false);
    expect(store.getState().defaultProvider).toEqual(rendererPluginReference(chart));
    await store.getState().remove(rendererPluginReference(animation));
    expect(store.getState().installed.map((entry) => entry.snapshot.manifest.kind)).toEqual([
      'chart',
    ]);
  });
  it('keeps preset updates alongside exact prior versions without selecting a chart default', async () => {
    const backend = storage(),
      store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    await store.getState().install(animationSnapshot());
    await store.getState().install(animationSnapshot('1.0.1'));
    expect(store.getState().installed).toHaveLength(2);
    expect(store.getState().defaultProvider).toBeNull();
    const reopened = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    await reopened.getState().initialize();
    expect(reopened.getState().installed.map((entry) => entry.snapshot.manifest.kind)).toEqual([
      'animation-presets',
      'animation-presets',
    ]);
  });
  it('rejects different plugin kinds sharing an ID, including concurrent installs', async () => {
    const backend = storage(),
      store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const results = await Promise.allSettled([
      store.getState().install(snapshot()),
      store.getState().install(animationSnapshot('1.0.0', 'test.chart')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(store.getState().installed).toHaveLength(1);
    expect(backend.entries.size).toBe(1);
  });
});

describe('local renderer trust and catalog', () => {
  it('does not grant a failed install after another install succeeds or the catalog reloads', async () => {
    const backend = storage();
    const write = backend.preferences.setItem;
    let failWrites = true;
    backend.preferences.setItem = (key, value) => {
      if (failWrites) throw new Error('Preference quota exceeded');
      write(key, value);
    };
    const store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const failed = snapshot('1.0.0');
    const accepted = snapshot('2.0.0');

    await expect(store.getState().install(failed)).rejects.toThrow(/quota/);
    expect(store.getState().installed).toEqual([]);
    expect(backend.entries.size).toBe(0);
    failWrites = false;
    await store.getState().install(accepted);

    const reopened = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    await reopened.getState().initialize();
    expect(reopened.getState().installed).toMatchObject([
      { snapshot: accepted, enabled: true, trusted: true },
    ]);
    expect(reopened.getState().installed).toHaveLength(1);
  });

  it.each(['enablement', 'remove', 'default'] as const)(
    'preserves persisted policy after a failed %s action and a later successful write',
    async (action) => {
      const backend = storage();
      const store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
      const first = snapshot('1.0.0');
      const second = snapshot('2.0.0');
      await store.getState().install(first);
      await store.getState().install(second);
      const reference = rendererPluginReference(first);
      store.getState().setDefaultProvider(reference);
      const before = structuredClone(store.getState().installed);
      const write = backend.preferences.setItem;
      backend.preferences.setItem = () => {
        throw new Error('Preferences unavailable');
      };

      if (action === 'enablement')
        expect(() => store.getState().setEnabled(reference, false)).toThrow(/unavailable/);
      else if (action === 'remove')
        await expect(store.getState().remove(reference)).rejects.toThrow(/unavailable/);
      else
        expect(() => store.getState().setDefaultProvider(rendererPluginReference(second))).toThrow(
          /unavailable/,
        );

      expect(store.getState().installed).toEqual(before);
      expect(store.getState().defaultProvider).toEqual(reference);
      expect(backend.entries.size).toBe(2);
      backend.preferences.setItem = write;
      store.getState().setDefaultProvider(null);
      const reopened = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
      await reopened.getState().initialize();
      expect(reopened.getState().installed).toMatchObject([
        { snapshot: first, enabled: true, trusted: true },
        { snapshot: second, enabled: true, trusted: true },
      ]);
      expect(reopened.getState().defaultProvider).toBeNull();
    },
  );

  it('rolls an existing catalog record back when a failed reinstall would have re-enabled it', async () => {
    const backend = storage();
    const store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const plugin = snapshot();
    await store.getState().install(plugin);
    store.getState().setEnabled(rendererPluginReference(plugin), false);
    const original = structuredClone([...backend.entries.values()][0]!);
    const write = backend.preferences.setItem;
    backend.preferences.setItem = () => {
      throw new Error('Preferences unavailable');
    };

    await expect(store.getState().install(plugin)).rejects.toThrow(/unavailable/);

    expect([...backend.entries.values()]).toEqual([original]);
    backend.preferences.setItem = write;
    await store.getState().install(snapshot('2.0.0'));
    const reopened = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    await reopened.getState().initialize();
    expect(
      reopened.getState().installed.find((entry) => entry.snapshot.sha256 === plugin.sha256)!
        .enabled,
    ).toBe(false);
  });

  it('synchronizes same-origin tabs and revokes an existing provider before the catalog reload finishes', async () => {
    const backend = storage();
    const first = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const second = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const plugin = snapshot();
    await first.getState().install(plugin);
    await second.getState().initialize();
    const events = new EventTarget();
    const detach = attachRendererPluginSettingsSync(events, second);
    first.getState().setEnabled(rendererPluginReference(plugin), false);
    let finishRead: (() => void) | undefined;
    const list = backend.catalog.list;
    backend.catalog.list = async () => {
      await new Promise<void>((resolve) => {
        finishRead = resolve;
      });
      return list();
    };
    const event = new Event('storage');
    Object.assign(event, { key: 'ograf-studio:renderer-plugin-preferences:v1' });

    events.dispatchEvent(event);

    expect(second.getState().installed[0]!.enabled).toBe(false);
    finishRead!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    backend.catalog.list = list;
    first.getState().setEnabled(rendererPluginReference(plugin), true);
    await second.getState().refresh();
    expect(second.getState().installed[0]!.enabled).toBe(true);
    const added = snapshot('2.0.0');
    await first.getState().install(added);
    first.getState().setDefaultProvider(rendererPluginReference(added));
    await second.getState().refresh();
    expect(second.getState().installed).toHaveLength(2);
    expect(second.getState().defaultProvider).toEqual(rendererPluginReference(added));
    await first.getState().remove(rendererPluginReference(plugin));
    await second.getState().refresh();
    expect(second.getState().installed.map((entry) => entry.snapshot.sha256)).toEqual([
      added.sha256,
    ]);
    detach();
  });

  it('persists exact reviewed versions without evaluating their source, then restores trust and defaults', async () => {
    const backend = storage();
    const store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const plugin = snapshot(
      '1.0.0',
      'throw new Error("must not execute during install"); export default {apiVersion:1, create(){}};',
    );
    await store.getState().install(plugin);
    store.getState().setDefaultProvider(rendererPluginReference(plugin));
    const reopened = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    await reopened.getState().initialize();
    expect(reopened.getState().installed).toMatchObject([
      { snapshot: plugin, enabled: true, trusted: true },
    ]);
    expect(reopened.getState().defaultProvider).toEqual(rendererPluginReference(plugin));
    expect(backend.entries.size).toBe(1);
  });

  it('rejects tampered bytes and executable dependencies before trusting or storing them', async () => {
    const backend = storage();
    const store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const plugin = snapshot();
    await expect(
      store.getState().install({ ...plugin, source: plugin.source + '\nconsole.log(1);' }),
    ).rejects.toThrow(/integrity/);
    await expect(
      store
        .getState()
        .install(snapshot('1.0.0', 'import "https://example.test/plugin.js"; export default {};')),
    ).rejects.toThrow(/self-contained/);
    expect(backend.entries.size).toBe(0);
    expect(store.getState().installed).toEqual([]);
  });

  it('revokes enablement and default selection while retaining the project snapshot', async () => {
    const backend = storage();
    const store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    const plugin = snapshot();
    const projectCopy = structuredClone(plugin);
    await store.getState().install(plugin);
    const ref = rendererPluginReference(plugin);
    store.getState().setDefaultProvider(ref);
    const revision = store.getState().revision;
    store.getState().setEnabled(ref, false);
    expect(store.getState().revision).toBeGreaterThan(revision);
    expect(store.getState().defaultProvider).toBeNull();
    expect(store.getState().installed[0]!.enabled).toBe(false);
    await store.getState().remove(ref);
    expect(store.getState().installed).toEqual([]);
    expect(projectCopy).toEqual(plugin);
    const reopened = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    await reopened.getState().initialize();
    expect(reopened.getState().installed).toEqual([]);
  });

  it('does not trust catalog bytes without a matching persisted trust decision', async () => {
    const backend = storage();
    await backend.catalog.save({ snapshot: snapshot(), installedAt: '2026-10-04T00:00:00Z' });
    const store = createRendererPluginSettingsStore(backend.catalog, backend.preferences);
    await store.getState().initialize();
    expect(store.getState().installed).toMatchObject([{ enabled: false, trusted: false }]);
    expect(() => store.getState().setEnabled(rendererPluginReference(snapshot()), true)).toThrow(
      /trust/,
    );
  });

  it('blocks unknown, disabled and same-version changed hashes before any renderer execution', () => {
    const known = snapshot();
    const changed = snapshot('1.0.0', 'export default {apiVersion:1,create(){return null;}};');
    expect(rendererPluginAllowed(known)).toBe(false);
    expect(() => assertStudioRendererPluginsAllowed([known])).toThrow(/Open Plugins/);
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: known, enabled: true, trusted: true, installedAt: '' }],
    });
    expect(rendererPluginAllowed(known)).toBe(true);
    expect(rendererPluginAllowed(changed)).toBe(false);
    expect(rendererPluginAllowed({ ...known, source: changed.source })).toBe(false);
    const { presets, ...otherManifest } = known.manifest;
    const reordered: RendererPluginSnapshot = {
      ...known,
      manifest: { presets, ...otherManifest },
    };
    expect(rendererPluginAllowed(reordered)).toBe(true);
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: known, enabled: false, trusted: true, installedAt: '' }],
    });
    expect(rendererPluginAllowed(known)).toBe(false);
  });

  it('pins selected chart bytes and defaults only future charts, without upgrading existing charts', () => {
    const first = snapshot();
    const second = snapshot('2.0.0');
    const existing = createChartLayer();
    const project = createProject();
    project.compositions[0]!.layers = [existing];
    useProjectStore.setState({ project, activeCompositionId: project.mainCompositionId });
    useRendererPluginSettingsStore.setState({
      installed: [first, second].map((plugin) => ({
        snapshot: plugin,
        enabled: true,
        trusted: true,
        installedAt: '',
      })),
      defaultProvider: rendererPluginReference(first),
    });
    const newId = useProjectStore.getState().addLayer('chart');
    const composition = () => useProjectStore.getState().project.compositions[0]!;
    expect(composition().layers.find((layer) => layer.id === existing.id)!.element).toMatchObject({
      provider: null,
    });
    expect(composition().layers.find((layer) => layer.id === newId)!.element).toMatchObject({
      provider: rendererPluginReference(first),
    });
    useProjectStore.getState().selectChartProvider(existing.id, rendererPluginReference(second));
    expect(composition().rendererPlugins).toEqual([first, second]);
    expect(composition().layers.find((layer) => layer.id === newId)!.element).toMatchObject({
      provider: rendererPluginReference(first),
    });
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore
        .getState()
        .selectChartProvider(existing.id, null as unknown as RendererPluginReference),
    ).toThrow(/Select an installed/);
    expect(useProjectStore.getState().project).toBe(before);
    expect(composition().layers.find((layer) => layer.id === existing.id)!.element).toMatchObject({
      provider: rendererPluginReference(second),
    });
    expect(composition().rendererPlugins).toEqual([first, second]);
  });
});
