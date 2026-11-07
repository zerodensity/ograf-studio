import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  createRendererPluginSnapshot,
  studioPluginReference,
  type ChartElement,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useRendererPluginSettingsStore } from './pluginSettingsStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';

vi.useFakeTimers();
vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');
const originalSettings = useRendererPluginSettingsStore.getState();
const pack = createAnimationPresetPluginSnapshot({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    kind: 'animation-presets',
    id: 'test.mark-store',
    version: '1.0.0',
    name: 'Mark motion',
    license: 'MIT',
  },
  licenseText: 'MIT',
  presets: [
    {
      id: 'fade',
      name: 'Mark fade',
      parameters: [{ id: 'distance', label: 'Distance', default: 20, min: 0, max: 200, step: 1 }],
      tracks: {
        in: [
          {
            property: 'x',
            mode: 'offset',
            keys: [
              { at: 0, value: { parameter: 'distance', multiplier: -1 } },
              { at: 1, value: 'on-air' },
            ],
          },
        ],
        out: [
          {
            property: 'opacity',
            mode: 'absolute',
            keys: [
              { at: 0, value: 'on-air' },
              { at: 1, value: 0 },
            ],
          },
        ],
      },
    },
  ],
});
function provider(modern = true): RendererPluginSnapshot {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.mark-provider',
      version: modern ? '1.3.0' : '1.2.0',
      name: 'Chart renderer',
      license: 'MIT',
      presets: ['bar', 'pie', 'line'],
      ...(modern ? { chartFeatures: ['mark-animation-v1'] } : {}),
    },
    source: 'export default {apiVersion:1,create(){}};',
    licenseText: 'MIT',
  });
}
const modern = provider();
const entry = (snapshot: typeof pack | RendererPluginSnapshot) => ({
  snapshot,
  installedAt: '',
  enabled: true,
  trusted: true,
});
const options = {
  durationFrames: 6,
  delayFrames: 1,
  staggerFrames: 1,
  parameters: { distance: 30 },
};
const composition = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};
const layer = (id: string) => composition().layers.find((item) => item.id === id)!;
const element = (id: string) => layer(id).element as ChartElement;
const addChart = () =>
  useProjectStore.getState().addChartLayer('bar', studioPluginReference(modern));
