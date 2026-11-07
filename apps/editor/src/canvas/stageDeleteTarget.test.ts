import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  defaultTransformFor,
} from '@ograf-editor/scene-model';
import { stageDeleteTarget } from './stageDeleteTarget';

function fixture() {
  const composition = createComposition();
  const layer = createLayerOfKind('rectangle');
  const first = createLayerKeyframe(0, defaultTransformFor('rectangle'));
  const second = createLayerKeyframe(10, defaultTransformFor('rectangle'));
  const firstX = createLayerPropertyKeyframe(0, 10);
  const secondX = createLayerPropertyKeyframe(10, 20);
  layer.keyframes = [first, second];
  layer.animationTracks = { x: [firstX, secondX] };
  composition.layers = [layer];
  const selection = {
    selectedLayerId: layer.id,
    selectedLayerIds: [layer.id],
    selectedLayerKeyframeId: second.id,
    selectedLayerProperty: null,
  };
  return { composition, layer, first, second, firstX, secondX, selection };
}

describe('canvas Delete key target', () => {
  it('routes layer and property keys to their respective removal operations', () => {
    const { composition, layer, second, secondX, selection } = fixture();
    expect(stageDeleteTarget(composition, selection)).toEqual({
      kind: 'layer-key',
      layerId: layer.id,
      keyframeId: second.id,
    });
    expect(
      stageDeleteTarget(composition, {
        ...selection,
        selectedLayerProperty: 'x',
        selectedLayerKeyframeId: secondX.id,
      }),
    ).toEqual({ kind: 'property-key', layerId: layer.id, keyframeId: secondX.id, property: 'x' });
  });

  it('does not turn stale, locked or last protected key selections into object deletion', () => {
    const { composition, layer, first, secondX, selection } = fixture();
    expect(
      stageDeleteTarget(composition, { ...selection, selectedLayerKeyframeId: 'missing' }),
    ).toEqual({ kind: 'blocked-key' });
    layer.isLocked = true;
    expect(stageDeleteTarget(composition, selection)).toEqual({ kind: 'blocked-key' });
    layer.isLocked = false;
    layer.keyframes = [first];
    expect(
      stageDeleteTarget(composition, { ...selection, selectedLayerKeyframeId: first.id }),
    ).toEqual({ kind: 'blocked-key' });
    layer.animationTracks.x = [secondX];
    expect(
      stageDeleteTarget(composition, {
        ...selection,
        selectedLayerProperty: 'x',
        selectedLayerKeyframeId: secondX.id,
      }),
    ).toEqual({ kind: 'blocked-key' });
  });

  it('keeps ordinary object deletion when no key is selected', () => {
    const { composition, layer, selection } = fixture();
    expect(stageDeleteTarget(composition, { ...selection, selectedLayerKeyframeId: null })).toEqual(
      { kind: 'layers', layerIds: [layer.id] },
    );
  });
});
