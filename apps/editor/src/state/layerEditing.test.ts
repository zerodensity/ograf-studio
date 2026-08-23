import { beforeEach, describe, expect, it } from 'vitest';
import { findLayerKeyframeAtFrame } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';

function activeComposition() {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
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
