import { beforeEach, describe, expect, it } from 'vitest';
import { getLayerTransformAtFrame, useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';

describe('project store independent layer timelines', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('adds and edits a key without changing any other layer track', () => {
    const firstId = useProjectStore.getState().addLayer('rectangle');
    const secondId = useProjectStore.getState().addLayer('rectangle');
    const before = useProjectStore.getState();
    const compositionBefore = before.project.compositions[0]!;
    const secondFramesBefore = compositionBefore.layers
      .find((layer) => layer.id === secondId)!
      .keyframes.map((keyframe) => keyframe.frame);

    const keyframeId = useProjectStore.getState().addLayerKeyframe(firstId, 7);
    useProjectStore.getState().updateLayerTransform(firstId, 7, { x: 777 });

    const composition = useProjectStore.getState().project.compositions[0]!;
    const first = composition.layers.find((layer) => layer.id === firstId)!;
    const second = composition.layers.find((layer) => layer.id === secondId)!;
    expect(first.keyframes.find((keyframe) => keyframe.id === keyframeId)?.transform.x).toBe(777);
    expect(getLayerTransformAtFrame(first, 7).x).toBe(777);
    expect(second.keyframes.map((keyframe) => keyframe.frame)).toEqual(secondFramesBefore);
  });

  it('keeps easing isolated to one key on one layer', () => {
    const firstId = useProjectStore.getState().addLayer('rectangle');
    const secondId = useProjectStore.getState().addLayer('rectangle');
    const compositionBefore = useProjectStore.getState().project.compositions[0]!;
    const firstLayerBefore = compositionBefore.layers.find((layer) => layer.id === firstId)!;
    const secondLayerBefore = compositionBefore.layers.find((layer) => layer.id === secondId)!;
    const firstTargetKey = firstLayerBefore.keyframes.find((keyframe) => keyframe.frame === 12)!;
    const firstOtherKey = firstLayerBefore.keyframes.find((keyframe) => keyframe.frame !== 12)!;
    const secondTargetKey = secondLayerBefore.keyframes.find((keyframe) => keyframe.frame === 12)!;
    const originalFirstOtherEasing = firstOtherKey.easing;
    const originalSecondEasing = secondTargetKey.easing;

    useProjectStore.getState().updateLayerKeyframeEasing(firstId, firstTargetKey.id, 'sine-out');

    const compositionAfter = useProjectStore.getState().project.compositions[0]!;
    const firstLayerAfter = compositionAfter.layers.find((layer) => layer.id === firstId)!;
    const secondLayerAfter = compositionAfter.layers.find((layer) => layer.id === secondId)!;
    expect(
      firstLayerAfter.keyframes.find((keyframe) => keyframe.id === firstTargetKey.id)?.easing,
    ).toBe('sine-out');
    expect(
      firstLayerAfter.keyframes.find((keyframe) => keyframe.id === firstOtherKey.id)?.easing,
    ).toBe(originalFirstOtherEasing);
    expect(
      secondLayerAfter.keyframes.find((keyframe) => keyframe.id === secondTargetKey.id)?.easing,
    ).toBe(originalSecondEasing);
  });

  it('moves a key freely while preventing two keys on the same layer frame', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    const keyframeId = useProjectStore.getState().addLayerKeyframe(layerId, 5);
    useProjectStore.getState().moveLayerKeyframe(layerId, keyframeId, 8);
    let layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.keyframes.find((keyframe) => keyframe.id === keyframeId)?.frame).toBe(8);

    useProjectStore.getState().moveLayerKeyframe(layerId, keyframeId, 12);
    layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.keyframes.find((keyframe) => keyframe.id === keyframeId)?.frame).toBe(8);
  });

  it('publishes transient transform values without committing project data', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    const layerBefore = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    const authoredX = getLayerTransformAtFrame(layerBefore, 12).x;

    useSelectionStore.getState().select(layerId);
    useSelectionStore.getState().setLiveTransform(layerId, { x: 654, rotation: 23 });
    expect(useSelectionStore.getState().liveTransform).toEqual({
      layerId,
      patch: { x: 654, rotation: 23 },
    });

    const layerDuring = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    expect(getLayerTransformAtFrame(layerDuring, 12).x).toBe(authoredX);
    useSelectionStore.getState().clearLiveTransform();
    expect(useSelectionStore.getState().liveTransform).toBeNull();
  });

  it('snaps authored pixel geometry without rounding continuous properties', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().updateLayerTransform(layerId, 7, {
      x: 119.596,
      y: -20.51,
      width: 400.49,
      height: 120.5,
      rotation: 12.345,
      opacity: 0.555,
    });

    const layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    const keyframe = layer.keyframes.find((candidate) => candidate.frame === 7)!;
    expect(keyframe.transform).toMatchObject({
      x: 120,
      y: -21,
      width: 400,
      height: 121,
      rotation: 12.345,
      opacity: 0.555,
    });
  });

  it('keys only the edited property at an independently chosen frame', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');

    useProjectStore.getState().updateLayerTransform(layerId, 7, { x: 640 });

    const layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.animationTracks.x?.some((keyframe) => keyframe.frame === 7)).toBe(true);
    expect(layer.animationTracks.y?.some((keyframe) => keyframe.frame === 7)).toBe(false);
    expect(getLayerTransformAtFrame(layer, 7).x).toBe(640);
  });

  it('animates effect values independently from transform tracks', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');

    useProjectStore.getState().updateLayerEffects(layerId, 9, { blur: 14 });

    const layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.animationTracks.blur?.find((keyframe) => keyframe.frame === 9)?.value).toBe(14);
    expect(layer.animationTracks.x?.some((keyframe) => keyframe.frame === 9)).toBe(false);
  });

  it('authors an independent gradient-stop key when its Inspector value changes', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    const fill = {
      type: 'linear' as const,
      angle: 90,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 0 },
        { offset: 0.2, color: '#ffffff', opacity: 1 },
        { offset: 0.4, color: '#ffffff', opacity: 0 },
      ],
    };
    useProjectStore.getState().updateLayerElement(layerId, { fill });
    useProjectStore.getState().updateLayerPaint(layerId, 6, {
      ...fill,
      stops: fill.stops.map((stop, index) => (index === 1 ? { ...stop, offset: 0.8 } : stop)),
    });

    const layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.animationTracks['fill.stops[1].offset']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frame: 0, value: 0.2 }),
        expect.objectContaining({ frame: 6, value: 0.8 }),
      ]),
    );
    expect(layer.animationTracks.x?.some((keyframe) => keyframe.frame === 6)).toBe(false);
  });

  it('keeps retiming collision-free and reversible', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().addLayerPropertyKeyframe(layerId, 'x', 1);
    useProjectStore.getState().addLayerPropertyKeyframe(layerId, 'x', 2);
    let layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    const beforeCollision = layer.animationTracks.x!.map((keyframe) => keyframe.frame);

    useProjectStore.getState().scaleLayerPropertyTrack(layerId, 'x', 0.1);
    layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.animationTracks.x!.map((keyframe) => keyframe.frame)).toEqual(beforeCollision);

    const valuesBeforeReverse = layer.animationTracks.x!.map((keyframe) => keyframe.value);
    useProjectStore.getState().reverseLayerPropertyTrack(layerId, 'x');
    layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.animationTracks.x!.map((keyframe) => keyframe.value)).toEqual(
      [...valuesBeforeReverse].reverse(),
    );
  });
});
