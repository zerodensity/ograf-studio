import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addLayerModifier, layerModifiersErrors, type Layer } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { getHistorySnapshot, resetHistory } from './historyStore';

vi.stubGlobal('window', { clearTimeout });
const active = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};
const link = (sourceLayerId: string, orientToPath = true): NonNullable<Layer['motionPath']> => ({
  sourceLayerId,
  orientToPath,
  progress: 0.25,
  offsetX: 12,
  offsetY: -6,
  rotationOffset: 35,
});

describe('Spline Path editing beside the modifier stack', () => {
  let ownerId: string;
  let pathId: string;
  let targetId: string;
  beforeEach(() => {
    useProjectStore.getState().newProject();
    ownerId = useProjectStore.getState().addLayer('rectangle');
    pathId = useProjectStore.getState().addLayer('path');
    targetId = useProjectStore.getState().addLayer('text');
    resetHistory();
  });
  const draft = (mutate: (owner: Layer, layers: Layer[]) => void) => {
    const project = structuredClone(useProjectStore.getState().project);
    const layers = getActiveComposition(
      project,
      useProjectStore.getState().activeCompositionId,
    ).layers;
    mutate(
      layers.find((layer) => layer.id === ownerId)!,
      layers,
    );
    useProjectStore.setState({ project });
    resetHistory();
  };

  it('retains the source, tangent orientation and base rotation as authored', () => {
    const authored = structuredClone(
      active().layers.find((layer) => layer.id === ownerId)!.keyframes,
    );
    useProjectStore.getState().setLayerMotionPath(ownerId, link(pathId));
    const owner = active().layers.find((layer) => layer.id === ownerId)!;
    expect(owner.motionPath).toEqual(link(pathId));
    expect(owner.keyframes).toEqual(authored);
    expect(layerModifiersErrors(active().layers, active().dataFields)).toEqual([]);
    expect(getHistorySnapshot().past).toHaveLength(1);
  });

  it('rejects conflicting position drivers atomically, including via the Properties entry point', () => {
    draft((owner) =>
      addLayerModifier(owner, 'auto-follow', {
        source: { kind: 'layer', layerId: targetId },
      }),
    );
    const before = useProjectStore.getState().project;
    expect(() => useProjectStore.getState().setLayerMotionPath(ownerId, link(pathId))).toThrow(
      /geometry modifier with a motion path/,
    );
    expect(useProjectStore.getState().project).toBe(before);
    expect(getHistorySnapshot().past).toHaveLength(0);
  });

  it('permits Look At with an unoriented path and rejects a second rotation driver', () => {
    draft((owner) =>
      addLayerModifier(owner, 'look-at', {
        source: { kind: 'layer', layerId: targetId },
      }),
    );
    useProjectStore.getState().setLayerMotionPath(ownerId, link(pathId, false));
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore.getState().setLayerMotionPath(ownerId, link(pathId, true)),
    ).toThrow(/Look At.*orients/);
    expect(useProjectStore.getState().project).toBe(before);
    expect(active().layers.find((layer) => layer.id === ownerId)!.motionPath!.orientToPath).toBe(
      false,
    );
  });

  it('rejects Spline Path on a child whose position is owned by Grid Arrange', () => {
    draft((owner, layers) => {
      const container = layers.find((layer) => layer.id === targetId)!;
      addLayerModifier(container, 'grid-arrange');
      owner.parentId = container.id;
    });
    const before = useProjectStore.getState().project;
    expect(() => useProjectStore.getState().setLayerMotionPath(ownerId, link(pathId))).toThrow(
      /arranges it/,
    );
    expect(useProjectStore.getState().project).toBe(before);
  });

  it('rejects the inverse arrangement edit when a child already follows a path', () => {
    useProjectStore.getState().setLayerMotionPath(ownerId, link(pathId));
    draft((_owner, layers) => {
      addLayerModifier(
        layers.find((layer) => layer.id === targetId)!,
        'grid-arrange',
      );
    });
    const before = useProjectStore.getState().project;
    expect(() => useProjectStore.getState().setLayerParent(ownerId, targetId)).toThrow(
      /arranges it/,
    );
    expect(useProjectStore.getState().project).toBe(before);
    expect(getHistorySnapshot().past).toHaveLength(0);
  });

  it('rejects Auto Layout enabled after a container modifier or Follow modifier', () => {
    for (const type of ['grid-arrange', 'radial-arrange', 'justify', 'auto-follow'] as const) {
      draft((owner) => {
        owner.modifiers = [];
        addLayerModifier(
          owner,
          type,
          type === 'auto-follow' ? { source: { kind: 'layer', layerId: targetId } } : {},
        );
      });
      const before = useProjectStore.getState().project;
      expect(() =>
        useProjectStore.getState().setLayerAutoLayout(ownerId, { direction: 'horizontal' }),
      ).toThrow(/conflicting Auto Layout/);
      expect(useProjectStore.getState().project).toBe(before);
      expect(getHistorySnapshot().past).toHaveLength(0);
    }
  });

  it('rejects parenting a Follow-driven object into an active Auto Layout', () => {
    useProjectStore.getState().setLayerAutoLayout(targetId, { direction: 'vertical' });
    draft((owner) =>
      addLayerModifier(owner, 'auto-follow', {
        source: { kind: 'layer', layerId: targetId },
      }),
    );
    const before = useProjectStore.getState().project;
    expect(() => useProjectStore.getState().setLayerParent(ownerId, targetId)).toThrow(
      /conflicting Auto Layout/,
    );
    expect(useProjectStore.getState().project).toBe(before);
  });

  it('rejects non-finite or out-of-range controls without publishing an invalid project', () => {
    for (const patch of [
      { progress: -0.1 },
      { progress: 1.1 },
      { progress: NaN },
      { offsetX: Infinity },
      { rotationOffset: 361 },
      { orientToPath: 'true' },
    ]) {
      const before = useProjectStore.getState().project;
      expect(() =>
        useProjectStore
          .getState()
          .setLayerMotionPath(ownerId, { ...link(pathId), ...patch } as never),
      ).toThrow(/valid Spline Path/);
      expect(useProjectStore.getState().project).toBe(before);
    }
  });
});
