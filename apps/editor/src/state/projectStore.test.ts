import { beforeEach, describe, expect, it } from 'vitest';
import { getLayerPropertyValueAtFrame } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';

describe('project store authoring', () => {
  beforeEach(() => useProjectStore.getState().newProject());
  it('applies and removes a pack through Immer with existing token links and rounded shapes', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.setLayerSemantics(id, { role: 'container' });
    store.updateLayerElement(id, {
      borderRadius: { topLeft: 4, topRight: 7, bottomLeft: 2, bottomRight: 3 },
    });
    const before = structuredClone(
      useProjectStore.getState().project.compositions[0]!.layers[0]!.element,
    );
    expect(() => store.applyStylePack('sports')).not.toThrow();
    expect(() => store.removeStylePack()).not.toThrow();
    expect(useProjectStore.getState().project.compositions[0]!.layers[0]!.element).toEqual(before);
  });
  it('removes the applied Brand Kit pack through the Resources action', () => {
    const store = useProjectStore.getState();
    store.applyStylePack('news');
    store.removeStylePack();
    const state = useProjectStore.getState(),
      c = getActiveComposition(state.project, state.activeCompositionId);
    expect(c.designSystem.tokens.some((token) => token.key === 'brand.pack.id')).toBe(false);
    expect(c.designSystem.name).toBe('Brand Kit');
  });

  it('authors path paints and prevents mask-source deletion or cyclic Inspector edits', () => {
    const store = useProjectStore.getState(),
      target = store.addLayer('path'),
      source = store.addLayer('ellipse');
    useProjectStore.getState().updateLayerPaint(target, 0, {
      type: 'radial',
      angle: 0,
      stops: [
        { offset: 0, color: '#fff', opacity: 1 },
        { offset: 1, color: '#000', opacity: 0 },
      ],
    });
    useProjectStore
      .getState()
      .setLayerMask(target, { sourceLayerId: source, mode: 'alpha', inverted: false });
    const current = useProjectStore.getState(),
      c = getActiveComposition(current.project, current.activeCompositionId);
    expect(c.layers.find((l) => l.id === target)!.element).toMatchObject({
      type: 'path',
      fill: { type: 'radial' },
    });
    expect(c.layers.find((l) => l.id === source)!.isMaskOnly).toBe(true);
    expect(() =>
      useProjectStore
        .getState()
        .setLayerMask(source, { sourceLayerId: target, mode: 'alpha', inverted: false }),
    ).toThrow('cyclic');
    expect(() => useProjectStore.getState().removeLayer(source)).toThrow('Detach masks');
    useProjectStore.getState().setLayerMask(target, null);
    useProjectStore.getState().removeLayer(source);
    expect(
      getActiveComposition(
        useProjectStore.getState().project,
        current.activeCompositionId,
      ).layers.find((l) => l.id === source),
    ).toBeUndefined();
  });

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
