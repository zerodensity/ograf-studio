import { beforeEach, describe, expect, it } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import { getActiveComposition, useProjectStore } from './projectStore';

describe('text path lifecycle', () => {
  beforeEach(() => useProjectStore.getState().newProject());
  it('validates path targets, remaps copied sources and detaches deleted ones', () => {
    const store = useProjectStore.getState();
    const pathId = store.addLayer('path');
    const textId = store.addLayer('text');
    store.setLayerTextPath(textId, { sourceLayerId: pathId, startOffset: 0, alignment: 'start' });
    expect(() =>
      store.setLayerTextPath(textId, { sourceLayerId: textId, startOffset: 0, alignment: 'start' }),
    ).toThrow();
    const ids = useProjectStore.getState().duplicateLayers([pathId, textId]);
    let state = useProjectStore.getState();
    let composition = getActiveComposition(state.project, state.activeCompositionId);
    const copiedPath = composition.layers.find(
      (layer) => ids.includes(layer.id) && layer.element.type === 'path',
    )!;
    const copiedText = composition.layers.find(
      (layer) => ids.includes(layer.id) && layer.element.type === 'text',
    )!;
    expect(copiedText.textPath?.sourceLayerId).toBe(copiedPath.id);
    expect(
      compileDescriptor(composition).layers.find((layer) => layer.id === textId)?.textPath
        ?.sourceLayerId,
    ).toBe(pathId);
    state.removeLayer(pathId);
    state = useProjectStore.getState();
    composition = getActiveComposition(state.project, state.activeCompositionId);
    expect(composition.layers.find((layer) => layer.id === textId)?.textPath).toBeNull();
    expect(
      composition.layers.find((layer) => layer.id === copiedText.id)?.textPath?.sourceLayerId,
    ).toBe(copiedPath.id);
  });
});
