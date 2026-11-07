import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  createProject,
  createRendererPluginSnapshot,
  getLayerPropertyValueAtFrame,
  studioPluginReference,
  type AnimationPresetPluginSnapshot,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useRendererPluginSettingsStore } from './pluginSettingsStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';

vi.useFakeTimers();
vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');

const pack = createAnimationPresetPluginSnapshot({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    kind: 'animation-presets',
    id: 'test.motion',
    version: '1.0.0',
    name: 'Motion pack',
    license: 'MIT',
  },
  licenseText: 'MIT',
  presets: [
    {
      id: 'slide-fade',
      name: 'Slide and fade',
      parameters: [{ id: 'distance', label: 'Distance', default: 80, min: 0, max: 300, step: 1 }],
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
          {
            property: 'opacity',
            mode: 'absolute',
            keys: [
              { at: 0, value: 0 },
              { at: 1, value: 'on-air' },
            ],
          },
        ],
        out: [
          {
            property: 'x',
            mode: 'offset',
            keys: [
              { at: 0, value: 'on-air' },
              { at: 1, value: { parameter: 'distance' } },
            ],
          },
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
    {
      id: 'rect-only',
      name: 'Rectangle only',
      targetKinds: ['rectangle'],
      tracks: {
        in: [
          {
            property: 'opacity',
            mode: 'absolute',
            keys: [
              { at: 0, value: 0 },
              { at: 1, value: 'on-air' },
            ],
          },
        ],
      },
    },
  ],
});
const chart = createRendererPluginSnapshot({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    kind: 'chart',
    id: 'test.chart-default',
    version: '1.0.0',
    name: 'Chart renderer',
    license: 'MIT',
    presets: ['bar'],
  },
  source: 'export default {apiVersion:1,create(){}};',
  licenseText: 'MIT',
});
const entry = (snapshot: AnimationPresetPluginSnapshot | typeof chart) => ({
  snapshot,
  installedAt: '',
  enabled: true,
  trusted: true,
});
const composition = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};
const layer = (id: string) => composition().layers.find((candidate) => candidate.id === id)!;

