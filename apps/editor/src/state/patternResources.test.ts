import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  getLayerTransformAtFrame,
  getPatternPresetPatch,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';

const composition = () => useProjectStore.getState().project.compositions[0]!;
beforeEach(() => useProjectStore.getState().newProject());

describe('visual pattern resource authoring', () => {
  it('applies optional positions and group membership across new pattern entry points', () => {
    const store = useProjectStore.getState();
    const placement = { x: 312, y: 128, groupId: 'group-placement' };
    const { patternId, layerId } = store.createPatternResource(
      getPatternPresetPatch('dots', 800, 400, 25),
      true,
      placement,
    );
    const ids = [
      layerId!,
      store.addPatternInstance(patternId, placement),
      store.addLayer('pattern', placement),
    ];
    for (const id of ids) {
      const layer = composition().layers.find((candidate) => candidate.id === id)!;
      expect(layer.groupId).toBe(placement.groupId);
      expect(layer.animationTrackMode).toBe('independent');
      expect(layer.animationTracks).toEqual({});
      for (const { frame } of computeKeyframeFrames(composition()))
        expect(getLayerTransformAtFrame(layer, frame)).toMatchObject({ x: 312, y: 128 });
    }
  });
  it('creates a named preset and its linked layer atomically without O/D symbols', () => {
    const { patternId, layerId } = useProjectStore
      .getState()
      .createPatternResource(getPatternPresetPatch('dots', 1920, 1080, 25));
    expect(composition().patterns).toHaveLength(1);
    expect(composition().layers.find((layer) => layer.id === layerId)?.element).toMatchObject({
      type: 'pattern',
      patternId,
    });
    expect(composition().patterns[0]!.symbols.map((symbol) => symbol.key)).not.toContain('O');
    expect(composition().patterns[0]!.symbols.map((symbol) => symbol.key)).not.toContain('D');
    const snapshot = useProjectStore.getState().project;
    expect(() => useProjectStore.getState().createPatternResource({ rows: 0 })).toThrow();
    expect(useProjectStore.getState().project).toBe(snapshot);
  });
  it('duplicates a resource independently without placing another layer or changing the source', () => {
    const store = useProjectStore.getState();
    const source = store.createPatternResource(
      getPatternPresetPatch('dots', 1920, 1080, 25),
      false,
    );
    const copyId = store.duplicatePatternResource(source.patternId);
    const anotherId = store.duplicatePatternResource(source.patternId);
    expect(composition().layers).toHaveLength(0);
    expect(new Set(composition().patterns.map((pattern) => pattern.name)).size).toBe(3);
    expect(copyId).not.toBe(anotherId);
    store.setTilingPattern({ gap: 123 }, copyId);
    expect(composition().patterns.find((pattern) => pattern.id === source.patternId)!.gap).not.toBe(
      123,
    );
  });
  it('makes only the chosen layer independent, preserving its paint, tracks and shared source', () => {
    const store = useProjectStore.getState();
    const { patternId, layerId } = store.createPatternResource(
      getPatternPresetPatch('dots', 1920, 1080, 25),
    );
    const second = store.addPatternInstance(patternId);
    store.updateLayerPaint(layerId!, 0, '#ffaa33');
    const before = structuredClone(composition().layers.find((layer) => layer.id === layerId)!);
    const copyId = store.makePatternIndependent(layerId!);
    const after = composition().layers.find((layer) => layer.id === layerId)!;
    expect(after.element).toEqual({ ...before.element, patternId: copyId });
    expect(after.animationTracks).toEqual(before.animationTracks);
    expect(after.keyframes).toEqual(before.keyframes);
    expect(composition().layers.find((layer) => layer.id === second)!.element).toMatchObject({
      patternId,
    });
    expect(() => store.removeTilingPattern(patternId)).toThrow();
    store.toggleLayerLock(second);
    expect(() => store.makePatternIndependent(second)).toThrow(/Unlock/);
  });
});
