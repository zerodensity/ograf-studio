import { afterEach, describe, expect, it } from 'vitest';
import {
  createProject,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  getTotalFrames,
} from '@ograf-editor/scene-model';
import { canvasFrame, useCanvasViewStore } from './canvasViewStore';
import { onAirFrame } from './onAirFrame';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';

afterEach(() => {
  useCanvasViewStore.getState().setMode('animate');
  useTimelineStore.getState().setAutoKeyframe(false);
});
describe('Design canvas view', () => {
  it('starts in Animate while keeping Design available internally', () => {
    expect(useCanvasViewStore.getInitialState().mode).toBe('animate');
    useCanvasViewStore.getState().setMode('design');
    expect(useCanvasViewStore.getState().mode).toBe('design');
  });
  it('moves a slide-in lower third at the on-air pose without creating or shifting key times', () => {
    useProjectStore.getState().loadProject(createProject());
    const recipe = useProjectStore.getState().addLowerThird();
    const id = recipe.layers.panel;
    useProjectStore.getState().setLayerMotion(id, 'in', {
      style: 'slide',
      direction: 'left',
      distance: 100,
      durationFrames: 8,
    });
    let state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const before = composition.layers.find((l) => l.id === id)!;
    const frames = before.keyframes.map((k) => k.frame),
      tracks = Object.fromEntries(
        Object.entries(getResolvedLayerAnimationTracks(before)).map(([k, v]) => [
          k,
          v?.map((item) => item.frame),
        ]),
      );
    const x0 = getLayerTransformAtFrame(before, 0).x;
    const on = onAirFrame(composition);
    const xStep = getLayerTransformAtFrame(before, on).x;
    const yStep = getLayerTransformAtFrame(before, on).y;
    const childBefore = composition.layers.find((layer) => layer.id === recipe.layers.headline)!;
    const childX = getLayerTransformAtFrame(childBefore, on).x;
    const childFrames = childBefore.keyframes.map((key) => key.frame);
    expect(xStep - x0).toBeGreaterThan(0);
    useTimelineStore.getState().setCurrentFrame(0);
    useTimelineStore.getState().setAutoKeyframe(true);
    useCanvasViewStore.getState().setMode('design');
    expect(canvasFrame(composition)).toBe(on);
    useProjectStore.getState().updateLayerTransform(id, 0, { x: xStep + 50, y: yStep + 50 });
    state = useProjectStore.getState();
    const changed = getActiveComposition(state.project, state.activeCompositionId).layers.find(
      (l) => l.id === id,
    )!;
    expect(getLayerTransformAtFrame(changed, 0).x).toBeCloseTo(x0 + 50);
    expect(getLayerTransformAtFrame(changed, on).x).toBeCloseTo(xStep + 50);
    expect(changed.keyframes.map((k) => k.frame)).toEqual(frames);
    const childAfter = getActiveComposition(state.project, state.activeCompositionId).layers.find(
      (layer) => layer.id === recipe.layers.headline,
    )!;
    expect(getLayerTransformAtFrame(childAfter, on).x).toBeCloseTo(childX + 50);
    expect(childAfter.keyframes.map((key) => key.frame)).toEqual(childFrames);
    expect(
      Object.fromEntries(
        Object.entries(getResolvedLayerAnimationTracks(changed)).map(([k, v]) => [
          k,
          v?.map((item) => item.frame),
        ]),
      ),
    ).toEqual(tracks);
    expect(useTimelineStore.getState().currentFrame).toBe(0);
    useCanvasViewStore.getState().setMode('animate');
    expect(canvasFrame(composition)).toBe(0);
  });
  it('edits an existing animated on-air key while leaving other keys and unanimated width unchanged in count', () => {
    useProjectStore.getState().loadProject(createProject());
    const id = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().setLayerMotion(id, 'in', { style: 'fade', durationFrames: 8 });
    const initial = useProjectStore.getState();
    const composition = getActiveComposition(initial.project, initial.activeCompositionId);
    const layer = composition.layers.find((item) => item.id === id)!;
    const step = onAirFrame(composition);
    const original = getResolvedLayerAnimationTracks(layer);
    const beforeAlpha = getLayerTransformAtFrame(layer, 0).opacity;
    const widthCount = original.width?.length;
    const alphaTimes = original.opacity?.map((key) => key.frame);
    useCanvasViewStore.getState().setMode('design');
    useProjectStore.getState().updateLayerTransform(id, 0, { opacity: 0.6, width: 250 });
    const nextState = useProjectStore.getState();
    const updated = getActiveComposition(
      nextState.project,
      nextState.activeCompositionId,
    ).layers.find((item) => item.id === id)!;
    expect(getLayerTransformAtFrame(updated, 0).opacity).toBe(beforeAlpha);
    expect(getLayerTransformAtFrame(updated, step).opacity).toBeCloseTo(0.6);
    expect(getResolvedLayerAnimationTracks(updated).opacity?.map((key) => key.frame)).toEqual(
      alphaTimes,
    );
    expect(getResolvedLayerAnimationTracks(updated).width?.length).toBe(widthCount);
    expect(getResolvedLayerAnimationTracks(updated).width?.every((key) => key.value === 250)).toBe(
      true,
    );
  });
  it('refuses a sparse animated property without an on-air key rather than adding one or partially moving', () => {
    useProjectStore.getState().loadProject(createProject());
    const id = useProjectStore.getState().addLayer('rectangle');
    let state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const layer = composition.layers.find((item) => item.id === id)!;
    const end = getTotalFrames(composition);
    const keys = getResolvedLayerAnimationTracks(layer).opacity!;
    useProjectStore.setState((current) => ({
      project: {
        ...current.project,
        compositions: current.project.compositions.map((comp) =>
          comp.id !== composition.id
            ? comp
            : {
                ...comp,
                layers: comp.layers.map((item) =>
                  item.id !== id
                    ? item
                    : {
                        ...item,
                        animationTracks: {
                          ...item.animationTracks,
                          opacity: [
                            { ...keys[0]!, frame: 0, value: 0 },
                            { ...keys.at(-1)!, frame: end, value: 1 },
                          ],
                        },
                      },
                ),
              },
        ),
      },
    }));
    useCanvasViewStore.getState().setMode('design');
    state = useProjectStore.getState();
    const before = structuredClone(
      getActiveComposition(state.project, state.activeCompositionId).layers.find(
        (item) => item.id === id,
      ),
    );
    expect(() =>
      useProjectStore.getState().updateLayerTransform(id, 0, { x: 999, opacity: 0.5 }),
    ).toThrow(/no key at the on-air Step/);
    const afterState = useProjectStore.getState();
    expect(
      getActiveComposition(afterState.project, afterState.activeCompositionId).layers.find(
        (item) => item.id === id,
      ),
    ).toEqual(before);
  });
});
