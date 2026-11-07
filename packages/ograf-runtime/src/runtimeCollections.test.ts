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
import {
  expandRuntimeCollections,
  isRuntimeCollectionLayerActive,
  runtimeCollectionItemSelection,
} from './runtimeCollections';
import { resolveBoundElement } from './renderElement';

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
    label.mask = { sourceLayerId: plate.id, mode: 'alpha', inverted: false };
    plate.isMaskOnly = true;
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
        itemKeyPath: [],
        sortPath: [],
        sortDirection: 'none',
        pageSize: 0,
        page: 0,
      },
    ];

    const compiled = compileDescriptor(composition);
    compiled.collections![0]!.prototypeLayers[1]!.visualRules = [
      {
        id: 'alarm',
        name: 'Alarm',
        enabled: true,
        trigger: 'timer-alarm',
        timerAlarm: { sourceLayerId: label.id, thresholdMs: 0, direction: 'down' },
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [],
      },
    ];
    const masked = expandRuntimeCollections(compiled);
    for (let index = 0; index < 3; index++) {
      expect(masked.layers[index * 2 + 1]!.mask!.sourceLayerId).toBe(masked.layers[index * 2]!.id);
      expect(masked.layers[index * 2]!.isMaskOnly).toBe(true);
      expect(masked.layers[index * 2 + 1]!.visualRules![0]!.timerAlarm!.sourceLayerId).toBe(
        masked.layers[index * 2 + 1]!.id,
      );
    }
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
    expect(secondLabel.collectionItem).toMatchObject({
      collectionId: 'collection',
      dataKey: 'leaderboard',
      slot: 1,
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

  it('sorts, paginates, and retains stable item keys while resolving bindings', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('array', {
      key: 'leaderboard',
      items: createFieldDefinition('object', {
        key: 'item',
        properties: [
          createFieldDefinition('text', { key: 'id' }),
          createFieldDefinition('text', { key: 'name' }),
          createFieldDefinition('integer', { key: 'score' }),
        ],
      }),
    });
    const label = createLayerOfKind('text');
    label.groupId = 'item';
    label.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    composition.layers = [label];
    composition.dataFields = [field];
    composition.runtimeCollections = [
      {
        id: 'ranking',
        name: 'Ranking',
        fieldId: field.id,
        prototypeLayerIds: [label.id],
        offsetPerItem: { x: 0, y: 40 },
        capacity: 2,
        overflow: 'truncate',
        itemKeyPath: ['id'],
        sortPath: ['score'],
        sortDirection: 'descending',
        pageSize: 1,
        page: 1,
      },
    ];
    const [slot] = expandRuntimeCollections(compileDescriptor(composition)).layers;
    const data = {
      leaderboard: [
        { id: 'a', name: 'Ada', score: 5 },
        { id: 'b', name: 'Bea', score: 9 },
        { id: 'c', name: 'Cy', score: 7 },
      ],
    };
    expect(runtimeCollectionItemSelection(slot!, data)).toEqual({ index: 2, key: 'c' });
    expect(resolveBoundElement(slot!, data)).toMatchObject({ content: 'Cy' });
  });
});
