import { describe, expect, it } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  computeKeyframeFrames,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  defaultTransformForRole,
} from '@ograf-editor/scene-model';
import { expandRuntimeCollections, isRuntimeCollectionLayerActive } from './runtimeCollections';

describe('runtime collection expansion', () => {
  it('creates bounded item-major layers with remapped clipping, paths, and offsets', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('array', {
      key: 'leaderboard',
      constraints: { minItems: 0, maxItems: 3 },
      items: createFieldDefinition('object', {
        key: 'item',
        properties: [createFieldDefinition('text', { key: 'name' })],
        defaultValue: { name: '' },
      }),
    });
    const plate = createLayerOfKind('rectangle');
    const label = createLayerOfKind('text');
    plate.groupId = 'item-group';
    plate.clipChildren = true;
    label.groupId = 'item-group';
    label.parentId = plate.id;
    label.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    for (const layer of [plate, label]) {
      layer.keyframes = composition.keyframes.map((keyframe, index) =>
        createLayerKeyframe(
          computeKeyframeFrames(composition)[index]!.frame,
          defaultTransformForRole(layer.element.type, keyframe.role),
        ),
      );
    }
    composition.layers = [plate, label];
    composition.dataFields = [field];
    composition.runtimeCollections = [
      {
        id: 'collection',
        name: 'Leaderboard',
        fieldId: field.id,
        prototypeLayerIds: [plate.id, label.id],
        offsetPerItem: { x: 20, y: 70 },
        capacity: 3,
        overflow: 'truncate',
      },
    ];

    const compiled = compileDescriptor(composition);
    expect(compiled.layers).toEqual([]);
    expect(compiled.collections?.[0]?.prototypeLayers).toHaveLength(2);
    const expanded = expandRuntimeCollections(compiled);
    expect(expanded.layers).toHaveLength(6);
    const firstPlate = expanded.layers[0]!;
    const firstLabel = expanded.layers[1]!;
    const secondPlate = expanded.layers[2]!;
    const secondLabel = expanded.layers[3]!;
    expect(firstLabel.clipParentId).toBe(firstPlate.id);
    expect(secondLabel.clipParentId).toBe(secondPlate.id);
    expect(secondLabel.bindings[0]).toMatchObject({
      dataKey: 'leaderboard',
      sourcePath: ['name'],
      itemIndex: 1,
    });
    expect(secondLabel.collectionItem).toEqual({
      collectionId: 'collection',
      dataKey: 'leaderboard',
      index: 1,
    });
    expect(secondLabel.keyframes[0]!.transform.x - firstLabel.keyframes[0]!.transform.x).toBe(20);
    expect(secondLabel.keyframes[0]!.transform.y - firstLabel.keyframes[0]!.transform.y).toBe(70);
    expect(isRuntimeCollectionLayerActive(firstLabel, { leaderboard: [] })).toBe(false);
    expect(isRuntimeCollectionLayerActive(firstLabel, { leaderboard: [{ name: 'Ada' }] })).toBe(
      true,
    );
    expect(isRuntimeCollectionLayerActive(secondLabel, { leaderboard: [{ name: 'Ada' }] })).toBe(
      false,
    );
  });
});
