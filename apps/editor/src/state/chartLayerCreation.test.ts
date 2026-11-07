import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeKeyframeFrames,
  createRendererPluginSnapshot,
  buildComponentDefinition,
  getLayerTransformAtFrame,
  type Layer,
  type LayerTransform,
  type RendererPluginReference,
  type ChartPreset,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { rendererPluginReference, useRendererPluginSettingsStore } from './pluginSettingsStore';
import { useSelectionStore } from './selectionStore';

vi.useFakeTimers();
vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');

function plugin(id: string, presets: ChartPreset[] = ['pie']): RendererPluginSnapshot {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id,
      version: '1.0.0',
      name: id,
      presets,
      license: 'MIT',
    },
    source: 'export default { apiVersion:1, create(){} };',
    licenseText: `MIT ${id}`,
  });
}

const composition = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};
const selected = plugin('test.gallery-selected');
const defaultPlugin = plugin('test.global-default', ['bar', 'line']);

function expectStaticLayer(layer: Layer, expected: Partial<LayerTransform>) {
  expect(layer.animationTrackMode).toBe('independent');
  expect(layer.animationTracks).toEqual({});
  const base = getLayerTransformAtFrame(layer, 0);
  expect(base).toMatchObject(expected);
  for (const { frame } of computeKeyframeFrames(composition()))
    expect(getLayerTransformAtFrame(layer, frame)).toEqual(base);
}

