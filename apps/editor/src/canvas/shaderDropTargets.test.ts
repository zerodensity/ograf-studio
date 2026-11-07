import { describe, expect, it } from 'vitest';
import { createComposition, createLayerOfKind } from '@ograf-editor/scene-model';
import { shaderDropTargetIds } from './shaderDropTargets';

function fixture() {
  const composition = createComposition();
  const layers = Array.from({ length: 3 }, () => createLayerOfKind('rectangle'));
  composition.layers = layers;
  return { composition, layers };
}

describe('canvas shader drop targets', () => {
  it('targets another hit object instead of an unrelated selection', () => {
    const { composition, layers } = fixture();
    expect(shaderDropTargetIds(composition, [layers[0]!.id], layers[1]!.id)).toEqual([
      layers[1]!.id,
    ]);
  });
  it('retains a multiple selection when dropping onto one of its objects', () => {
    const { composition, layers } = fixture();
    const ids = [layers[0]!.id, layers[1]!.id];
    expect(shaderDropTargetIds(composition, ids, layers[1]!.id)).toEqual(ids);
  });
  it('uses selected objects on empty canvas space and does not invent a new layer', () => {
    const { composition, layers } = fixture();
    expect(shaderDropTargetIds(composition, [layers[0]!.id, layers[0]!.id])).toEqual([
      layers[0]!.id,
    ]);
    expect(shaderDropTargetIds(composition, [])).toEqual([]);
    expect(composition.layers).toHaveLength(3);
  });
  it('expands a persistent group just like normal canvas selection', () => {
    const { composition, layers } = fixture();
    layers[0]!.groupId = 'group';
    layers[1]!.groupId = 'group';
    expect(shaderDropTargetIds(composition, [layers[2]!.id], layers[0]!.id)).toEqual([
      layers[0]!.id,
      layers[1]!.id,
    ]);
  });
});