function replaceChart(
  id: string,
  patch: Partial<ChartElement>,
  pinnedProvider?: RendererPluginSnapshot | null,
) {
  const project = structuredClone(useProjectStore.getState().project);
  const active = getActiveComposition(project, useProjectStore.getState().activeCompositionId);
  const target = active.layers.find((item) => item.id === id)!;
  target.element = { ...target.element, ...patch } as ChartElement;
  if (pinnedProvider !== undefined) active.rendererPlugins = pinnedProvider ? [pinnedProvider] : [];
  useProjectStore.setState({ project });
  history.resetHistory();
}
beforeEach(() => {
  useProjectStore.getState().newProject();
  useSelectionStore.getState().select(null);
  useTimelineStore.getState().setAutoKeyframe(false);
  useRendererPluginSettingsStore.setState({
    installed: [entry(pack), entry(modern)],
    defaultProvider: null,
  });
  history.resetHistory();
});
afterEach(() => {
  history.resetHistory();
  useRendererPluginSettingsStore.setState(originalSettings);
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('chart mark animation store actions', () => {
  it('applies independent In and Out presets without replacing chart settings or whole-layer keys', () => {
    const id = addChart();
    const before = structuredClone(layer(id));
    useProjectStore
      .getState()
      .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'in', options);
    const incoming = structuredClone(element(id).markAnimations!.in);
    useProjectStore
      .getState()
      .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'out', {
        ...options,
        delayFrames: 0,
      });
    expect(element(id).markAnimations?.in).toEqual(incoming);
    expect(element(id).markAnimations?.out).toMatchObject({
      reference: studioPluginReference(pack),
      presetId: 'fade',
      durationFrames: 6,
      delayFrames: 0,
      staggerFrames: 1,
    });
    expect(layer(id).animationTracks).toEqual(before.animationTracks);
    expect(layer(id).keyframes).toEqual(before.keyframes);
    expect(layer(id).animationPresets).toEqual(before.animationPresets);
    expect(element(id).animation).toEqual((before.element as ChartElement).animation);
    expect(element(id).data).toEqual((before.element as ChartElement).data);
    expect(composition().animationPresetPlugins).toEqual([pack]);
    expect(composition().layers).toHaveLength(1);
  });

  it('undoes and redoes the exact source pin and mark application as one action', () => {
    const id = addChart();
    history.resetHistory();
    const before = structuredClone(useProjectStore.getState().project);
    history.runDiscreteHistoryStep(
      () =>
        useProjectStore
          .getState()
          .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'in', options),
      'Animate bars',
    );
    const after = structuredClone(useProjectStore.getState().project);
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    history.redo();
    expect(useProjectStore.getState().project).toEqual(after);
  });

  it('uses a retained exact pack after uninstall without silently granting local trust', () => {
    const id = addChart();
    useProjectStore
      .getState()
      .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'in', options);
    useRendererPluginSettingsStore.setState({ installed: [entry(modern)] });
    useProjectStore
      .getState()
      .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'out', options);
    expect(element(id).markAnimations?.out?.reference).toEqual(studioPluginReference(pack));
    expect(composition().animationPresetPlugins).toEqual([pack]);
    expect(useRendererPluginSettingsStore.getState().installed).toEqual([entry(modern)]);
  });

  it.each(['removed', 'disabled', 'untrusted', 'corrupted'] as const)(
    'rejects an unpinned %s pack without source or history publication',
    (status) => {
      const id = addChart();
      useRendererPluginSettingsStore.setState({
        installed: [
          entry(modern),
          ...(status === 'removed'
            ? []
            : [
                {
                  ...entry(
                    status === 'corrupted' ? { ...pack, licenseText: 'Changed bytes' } : pack,
                  ),
                  enabled: status !== 'disabled',
                  trusted: status !== 'untrusted',
                },
              ]),
        ],
      });
      history.resetHistory();
      const before = useProjectStore.getState().project;
      expect(() =>
        useProjectStore
          .getState()
          .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'in', options),
      ).toThrow(/Install and enable|integrity/);
      expect(useProjectStore.getState().project).toBe(before);
      expect(history.getHistorySnapshot().past).toEqual([]);
    },
  );

  it.each([
    'old-provider',
    'missing-provider',
    'shape',
    'duration',
    'locked',
    'bad-digest',
  ] as const)('rejects %s atomically before pinning the pack', (failure) => {
    const id = addChart();
    if (failure === 'old-provider') {
      const old = provider(false);
      replaceChart(id, { provider: studioPluginReference(old) }, old);
    }
    if (failure === 'missing-provider') replaceChart(id, {}, null);
    if (failure === 'shape') replaceChart(id, { preset: 'line' });
    if (failure === 'locked') useProjectStore.getState().toggleLayerLock(id);
    history.resetHistory();
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore
        .getState()
        .applyChartMarkPreset(
          id,
          failure === 'bad-digest'
            ? { ...studioPluginReference(pack), sha256: 'a'.repeat(64) }
            : studioPluginReference(pack),
          'fade',
          'in',
          { ...options, ...(failure === 'duration' ? { durationFrames: 13 } : {}) },
        ),
    ).toThrow();
    expect(useProjectStore.getState().project).toBe(before);
    expect(composition().animationPresetPlugins).toBeUndefined();
    expect(history.getHistorySnapshot().past).toEqual([]);
  });

  it('can clear incompatible old-provider settings one side at a time and undo that clear', () => {
    const id = addChart();
    useProjectStore
      .getState()
      .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'in', options);
    useProjectStore
      .getState()
      .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'out', options);
    const old = provider(false);
    replaceChart(id, { provider: studioPluginReference(old) }, old);
    const outgoing = structuredClone(element(id).markAnimations!.out);
    const before = structuredClone(useProjectStore.getState().project);
    history.runDiscreteHistoryStep(
      () => useProjectStore.getState().clearChartMarkPreset(id, 'in'),
      'Clear bars In',
    );
    expect(element(id).markAnimations?.in).toBeUndefined();
    expect(element(id).markAnimations?.out).toEqual(outgoing);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    history.redo();
    useProjectStore.getState().clearChartMarkPreset(id, 'out');
    expect(element(id).markAnimations).toBeUndefined();
    expect(composition().animationPresetPlugins).toEqual([pack]);
  });

  it('rejects clearing a locked, missing or non-chart target without altering the project', () => {
    const id = addChart();
    useProjectStore
      .getState()
      .applyChartMarkPreset(id, studioPluginReference(pack), 'fade', 'in', options);
    const rectangle = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().toggleLayerLock(id);
    history.resetHistory();
    const before = useProjectStore.getState().project;
    for (const target of [id, rectangle, 'missing'])
      expect(() => useProjectStore.getState().clearChartMarkPreset(target, 'in')).toThrow(
        /unlocked chart/,
      );
    expect(useProjectStore.getState().project).toBe(before);
    expect(history.getHistorySnapshot().past).toEqual([]);
  });
});
