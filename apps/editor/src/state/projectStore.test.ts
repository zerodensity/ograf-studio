import { beforeEach, describe, expect, it } from 'vitest';
import { getLayerPropertyValueAtFrame } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';

describe('project store authoring', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('creates new projects with an opaque black canvas and 20% gray outside-canvas fill', () => {
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);

    expect(composition.backgroundColor).toBe('#000000');
    expect(composition.layout.dimOutsideCanvas).toBe(true);
  });

  it('authors stroke colour statically and stroke width on the current frame', () => {
    const layerId = useProjectStore.getState().addLayer('text');

    useProjectStore.getState().updateLayerTextStroke(layerId, 6, {
      strokeColor: '#101820',
      strokeWidth: 5,
    });

    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const layer = composition.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.element).toMatchObject({
      type: 'text',
      strokeColor: '#101820',
      strokeWidth: 5,
    });
    expect(getLayerPropertyValueAtFrame(layer, 'strokeWidth', 6)).toBe(5);
    expect(layer.animationTracks.strokeWidth?.some((key) => key.frame === 6)).toBe(true);
  });

  it('applies style packs and adds portable broadcast recipes from the editor store', () => {
    const applied = useProjectStore.getState().applyStylePack('documentary');
    const ticker = useProjectStore.getState().addTicker();
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);

    expect(applied.packId).toBe('documentary');
    expect(composition.designSystem.name).toBe('Documentary Brand Kit');
    expect(ticker.recipe).toBe('ticker');
    expect(
      composition.layers.find((layer) => layer.id === ticker.layers.crawl)?.loop,
    ).not.toBeNull();
  });
});