beforeEach(() => {
  useProjectStore.getState().newProject();
  useSelectionStore.getState().select(null);
  useRendererPluginSettingsStore.setState({
    installed: [selected, defaultPlugin].map((snapshot) => ({
      snapshot,
      installedAt: '',
      trusted: true,
      enabled: true,
    })),
    defaultProvider: rendererPluginReference(defaultPlugin),
  });
  history.resetHistory();
});
afterEach(() => {
  history.resetHistory();
  useRendererPluginSettingsStore.setState({ installed: [], defaultProvider: null });
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('atomic explicit chart gallery creation', () => {
  it('honors a viewport placement when creating a chart through either entry point', () => {
    const placement = { x: 312, y: 128, groupId: 'group-placement' };
    const provider = rendererPluginReference(selected);
    const ids = [
      useProjectStore.getState().addChartLayer('pie', provider, placement),
      useProjectStore.getState().addLayer('chart', placement),
    ];
    for (const [index, id] of ids.entries()) {
      const layer = composition().layers.find((candidate) => candidate.id === id)!;
      expect(layer.groupId).toBe(placement.groupId);
      expectStaticLayer(layer, { x: 312, y: 128, width: 640, height: 360 });
      expect(layer.element).toMatchObject({
        preset: index === 0 ? 'pie' : 'bar',
        provider: index === 0 ? provider : rendererPluginReference(defaultPlugin),
      });
    }
  });
  it('uses the selected provider and preset together despite another global default', () => {
    const id = useProjectStore.getState().addChartLayer('pie', rendererPluginReference(selected));
    const layer = composition().layers.find((candidate) => candidate.id === id)!;
    expect(layer.element).toMatchObject({
      type: 'chart',
      preset: 'pie',
      provider: rendererPluginReference(selected),
    });
    expect(composition().rendererPlugins).toEqual([selected]);
    expectStaticLayer(layer, { width: 640, height: 360 });
    expect(useSelectionStore.getState().selectedLayerId).toBeNull();
    expect(history.getHistorySnapshot().past).toHaveLength(1);
  });

  it('creates and pins an explicitly selected provider when no default is configured', () => {
    useRendererPluginSettingsStore.setState({ defaultProvider: null });
    const provider = rendererPluginReference(selected);

    const id = useProjectStore.getState().addChartLayer('pie', provider);

    expect(composition().layers.find((layer) => layer.id === id)?.element).toMatchObject({
      type: 'chart',
      preset: 'pie',
      provider,
    });
    expect(composition().rendererPlugins).toEqual([selected]);
    expect(useRendererPluginSettingsStore.getState().defaultProvider).toBeNull();
  });

  it('rejects a null renderer before creating a layer even with a configured plugin default', () => {
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore.getState().addChartLayer('radar', null as unknown as RendererPluginReference),
    ).toThrow(/Select an installed/);
    expect(useProjectStore.getState().project).toBe(before);
    expect(composition().layers).toEqual([]);
    expect(history.getHistorySnapshot().past).toEqual([]);
  });

  it.each(['removed', 'disabled', 'untrusted'] as const)(
    'rejects a %s selection without a layer or history mutation',
    (status) => {
      const current = useRendererPluginSettingsStore.getState().installed;
      useRendererPluginSettingsStore.setState({
        installed: current
          .filter(
            (entry) => status !== 'removed' || entry.snapshot.manifest.id !== selected.manifest.id,
          )
          .map((entry) =>
            entry.snapshot.manifest.id === selected.manifest.id
              ? { ...entry, enabled: status !== 'disabled', trusted: status !== 'untrusted' }
              : entry,
          ),
      });
      const before = useProjectStore.getState().project;
      expect(() =>
        useProjectStore.getState().addChartLayer('pie', rendererPluginReference(selected)),
      ).toThrow(/trust and enable/);
      expect(useProjectStore.getState().project).toBe(before);
      expect(history.getHistorySnapshot()).toMatchObject({ past: [], future: [], canUndo: false });
    },
  );

  it('rejects a different hash and corrupted installed bytes without falling back to the default', () => {
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore.getState().addChartLayer('pie', {
        ...rendererPluginReference(selected),
        sha256: 'f'.repeat(64),
      }),
    ).toThrow(/trust and enable/);
    useRendererPluginSettingsStore.setState({
      installed: [
        {
          snapshot: { ...selected, source: selected.source + '// changed' },
          installedAt: '',
          enabled: true,
          trusted: true,
        },
      ],
    });
    expect(() =>
      useProjectStore.getState().addChartLayer('pie', rendererPluginReference(selected)),
    ).toThrow(/integrity/);
    expect(useProjectStore.getState().project).toBe(before);
    expect(history.getHistorySnapshot().past).toEqual([]);
  });

  it('rejects unsupported or unknown presets before pinning or creating anything', () => {
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore.getState().addChartLayer('bar', rendererPluginReference(selected)),
    ).toThrow(/does not support/);
    expect(() =>
      useProjectStore
        .getState()
        .addChartLayer('scatter' as ChartPreset, rendererPluginReference(selected)),
    ).toThrow(/Unknown chart preset/);
    expect(() =>
      useProjectStore
        .getState()
        .addChartLayer('constructor' as ChartPreset, rendererPluginReference(selected)),
    ).toThrow(/Unknown chart preset/);
    expect(useProjectStore.getState().project).toBe(before);
    expect(history.getHistorySnapshot().past).toEqual([]);
  });

  it('rolls back the whole transaction if pinning exceeds the composition limit', () => {
    const project = structuredClone(useProjectStore.getState().project);
    project.compositions[0]!.rendererPlugins = Array.from({ length: 16 }, (_, index) =>
      plugin(`test.existing-${index}`),
    );
    useProjectStore.setState({ project });
    history.resetHistory();
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore.getState().addChartLayer('pie', rendererPluginReference(selected)),
    ).toThrow(/too many pinned/);
    expect(useProjectStore.getState().project).toBe(before);
    expect(history.getHistorySnapshot().past).toEqual([]);
  });

  it('undoes and redoes the layer, preset, static pose and exact pinned bytes atomically', () => {
    const before = structuredClone(useProjectStore.getState().project);
    const id = useProjectStore.getState().addChartLayer('pie', rendererPluginReference(selected));
    const after = structuredClone(useProjectStore.getState().project);
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    expect(composition().layers.some((layer) => layer.id === id)).toBe(false);
    expect(composition().rendererPlugins ?? []).toEqual([]);
    history.redo();
    expect(useProjectStore.getState().project).toEqual(after);
    expect(composition().rendererPlugins).toEqual([selected]);
    expect(composition().layers.find((layer) => layer.id === id)!.element).toMatchObject({
      preset: 'pie',
      provider: rendererPluginReference(selected),
    });
  });

  it('retains the normal addLayer chart provider and static independent poses for other kinds', () => {
    const chart = useProjectStore.getState().addLayer('chart');
    expect(composition().layers.find((layer) => layer.id === chart)!.element).toMatchObject({
      preset: 'bar',
      provider: rendererPluginReference(defaultPlugin),
    });
    const rectangle = useProjectStore.getState().addLayer('rectangle');
    expectStaticLayer(
      composition().layers.find((layer) => layer.id === chart)!,
      {
        width: 640,
        height: 360,
      },
    );
    expectStaticLayer(
      composition().layers.find((layer) => layer.id === rectangle)!,
      {
        width: 200,
        height: 200,
      },
    );
  });

  it.each(['none', 'removed', 'disabled', 'untrusted'] as const)(
    'rejects generic chart creation when the configured default is %s',
    (status) => {
      const settings = useRendererPluginSettingsStore.getState();
      useRendererPluginSettingsStore.setState({
        defaultProvider: status === 'none' ? null : rendererPluginReference(defaultPlugin),
        installed: settings.installed
          .filter(
            (entry) =>
              status !== 'removed' || entry.snapshot.manifest.id !== defaultPlugin.manifest.id,
          )
          .map((entry) =>
            entry.snapshot.manifest.id === defaultPlugin.manifest.id
              ? { ...entry, enabled: status !== 'disabled', trusted: status !== 'untrusted' }
              : entry,
          ),
      });
      const before = useProjectStore.getState().project;
      expect(() => useProjectStore.getState().addLayer('chart')).toThrow(
        status === 'none' ? /No default chart renderer/ : /trust and enable/,
      );
      expect(useProjectStore.getState().project).toBe(before);
      expect(history.getHistorySnapshot().past).toEqual([]);
    },
  );

  it('prunes only the replaced unreferenced pin while preserving unrelated retained snapshots', () => {
    const next = createRendererPluginSnapshot({
      ...selected,
      manifest: { ...selected.manifest, version: '1.0.1' },
    });
    useRendererPluginSettingsStore.setState({
      installed: [
        ...useRendererPluginSettingsStore.getState().installed,
        { snapshot: next, installedAt: '', enabled: true, trusted: true },
      ],
    });
    const first = useProjectStore
      .getState()
      .addChartLayer('pie', rendererPluginReference(selected));
    const shared = useProjectStore
      .getState()
      .addChartLayer('pie', rendererPluginReference(selected));
    const unrelated = plugin('test.retained', ['bar']);
    const project = structuredClone(useProjectStore.getState().project);
    project.compositions[0]!.rendererPlugins!.push(unrelated);
    useProjectStore.setState({ project });

    useProjectStore.getState().selectChartProvider(first, rendererPluginReference(next));
    expect(composition().rendererPlugins).toEqual([selected, unrelated, next]);
    useProjectStore.getState().selectChartProvider(shared, rendererPluginReference(next));
    expect(composition().rendererPlugins).toEqual([unrelated, next]);
    expect(
      composition().layers.every(
        (layer) => layer.element.type === 'chart' && layer.element.provider?.version === '1.0.1',
      ),
    ).toBe(true);
  });

  it.each(['guide', 'prototype', 'component'] as const)(
    'preserves an old provider pin still referenced by a %s',
    (kind) => {
      const next = createRendererPluginSnapshot({
        ...selected,
        manifest: { ...selected.manifest, version: '1.0.1' },
      });
      useRendererPluginSettingsStore.setState({
        installed: [
          ...useRendererPluginSettingsStore.getState().installed,
          { snapshot: next, installedAt: '', enabled: true, trusted: true },
        ],
      });
      const id = useProjectStore.getState().addChartLayer('pie', rendererPluginReference(selected));
      const project = structuredClone(useProjectStore.getState().project);
      const scope = project.compositions[0]!;
      if (kind === 'component')
        scope.components.push(buildComponentDefinition(scope, [id], 'Saved chart', 'saved-chart'));
      else {
        const shared = structuredClone(scope.layers[0]!);
        shared.id = 'shared-chart';
        shared.isGuide = kind === 'guide';
        scope.layers.push(shared);
        if (kind === 'prototype')
          scope.runtimeCollections.push({
            id: 'collection',
            name: 'Rows',
            fieldId: 'rows',
            prototypeLayerIds: [shared.id],
            offsetPerItem: { x: 0, y: 100 },
            capacity: 10,
            overflow: 'truncate',
          });
      }
      useProjectStore.setState({ project });
      useProjectStore.getState().selectChartProvider(id, rendererPluginReference(next));
      expect(composition().rendererPlugins).toEqual([selected, next]);
    },
  );

  it('undoes two toolbar creation cycles around a settings version install without a no-op history entry', () => {
    const first = plugin('test.toolbar-demo', ['bar', 'line']);
    const second = createRendererPluginSnapshot({
      ...first,
      manifest: { ...first.manifest, version: '1.0.1' },
    });
    const entry = (snapshot: RendererPluginSnapshot) => ({
      snapshot,
      installedAt: '',
      enabled: true,
      trusted: true,
    });
    useRendererPluginSettingsStore.setState({
      installed: [entry(first)],
      defaultProvider: rendererPluginReference(first),
    });
    const baseline = structuredClone(useProjectStore.getState().project);
    const createFromToolbar = (preset: ChartPreset) => {
      const id = history.runDiscreteHistoryStep(
        () => useProjectStore.getState().addChartLayer(preset, rendererPluginReference(first)),
        'Add Toolbar demo chart',
      );
      useSelectionStore.getState().select(id);
      return id;
    };
    createFromToolbar('line');
    history.undo();
    expect(useProjectStore.getState().project).toEqual(baseline);
    expect(history.getHistorySnapshot().future).toHaveLength(1);
    useRendererPluginSettingsStore.setState({
      installed: [entry(first), entry(second)],
      defaultProvider: rendererPluginReference(second),
      revision: useRendererPluginSettingsStore.getState().revision + 1,
    });
    const id = createFromToolbar('bar');
    expect(history.getHistorySnapshot()).toMatchObject({
      past: [{ label: 'Add Toolbar demo chart' }],
      future: [],
    });
    const created = structuredClone(useProjectStore.getState().project);
    // A UI-only open/close and an identical server synchronization must not replace the baseline.
    history.runDiscreteHistoryStep(() => {}, 'No-op gallery open/close');
    history.applyRemoteProjectUpdate(structuredClone(created), { source: 'system' });
    history.undo();
    expect(useProjectStore.getState().project).toEqual(baseline);
    expect(composition().layers.some((layer) => layer.id === id)).toBe(false);
    expect(composition().rendererPlugins ?? []).toEqual([]);
    history.redo();
    expect(useProjectStore.getState().project).toEqual(created);
    expect(composition().rendererPlugins).toEqual([first]);
  });

  it('keeps the correct baseline after undo, redo, undo and a new discrete toolbar command', () => {
    const baseline = structuredClone(useProjectStore.getState().project);
    const createFromToolbar = () => {
      const id = history.runDiscreteHistoryStep(
        () => useProjectStore.getState().addChartLayer('pie', rendererPluginReference(selected)),
        'Add Toolbar demo chart',
      );
      useSelectionStore.getState().select(id);
    };
    createFromToolbar();
    history.undo();
    history.redo();
    history.undo();
    expect(useProjectStore.getState().project).toEqual(baseline);
    createFromToolbar();
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    expect(history.getHistorySnapshot().future).toEqual([]);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(baseline);
  });

  it('restores an outside-canvas deselection before undoing the toolbar creation', () => {
    const baseline = structuredClone(useProjectStore.getState().project);
    const id = history.runDiscreteHistoryStep(
      () => useProjectStore.getState().addChartLayer('pie', rendererPluginReference(selected)),
      'Add Toolbar demo chart',
    );
    useSelectionStore.getState().select(id);
    useSelectionStore.getState().deselectAll();
    const created = useProjectStore.getState().project;
    history.undo();
    expect(useProjectStore.getState().project).toBe(created);
    expect(useSelectionStore.getState().selectedLayerId).toBe(id);
    expect(history.getHistorySnapshot().past).toMatchObject([{ label: 'Add Toolbar demo chart' }]);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(baseline);
  });
});
