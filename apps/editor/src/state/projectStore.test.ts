import { beforeEach, describe, expect, it } from 'vitest';
import { getLayerPropertyValueAtFrame } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';

describe('project store text stroke authoring', () => {
  beforeEach(() => useProjectStore.getState().newProject());

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
});
