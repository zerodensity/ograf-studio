import { beforeEach, describe, expect, it } from 'vitest';
import { getActiveComposition, useProjectStore } from './projectStore';

const composition = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};

describe('Editable in playout', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('creates one field named after the layer and removes it again', () => {
    const layerId = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().renameLayer(layerId, 'Guest name');
    useProjectStore.getState().setLayerPlayoutEditable(layerId, true);
    useProjectStore.getState().setLayerPlayoutEditable(layerId, true);

    const field = composition().dataFields[0]!;
    const layer = composition().layers[0]!;
    expect(composition().dataFields).toHaveLength(1);
    expect(field).toMatchObject({ key: 'guest_name', label: 'Guest name', type: 'text' });
    expect(field.defaultValue).toBe(layer.element.type === 'text' ? layer.element.content : null);
    expect(layer.bindings).toEqual([{ fieldId: field.id, targetProperty: 'content' }]);

    useProjectStore.getState().setLayerPlayoutEditable(layerId, false);
    expect(composition().layers[0]!.bindings).toEqual([]);
    expect(composition().dataFields).toEqual([]);
  });

  it('keeps a field another layer still reads', () => {
    const first = useProjectStore.getState().addLayer('text');
    const second = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().setLayerPlayoutEditable(first, true);
    const fieldId = composition().dataFields[0]!.id;
    useProjectStore.getState().setLayerBindings(second, [{ fieldId, targetProperty: 'content' }]);

    useProjectStore.getState().setLayerPlayoutEditable(first, false);
    expect(composition().dataFields.map((field) => field.id)).toEqual([fieldId]);
  });

  it('binds an image layer source', () => {
    const layerId = useProjectStore.getState().addLayer('image');
    useProjectStore.getState().setLayerPlayoutEditable(layerId, true);
    expect(composition().dataFields[0]).toMatchObject({ type: 'image-url' });
    expect(composition().layers[0]!.bindings[0]).toMatchObject({ targetProperty: 'src' });
  });
});
