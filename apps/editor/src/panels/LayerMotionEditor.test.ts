import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getLayerPropertyValueAtFrame,
  layerMotionStagger,
  createProject,
  reviewCompositionDesign,
  createAnimationPresetPluginSnapshot,
  studioPluginReference,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { getActiveComposition, useProjectStore } from '../state/projectStore';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { LayerMotionEditor } from './LayerMotionEditor';
import { groupMotionPlan } from './groupMotion';

vi.stubGlobal('window', { clearTimeout });
const history = await import('../state/historyStore');
afterEach(() => {
  history.resetHistory();
  useRendererPluginSettingsStore.setState({ installed: [], defaultProvider: null });
});
afterAll(() => vi.unstubAllGlobals());

describe('Animate In / Out', () => {
  // These tests exercise the legacy 12-frame spans, not the UI blank-template preset.
  beforeEach(() => useProjectStore.getState().loadProject(createProject()));

  it('bakes an ordered group animation as one undoable change without validation errors', () => {
    const store = useProjectStore.getState();
    const ids = [store.addLayer('rectangle'), store.addLayer('text'), store.addLayer('text')];
    history.resetHistory();
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const layers = composition.layers.filter((layer) => ids.includes(layer.id));
    const plans = (['in', 'out'] as const).map((side) => ({
      side,
      items: groupMotionPlan(composition, layers, side),
    }));
    history.runDiscreteHistoryStep(() => {
      for (const plan of plans)
        for (const item of plan.items)
          useProjectStore.getState().setLayerMotion(item.layerId, plan.side, item.spec);
    }, 'Animate group');
    const changed = useProjectStore.getState();
    expect(validateProject(changed.project).errors).toEqual([]);
    expect(history.getHistorySnapshot().past.at(-1)?.label).toBe('Animate group');
    history.undo();
    const restored = getActiveComposition(
      useProjectStore.getState().project,
      state.activeCompositionId,
    );
    expect(restored.layers.every((layer) => !layer.motion)).toBe(true);
  });

  it('does not add design QA findings to the lower-third recipe', () => {
    const recipe = useProjectStore.getState().addLowerThird();
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const before = new Set(
      reviewCompositionDesign(composition).findings.map((finding) => finding.id),
    );
    const ids = Object.values(recipe.layers);
    const layers = composition.layers.filter((layer) => ids.includes(layer.id));
    for (const side of ['in', 'out'] as const)
      for (const item of groupMotionPlan(composition, layers, side))
        useProjectStore.getState().setLayerMotion(item.layerId, side, item.spec);
    const next = useProjectStore.getState();
    const findings = reviewCompositionDesign(
      getActiveComposition(next.project, next.activeCompositionId),
    ).findings;
    expect(findings.filter((finding) => !before.has(finding.id))).toEqual([]);
  });

  it('bakes one choice into every selected unlocked layer', () => {
    const store = useProjectStore.getState();
    const first = store.addLayer('rectangle');
    const second = store.addLayer('text');
    const locked = store.addLayer('ellipse');
    useProjectStore.setState((current) => {
      const composition = getActiveComposition(current.project, current.activeCompositionId);
      const lockedLayer = composition.layers.find((layer) => layer.id === locked)!;
      return {
        project: {
          ...current.project,
          compositions: current.project.compositions.map((candidate) =>
            candidate.id === composition.id
              ? {
                  ...candidate,
                  layers: candidate.layers.map((layer) =>
                    layer === lockedLayer ? { ...layer, isLocked: true } : layer,
                  ),
                }
              : candidate,
          ),
        },
      };
    });

    useProjectStore
      .getState()
      .setLayerMotion([first, second, locked], 'in', { style: 'fade', durationFrames: 6 });
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const byId = (id: string) => composition.layers.find((layer) => layer.id === id)!;

    for (const id of [first, second]) {
      expect(getLayerPropertyValueAtFrame(byId(id), 'opacity', 0)).toBe(0);
      expect(getLayerPropertyValueAtFrame(byId(id), 'opacity', 12)).toBe(1);
      expect(byId(id).motion?.in).toMatchObject({ style: 'fade', durationFrames: 6 });
    }
    expect(byId(locked).motion).toBeUndefined();
    expect(validateProject(state.project).errors).toEqual([]);
  });

  it('staggers a group by position and keeps the stagger when the spec changes', () => {
    const store = useProjectStore.getState();
    const ids = [store.addLayer('rectangle'), store.addLayer('rectangle'), store.addLayer('text')];
    ids.forEach((id, index) =>
      useProjectStore.getState().updateLayerTransform(id, 12, { x: 100 + index * 300 }),
    );
    useProjectStore
      .getState()
      .setLayerMotion(
        ids,
        'in',
        { style: 'wipe', direction: 'left', durationFrames: 4 },
        { frames: 2, order: 'left-to-right' },
      );
    let state = useProjectStore.getState();
    let composition = getActiveComposition(state.project, state.activeCompositionId);
    const group = () => ids.map((id) => composition.layers.find((layer) => layer.id === id)!);
    expect(group().map((layer) => layer.motion?.in?.offsetFrames ?? 0)).toEqual([4, 2, 0]);
    expect(layerMotionStagger(composition, group(), 'in')).toEqual({
      frames: 2,
      order: 'left-to-right',
    });
    expect(validateProject(state.project).errors).toEqual([]);

    useProjectStore
      .getState()
      .setLayerMotion(
        ids,
        'in',
        { style: 'pop', durationFrames: 6 },
        layerMotionStagger(composition, group(), 'in'),
      );
    state = useProjectStore.getState();
    composition = getActiveComposition(state.project, state.activeCompositionId);
    expect(group().map((layer) => layer.motion?.in?.offsetFrames ?? 0)).toEqual([4, 2, 0]);
    expect(group().every((layer) => layer.animationTracks.clipRight === undefined)).toBe(true);
    expect(getLayerPropertyValueAtFrame(group()[0]!, 'scale', 0)).toBe(0);
    expect(validateProject(state.project).errors).toEqual([]);

    useProjectStore
      .getState()
      .setLayerMotion(
        ids,
        'out',
        { style: 'fade', durationFrames: 12 },
        { frames: 5, order: 'right-to-left' },
      );
    state = useProjectStore.getState();
    composition = getActiveComposition(state.project, state.activeCompositionId);
    expect(group().map((layer) => layer.motion?.out?.offsetFrames ?? 0)).toEqual([0, 5, 10]);
    expect(group().map((layer) => layer.motion?.out?.durationFrames)).toEqual([2, 2, 2]);
  });

  it('offers both In and Out plugin entry points and labels provenance as last applied editable keys', () => {
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
          id: 'fade',
          name: 'Pack fade',
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
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: pack, enabled: true, trusted: true, installedAt: '' }],
    });
    const id = useProjectStore.getState().addLayer('rectangle');
    useProjectStore
      .getState()
      .applyLayerAnimationPreset(id, studioPluginReference(pack), 'fade', 'in', {
        durationFrames: 6,
      });
    // Removing installation permission does not erase the authored keys or their provenance.
    useRendererPluginSettingsStore.setState({ installed: [] });
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const layer = composition.layers.find((candidate) => candidate.id === id)!;
    const markup = renderToStaticMarkup(
      createElement(LayerMotionEditor, { composition, layer, layerIds: [id] }),
    );
    expect(markup).toContain('Animation plugins In');
    expect(markup).toContain('Animation plugins Out');
    expect(markup).toContain('Last applied: Pack fade');
    expect(markup).toContain('editable keys');
    expect(getLayerPropertyValueAtFrame(layer, 'opacity', 0)).toBe(0);
  });
});