beforeEach(() => {
  useProjectStore.getState().loadProject(createProject());
  useSelectionStore.getState().select(null);
  useTimelineStore.getState().setAutoKeyframe(false);
  useRendererPluginSettingsStore.setState({
    installed: [entry(pack), entry(chart)],
    defaultProvider: studioPluginReference(chart),
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

describe('explicit animation preset authoring', () => {
  it('bakes a selected group once, preserves selection/playhead/loops, and undoes exact pins and keys atomically', () => {
    const store = useProjectStore.getState();
    const ids = [store.addLayer('rectangle'), store.addLayer('text')];
    store.addLayerPropertyKeyframe(ids[0]!, 'x', 24);
    store.setLayerLoop(ids[0]!, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(ids[0]!, 'y', [
      { id: 'loop-a', frame: 0, value: 100, easing: 'linear' },
      { id: 'loop-b', frame: 10, value: 130, easing: 'linear' },
    ]);
    const loop = structuredClone(layer(ids[0]!).loop);
    const outside = structuredClone(
      layer(ids[0]!).animationTracks.x!.find((key) => key.frame === 24),
    );
    useSelectionStore.getState().selectMany(ids);
    useTimelineStore.getState().setCurrentFrame(7);
    history.resetHistory();
    const before = structuredClone(useProjectStore.getState().project);

    history.runDiscreteHistoryStep(
      () =>
        store.applyLayerAnimationPreset(ids, studioPluginReference(pack), 'slide-fade', 'in', {
          durationFrames: 6,
          parameters: { distance: 90 },
        }),
      'Apply group preset',
    );

    expect(composition().layers.map((target) => target.id)).toEqual(ids);
    for (const id of ids) {
      expect(getLayerPropertyValueAtFrame(layer(id), 'x', 0)).toBe(10);
      expect(getLayerPropertyValueAtFrame(layer(id), 'x', 12)).toBe(100);
      expect(layer(id).animationPresets?.in).toMatchObject({
        reference: studioPluginReference(pack),
        presetId: 'slide-fade',
        durationFrames: 6,
        parameters: { distance: 90 },
      });
    }
    expect(layer(ids[0]!).loop).toEqual(loop);
    expect(layer(ids[0]!).animationTracks.x!.find((key) => key.frame === 24)).toEqual(outside);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual(ids);
    expect(useTimelineStore.getState().currentFrame).toBe(7);
    expect(composition().animationPresetPlugins).toEqual([pack]);
    expect(composition().rendererPlugins ?? []).toEqual([]);
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    const after = structuredClone(useProjectStore.getState().project);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    history.redo();
    expect(useProjectStore.getState().project).toEqual(after);
  });

  it('applies Out without replacing existing In keys or creating chart layers', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    const store = useProjectStore.getState();
    store.applyLayerAnimationPreset(id, studioPluginReference(pack), 'slide-fade', 'in', {
      durationFrames: 6,
    });
    const incoming = structuredClone(layer(id).animationTracks.x!.filter((key) => key.frame <= 12));
    store.applyLayerAnimationPreset(id, studioPluginReference(pack), 'slide-fade', 'out', {
      durationFrames: 6,
      parameters: { distance: 100 },
    });
    expect(layer(id).animationTracks.x!.filter((key) => key.frame < 12)).toEqual(
      incoming.filter((key) => key.frame < 12),
    );
    expect(getLayerPropertyValueAtFrame(layer(id), 'x', 24)).toBe(200);
    expect(layer(id).animationPresets?.in?.presetId).toBe('slide-fade');
    expect(layer(id).animationPresets?.out?.parameters).toEqual({ distance: 100 });
    expect(composition().layers).toHaveLength(1);
    expect(composition().layers[0]!.element.type).toBe('rectangle');
  });

  it('rejects the whole incompatible selection rather than partially changing compatible members', () => {
    const ids = [
      useProjectStore.getState().addLayer('rectangle'),
      useProjectStore.getState().addLayer('text'),
    ];
    history.resetHistory();
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore
        .getState()
        .applyLayerAnimationPreset(ids, studioPluginReference(pack), 'rect-only', 'in', {
          durationFrames: 6,
        }),
    ).toThrow(/element kind/);
    expect(useProjectStore.getState().project).toBe(before);
    expect(history.getHistorySnapshot().past).toEqual([]);
    expect(composition().animationPresetPlugins).toBeUndefined();
  });

  it.each(['disabled', 'untrusted', 'removed', 'changed-bytes'] as const)(
    'rejects a %s pack without fallback to the chart default or project writes',
    (status) => {
      const id = useProjectStore.getState().addLayer('rectangle');
      useRendererPluginSettingsStore.setState({
        installed: [
          entry(chart),
          ...(status === 'removed'
            ? []
            : [
                {
                  ...entry(status === 'changed-bytes' ? { ...pack, licenseText: 'changed' } : pack),
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
          .applyLayerAnimationPreset(id, studioPluginReference(pack), 'slide-fade', 'in', {
            durationFrames: 6,
          }),
      ).toThrow(/review and enable|integrity/);
      expect(useProjectStore.getState().project).toBe(before);
      expect(history.getHistorySnapshot().past).toEqual([]);
    },
  );

  it('rejects empty, missing and entirely locked selections and invalid numeric options', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    const store = useProjectStore.getState();
    history.resetHistory();
    const before = store.project;
    const apply = (ids: string[], durationFrames = 6, distance = 80) =>
      store.applyLayerAnimationPreset(ids, studioPluginReference(pack), 'slide-fade', 'in', {
        durationFrames,
        parameters: { distance },
      });
    expect(() => apply([])).toThrow(/Select an unlocked/);
    expect(() => apply(['missing'])).toThrow(/no longer exists/);
    expect(() => apply([id], 100)).toThrow(/fit inside/);
    expect(() => apply([id], 6, NaN)).toThrow(/declared range/);
    expect(useProjectStore.getState().project).toBe(before);
    store.toggleLayerLock(id);
    const locked = useProjectStore.getState().project;
    expect(() => apply([id])).toThrow(/Select an unlocked/);
    expect(useProjectStore.getState().project).toBe(locked);
  });

  it('skips locked objects while applying to every unlocked target once', () => {
    const first = useProjectStore.getState().addLayer('rectangle');
    const locked = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().toggleLayerLock(locked);
    const unchanged = structuredClone(layer(locked));
    useProjectStore
      .getState()
      .applyLayerAnimationPreset([first, locked], studioPluginReference(pack), 'slide-fade', 'in', {
        durationFrames: 6,
      });
    expect(layer(first).animationPresets?.in?.presetId).toBe('slide-fade');
    expect(layer(locked)).toEqual(unchanged);
  });
});
