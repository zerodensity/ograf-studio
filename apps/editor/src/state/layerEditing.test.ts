import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createLayerPropertyKeyframe,
  findLayerKeyframeAtFrame,
  type Layer,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';

function activeComposition() {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
}

function positionSignature(layer: Layer) {
  const track = (property: 'x' | 'y') =>
    (layer.animationTracks[property] ?? []).map(({ frame, value, easing, curve }) => ({
      frame,
      value,
      easing,
      curve,
    }));
  const loopTrack = (property: 'x' | 'y') =>
    (layer.loop?.tracks[property] ?? []).map(({ frame, value, easing, curve }) => ({
      frame,
      value,
      easing,
      curve,
    }));
  return {
    keyframes: layer.keyframes.map(({ frame, transform }) => ({
      frame,
      x: transform.x,
      y: transform.y,
    })),
    x: track('x'),
    y: track('y'),
    loopX: loopTrack('x'),
    loopY: loopTrack('y'),
  };
}

describe('layer editing commands', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('pastes independent layer copies with fresh IDs and an offset', () => {
    const sourceId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().updateLayerTransform(sourceId, 7, { x: 321, y: 222 });
    const source = structuredClone(
      activeComposition().layers.find((layer) => layer.id === sourceId)!,
    );

    const [firstCopyId] = useProjectStore.getState().pasteLayers([source]);
    const [secondCopyId] = useProjectStore.getState().pasteLayers([source]);
    const firstCopy = activeComposition().layers.find((layer) => layer.id === firstCopyId)!;
    const secondCopy = activeComposition().layers.find((layer) => layer.id === secondCopyId)!;

    expect(firstCopy.id).not.toBe(source.id);
    expect(firstCopy.name).toBe('Rectangle copy');
    expect(secondCopy.name).toBe('Rectangle copy 2');
    expect(firstCopy.keyframes.map((keyframe) => keyframe.id)).not.toEqual(
      source.keyframes.map((keyframe) => keyframe.id),
    );
    expect(findLayerKeyframeAtFrame(firstCopy, 7)?.transform).toMatchObject({ x: 341, y: 242 });
    expect(firstCopy.element).toEqual(source.element);
  });

  it('duplicates a complete persistent group at the exact authored position', () => {
    const store = useProjectStore.getState();
    const parentId = store.addLayer('rectangle');
    const childId = store.addLayer('ellipse');
    store.setLayerParent(childId, parentId);
    store.setLayerMask(parentId, {
      sourceLayerId: childId,
      mode: 'alpha',
      inverted: false,
    });
    const sourceGroupId = store.groupLayers([parentId, childId]);
    store.updateLayerTransform(parentId, 7, { x: 321, y: 222 });
    store.setLayerLoop(parentId, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(parentId, 'x', [
      createLayerPropertyKeyframe(0, 321),
      createLayerPropertyKeyframe(10, 361),
    ]);

    const before = activeComposition();
    const originals = before.layers.filter((layer) => [parentId, childId].includes(layer.id));
    const copiedIds = useProjectStore.getState().duplicateLayers([childId]);
    const after = activeComposition();
    const copies = copiedIds.map((id) => after.layers.find((layer) => layer.id === id)!);

    expect(copiedIds).toHaveLength(2);
    expect(after.layers.map((layer) => layer.id)).toEqual([parentId, childId, ...copiedIds]);
    expect(copies.map(positionSignature)).toEqual(originals.map(positionSignature));
    expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
    expect(copies[0]!.groupId).not.toBe(sourceGroupId);
    expect(copies[1]!.parentId).toBe(copies[0]!.id);
    expect(copies[0]!.mask?.sourceLayerId).toBe(copies[1]!.id);
    expect(copies.flatMap((layer) => layer.keyframes.map((keyframe) => keyframe.id))).not.toEqual(
      originals.flatMap((layer) => layer.keyframes.map((keyframe) => keyframe.id)),
    );
  });

  it('inserts each duplicate directly above its source in paint order', () => {
    const store = useProjectStore.getState();
    const backId = store.addLayer('rectangle');
    const middleId = store.addLayer('text');
    const frontId = store.addLayer('ellipse');

    const [copyId] = useProjectStore.getState().duplicateLayers([middleId]);

    expect(activeComposition().layers.map((layer) => layer.id)).toEqual([
      backId,
      middleId,
      copyId,
      frontId,
    ]);
  });

  it('duplicates complete linked instances with fresh instance and field IDs', () => {
    const store = useProjectStore.getState();
    const panelId = store.addLayer('rectangle');
    const labelId = store.addLayer('text');
    store.setLayerParent(labelId, panelId);
    const fieldId = store.addDataField('object');
    store.updateDataField(fieldId, {
      properties: [createFieldDefinition('text', { key: 'headline', label: 'Headline' })],
      defaultValue: { headline: 'Live' },
    });
    store.setLayerBindings(labelId, [
      { fieldId, targetProperty: 'content', sourcePath: ['headline'] },
    ]);
    const componentId = store.createComponent([panelId, labelId], 'Bound title')!;
    const instanceIds = store.instantiateComponent(componentId, { x: 90, y: 30 }, true);
    const originalInstance = activeComposition().layers.filter((layer) =>
      instanceIds.includes(layer.id),
    );
    const originalLinkId = originalInstance[0]!.componentLink!.instanceId;
    const originalFieldId = originalInstance[1]!.bindings[0]!.fieldId;
    const fieldCount = activeComposition().dataFields.length;

    const copiedIds = useProjectStore.getState().duplicateLayers([instanceIds[0]!]);
    let composition = activeComposition();
    const copies = copiedIds.map((id) => composition.layers.find((layer) => layer.id === id)!);
    const copiedLinkIds = new Set(copies.map((layer) => layer.componentLink?.instanceId));
    const copiedFieldId = copies.find((layer) => layer.bindings.length > 0)!.bindings[0]!.fieldId;

    expect(copiedIds).toHaveLength(2);
    expect(copies.map(positionSignature)).toEqual(originalInstance.map(positionSignature));
    expect(copiedLinkIds.size).toBe(1);
    expect([...copiedLinkIds][0]).not.toBe(originalLinkId);
    expect(copiedFieldId).not.toBe(originalFieldId);
    expect(composition.dataFields).toHaveLength(fieldCount + 1);
    expect(composition.dataFields.find((field) => field.id === copiedFieldId)?.key).not.toBe(
      composition.dataFields.find((field) => field.id === originalFieldId)?.key,
    );
    expect(
      composition.dataFields.find((field) => field.id === copiedFieldId)?.properties[0]?.id,
    ).not.toBe(
      composition.dataFields.find((field) => field.id === originalFieldId)?.properties[0]?.id,
    );

    const refreshedIds = useProjectStore.getState().refreshLinkedComponentInstances(componentId);
    composition = activeComposition();
    expect(refreshedIds).toHaveLength(4);
    expect(
      new Set(
        composition.layers
          .filter((layer) => layer.componentLink?.componentId === componentId)
          .map((layer) => layer.componentLink!.instanceId),
      ).size,
    ).toBe(2);
  });

  it('detaches an incomplete linked instance copy', () => {
    const store = useProjectStore.getState();
    const panelId = store.addLayer('rectangle');
    const labelId = store.addLayer('text');
    const componentId = store.createComponent([panelId, labelId], 'Split title')!;
    const instanceIds = store.instantiateComponent(componentId, undefined, true);
    store.ungroupLayers(instanceIds);

    const [copyId] = useProjectStore.getState().duplicateLayers([instanceIds[0]!]);
    const copy = activeComposition().layers.find((layer) => layer.id === copyId)!;

    expect(copy.componentLink).toBeNull();
    expect(copy.groupId).toBeNull();
  });

  it('drops bindings whose fields do not exist in the destination project', () => {
    const store = useProjectStore.getState();
    const sourceId = store.addLayer('text');
    const fieldId = store.addDataField('text');
    store.setLayerBindings(sourceId, [{ fieldId, targetProperty: 'content' }]);
    const source = structuredClone(activeComposition().layers[0]!);

    store.newProject();
    const [copyId] = useProjectStore.getState().pasteLayers([source]);
    const copy = activeComposition().layers.find((layer) => layer.id === copyId)!;

    expect(copy.bindings).toEqual([]);
  });

  it('drops a pasted mask whose source does not exist in the destination project', () => {
    const store = useProjectStore.getState();
    const sourceId = store.addLayer('ellipse');
    const consumerId = store.addLayer('rectangle');
    store.setLayerMask(consumerId, {
      sourceLayerId: sourceId,
      mode: 'alpha',
      inverted: false,
    });
    const consumer = structuredClone(
      activeComposition().layers.find((layer) => layer.id === consumerId)!,
    );

    store.newProject();
    const [copyId] = useProjectStore.getState().pasteLayers([consumer]);
    const copy = activeComposition().layers.find((layer) => layer.id === copyId)!;

    expect(copy.mask).toBeNull();
  });

  it('distinguishes a held frame from an evaluated keyframe', () => {
    const holdLayerId = useProjectStore.getState().addLayer('rectangle');
    const sampledLayerId = useProjectStore.getState().addLayer('rectangle');
    for (const layerId of [holdLayerId, sampledLayerId]) {
      useProjectStore.getState().updateLayerTransform(layerId, 0, { x: 0 });
      useProjectStore.getState().updateLayerTransform(layerId, 12, { x: 120 });
    }

    const holdId = useProjectStore.getState().addLayerHoldFrame(holdLayerId, 6);
    const sampledId = useProjectStore.getState().addLayerKeyframe(sampledLayerId, 6);
    const holdLayer = activeComposition().layers.find((layer) => layer.id === holdLayerId)!;
    const sampledLayer = activeComposition().layers.find((layer) => layer.id === sampledLayerId)!;

    expect(holdLayer.keyframes.find((keyframe) => keyframe.id === holdId)?.transform.x).toBe(0);
    expect(sampledLayer.keyframes.find((keyframe) => keyframe.id === sampledId)?.transform.x).toBe(
      60,
    );
  });

  it('persists groups, prevents locked transforms, and cascades parent translation', () => {
    const parentId = useProjectStore.getState().addLayer('rectangle');
    const childId = useProjectStore.getState().addLayer('text');
    const groupId = useProjectStore.getState().groupLayers([parentId, childId]);
    useProjectStore.getState().setLayerParent(childId, parentId);
    useProjectStore.getState().updateLayerTransform(parentId, 12, { x: 300, y: 250 });
    let composition = activeComposition();
    const parent = composition.layers.find((layer) => layer.id === parentId)!;
    const child = composition.layers.find((layer) => layer.id === childId)!;
    expect(parent.groupId).toBe(groupId);
    expect(child).toMatchObject({ groupId, parentId });
    expect(findLayerKeyframeAtFrame(child, 12)?.transform).toMatchObject({ x: 300, y: 250 });

    useProjectStore.getState().toggleLayerLock(parentId);
    useProjectStore.getState().updateLayerTransform(parentId, 12, { x: 900 });
    composition = activeComposition();
    expect(findLayerKeyframeAtFrame(composition.layers[0]!, 12)?.transform.x).toBe(300);

    useProjectStore.getState().ungroupLayers([childId]);
    composition = activeComposition();
    expect(composition.layers.map((layer) => layer.groupId)).toEqual([null, null]);
  });

  it('saves selected layers as a reusable component and inserts independent instances', () => {
    const parentId = useProjectStore.getState().addLayer('rectangle');
    const childId = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().setLayerParent(childId, parentId);
    const componentId = useProjectStore
      .getState()
      .createComponent([parentId, childId], 'Lower third block');
    expect(componentId).toBeTruthy();
    expect(activeComposition().components[0]).toMatchObject({
      id: componentId,
      name: 'Lower third block',
    });

    const instanceIds = useProjectStore
      .getState()
      .instantiateComponent(componentId!, { x: 60, y: 30 });
    const instanceLayers = activeComposition().layers.filter((layer) =>
      instanceIds.includes(layer.id),
    );
    expect(instanceLayers).toHaveLength(2);
    expect(new Set(instanceLayers.map((layer) => layer.groupId)).size).toBe(1);
    expect(instanceLayers[1]!.parentId).toBe(instanceLayers[0]!.id);
    expect(findLayerKeyframeAtFrame(instanceLayers[0]!, 12)?.transform).toMatchObject({
      x: 160,
      y: 130,
    });

    useProjectStore.getState().removeComponent(componentId!);
    expect(activeComposition().components).toHaveLength(0);
    expect(
      activeComposition().layers.filter((layer) => instanceIds.includes(layer.id)),
    ).toHaveLength(2);
  });

  it('organizes layers in editor-only timeline folders without changing layer data', () => {
    const firstId = useProjectStore.getState().addLayer('rectangle');
    const secondId = useProjectStore.getState().addLayer('text');
    const layersBefore = structuredClone(activeComposition().layers);

    const folderId = useProjectStore.getState().createTimelineFolder([firstId, secondId]);
    useProjectStore.getState().renameTimelineFolder(folderId!, 'Monday');
    useProjectStore.getState().setTimelineFolderColor(folderId!, '#123abc');

    let composition = activeComposition();
    expect(composition.layers).toEqual(layersBefore);
    expect(composition.layout.timelineFolders).toEqual([
      { id: folderId, name: 'Monday', color: '#123abc', layerIds: [firstId, secondId] },
    ]);

    useProjectStore.getState().removeLayer(firstId);
    composition = activeComposition();
    expect(composition.layout.timelineFolders[0]?.layerIds).toEqual([secondId]);

    useProjectStore.getState().removeTimelineFolder(folderId!);
    expect(activeComposition().layout.timelineFolders).toEqual([]);
    expect(activeComposition().layers.map((layer) => layer.id)).toEqual([secondId]);
  });

  it('bakes constraints into every relevant key when composition dimensions change', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().setLayerConstraints(layerId, {
      horizontal: 'right',
      vertical: 'bottom',
    });
    useProjectStore.getState().updateLayerTransform(layerId, 6, { x: 100, y: 80 });
    useProjectStore.getState().updateCompositionSettings({ width: 2020, height: 1180 });
    const layer = activeComposition().layers[0]!;
    expect(findLayerKeyframeAtFrame(layer, 6)?.transform).toMatchObject({ x: 200, y: 180 });
    expect(findLayerKeyframeAtFrame(layer, 12)?.transform).toMatchObject({ x: 200, y: 200 });
  });

  it('aligns and distributes unlocked layers at one frame', () => {
    const ids = ['rectangle', 'ellipse', 'text'].map((kind) =>
      useProjectStore.getState().addLayer(kind as 'rectangle' | 'ellipse' | 'text'),
    );
    ids.forEach((id, index) =>
      useProjectStore.getState().updateLayerTransform(id, 12, { x: index * 300, width: 100 }),
    );
    useProjectStore.getState().alignLayers(ids, 12, 'top');
    useProjectStore.getState().distributeLayers(ids, 12, 'horizontal');
    const poses = activeComposition().layers.map(
      (layer) => findLayerKeyframeAtFrame(layer, 12)!.transform,
    );
    expect(poses.map((pose) => pose.y)).toEqual([100, 100, 100]);
    expect(poses.map((pose) => pose.x)).toEqual([0, 300, 600]);
  });
});
