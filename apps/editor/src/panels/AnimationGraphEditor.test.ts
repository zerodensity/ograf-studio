import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createProject,
  getResolvedLayerAnimationTracks,
  getLayerPropertyValueAtFrame,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useTimelineStore } from '../state/timelineStore';
import { useSelectionStore } from '../state/selectionStore';

vi.stubGlobal('window', { clearTimeout });
const history = await import('../state/historyStore');
const { commitAnimationGraphDrag, deleteAnimationGraphKey } =
  await import('./animationGraphEditing');
const { AnimationGraphEditor } = await import('./AnimationGraphEditor');

beforeEach(() => useProjectStore.getState().loadProject(createProject()));
afterEach(() => history.resetHistory());
afterAll(() => vi.unstubAllGlobals());

function editFixture() {
  const layerId = useProjectStore.getState().addLayer('rectangle');
  for (const frame of [0, 12, 24])
    useProjectStore.getState().addLayerPropertyKeyframe(layerId, 'x', frame);
  const state = useProjectStore.getState();
  const composition = state.project.compositions.find(
    (item) => item.id === state.activeCompositionId,
  )!;
  const layer = composition.layers.find((item) => item.id === layerId)!;
  const originalTrack = structuredClone(getResolvedLayerAnimationTracks(layer).x!);
  const key = originalTrack[1]!;
  history.resetHistory();
  return {
    projectId: state.project.id,
    compositionId: composition.id,
    layerId,
    property: 'x' as const,
    keyframeId: key.id,
    originalTrack,
    preview: { frame: key.frame - 2, value: key.value + 70 },
  };
}
const currentTrack = (layerId: string) => {
  const state = useProjectStore.getState();
  const composition = state.project.compositions.find(
    (item) => item.id === state.activeCompositionId,
  )!;
  return getResolvedLayerAnimationTracks(composition.layers.find((item) => item.id === layerId)!)
    .x!;
};

describe('animation graph edit publication', () => {
  it.each([
    { width: 600, scrollLeft: 0, pixelsPerFrame: 5, frame: 120, expectedX: 600 },
    { width: 600, scrollLeft: 240, pixelsPerFrame: 12, frame: 60, expectedX: 480 },
    { width: 960, scrollLeft: 0, pixelsPerFrame: 8, frame: 120, expectedX: 960 },
    { width: 400, scrollLeft: 800, pixelsPerFrame: 10, frame: 120, expectedX: 400 },
    { width: 320, scrollLeft: 0, pixelsPerFrame: 24, frame: 0, expectedX: 0 },
  ])(
    'renders frame $frame at the timeline pixel for zoom $pixelsPerFrame and scroll $scrollLeft',
    ({ width, scrollLeft, pixelsPerFrame, frame, expectedX }) => {
      const layerId = useProjectStore.getState().addLayer('rectangle');
      useProjectStore.getState().retimeAnimationPhase('entire', 120);
      useProjectStore.getState().enableLayerPropertyAnimation(layerId, 'x', 0);
      for (const keyFrame of [20, 60, 120])
        useProjectStore.getState().addLayerPropertyKeyframe(layerId, 'x', keyFrame);
      const state = useProjectStore.getState();
      const layer = state.project.compositions
        .find((item) => item.id === state.activeCompositionId)!
        .layers.find((item) => item.id === layerId)!;
      const html = renderToStaticMarkup(
        createElement(AnimationGraphEditor, {
          layer,
          property: 'x',
          durationFrames: 120,
          viewport: { left: 200, width, scrollLeft, pixelsPerFrame },
          ticks: [0, 20, 60, 120],
          currentFrame: frame,
          lifecycleFrames: [0, 120],
        }),
      );
      const keyMarkup = html.match(
        new RegExp(
          `<g[^>]*aria-label="x key at frame ${frame}, value [^"]+"[^>]*>([\\s\\S]*?)<\\/g>`,
        ),
      );
      expect(keyMarkup, `The visible frame ${frame} key should remain selectable`).not.toBeNull();
      const x = Number(keyMarkup![1]!.match(/\bcx="([^"]+)"/)?.[1]);
      expect(x).toBeCloseTo(expectedX, 8);
      const lines = html.match(/<line\b[^>]*>/g) ?? [];
      const playhead = lines.find((line) => line.includes('class="animation-graph-playhead"'));
      expect(Number(playhead?.match(/\bx1="([^"]+)"/)?.[1])).toBeCloseTo(expectedX, 8);
      if (frame === 0 || frame === 120) {
        const boundary = lines.find((line) => line.includes(`data-frame="${frame}"`));
        expect(Number(boundary?.match(/\bx1="([^"]+)"/)?.[1])).toBeCloseTo(expectedX, 8);
      }
      expect(html).toContain(`viewBox="0 0 ${width} 180"`);
      expect(html).toContain('preserveAspectRatio="none"');
    },
  );

  it('renders an empty graph for a static channel without treating compiler fallback keys as authored', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    const layer = () => {
      const state = useProjectStore.getState();
      return state.project.compositions
        .find((item) => item.id === state.activeCompositionId)!
        .layers.find((item) => item.id === layerId)!;
    };
    const render = () =>
      renderToStaticMarkup(
        createElement(AnimationGraphEditor, {
          layer: layer(),
          property: 'x',
          durationFrames: 24,
        }),
      );
    expect(layer().animationTrackMode).toBe('independent');
    expect(getResolvedLayerAnimationTracks(layer()).x).toHaveLength(1);
    expect(render()).toContain('aria-label="Animation graph editor"');
    expect(render()).not.toContain('class="animation-graph-key-hit"');
    useProjectStore.getState().enableLayerPropertyAnimation(layerId, 'x', 0);
    expect(layer().animationTracks.x).toHaveLength(1);
    const enabled = render();
    expect(enabled).toContain('aria-label="x key at frame 0, value 100"');
    expect(enabled.match(/class="animation-graph-key-hit"/g)).toHaveLength(1);
    expect(enabled).toContain('aria-haspopup="menu"');
    expect(enabled).toContain('aria-keyshortcuts="Shift+F10 ContextMenu Delete Backspace"');
    useProjectStore.getState().toggleLayerPropertyKeyframe(layerId, 'x', 0);
    expect(render()).toContain('aria-label="Animation graph editor"');
    expect(render()).not.toContain('class="animation-graph-key-hit"');
  });

  it('commits the final time and value as one undoable change and preserves other keys', () => {
    const edit = editFixture();
    expect(commitAnimationGraphDrag(edit)).toBe(true);
    expect(currentTrack(edit.layerId).find((key) => key.id === edit.keyframeId)).toMatchObject(
      edit.preview,
    );
    expect(currentTrack(edit.layerId).filter((key) => key.id !== edit.keyframeId)).toEqual(
      edit.originalTrack.filter((key) => key.id !== edit.keyframeId),
    );
    expect(history.getHistorySnapshot().past.map((item) => item.label)).toEqual([
      'Move animation graph key',
    ]);
    expect(useTimelineStore.getState().currentFrame).toBe(edit.preview.frame);
    history.undo();
    expect(currentTrack(edit.layerId)).toEqual(edit.originalTrack);
    history.redo();
    expect(currentTrack(edit.layerId).find((key) => key.id === edit.keyframeId)).toMatchObject(
      edit.preview,
    );
  });

  it('does not publish a click without motion or replace another edit made during a drag', () => {
    const edit = editFixture();
    const original = edit.originalTrack.find((key) => key.id === edit.keyframeId)!;
    expect(
      commitAnimationGraphDrag({
        ...edit,
        preview: { frame: original.frame, value: original.value },
      }),
    ).toBe(false);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
    useProjectStore
      .getState()
      .updateLayerPropertyKeyframeValue(
        edit.layerId,
        edit.property,
        edit.keyframeId,
        original.value + 20,
      );
    const changed = structuredClone(currentTrack(edit.layerId));
    expect(commitAnimationGraphDrag(edit)).toBe(false);
    expect(currentTrack(edit.layerId)).toEqual(changed);
  });

  it('refuses a duplicate frame instead of publishing only part of a drag', () => {
    const edit = editFixture();
    expect(
      commitAnimationGraphDrag({
        ...edit,
        preview: { ...edit.preview, frame: edit.originalTrack[0]!.frame },
      }),
    ).toBe(false);
    expect(currentTrack(edit.layerId)).toEqual(edit.originalTrack);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });

  it('deletes only the target key in one Undo while preserving its channel and current playhead', () => {
    const target = editFixture();
    const store = useProjectStore.getState();
    store.addLayerPropertyKeyframe(target.layerId, 'y', 0);
    store.addLayerPropertyKeyframe(target.layerId, 'y', 24);
    const layer = () =>
      useProjectStore
        .getState()
        .project.compositions[0]!.layers.find((item) => item.id === target.layerId)!;
    const other = structuredClone(layer().animationTracks.y);
    const seek = vi.fn();
    useTimelineStore.setState({
      currentFrame: 5,
      controller: { seek, play: vi.fn(), pause: vi.fn(), stop: vi.fn() },
    });
    useSelectionStore.getState().selectLayerKeyframe(target.layerId, target.keyframeId, 'x');
    history.resetHistory();

    expect(deleteAnimationGraphKey(target)).toBe(true);

    expect(currentTrack(target.layerId)).toEqual(
      target.originalTrack.filter((key) => key.id !== target.keyframeId),
    );
    expect(layer().animationTracks.y).toEqual(other);
    expect(useTimelineStore.getState().currentFrame).toBe(5);
    expect(seek).not.toHaveBeenCalled();
    expect(useSelectionStore.getState()).toMatchObject({
      selectedLayerId: target.layerId,
      selectedLayerProperty: 'x',
      selectedLayerKeyframeId: null,
      selectedLayerKeyframes: [],
    });
    expect(history.getHistorySnapshot().past.map((item) => item.label)).toEqual([
      'Delete animation graph key',
    ]);
    history.undo();
    expect(currentTrack(target.layerId)).toEqual(target.originalTrack);
    expect(layer().animationTracks.y).toEqual(other);
    history.redo();
    expect(currentTrack(target.layerId).some((key) => key.id === target.keyframeId)).toBe(false);
  });

  it('allows deleting the final key and preserves the static sampled value and channel', () => {
    const target = editFixture();
    const store = useProjectStore.getState();
    useTimelineStore.getState().setCurrentFrame(0);
    const first = target.originalTrack[0]!;
    store.updateLayerPropertyKeyframeValue(target.layerId, 'x', first.id, 345);
    for (const key of target.originalTrack.slice(1))
      store.removeLayerPropertyKeyframe(target.layerId, 'x', key.id);
    const originalTrack = structuredClone(currentTrack(target.layerId));
    const finalTarget = { ...target, keyframeId: first.id, originalTrack };
    useTimelineStore.getState().setCurrentFrame(19);
    useSelectionStore.getState().selectLayerKeyframe(target.layerId, first.id, 'x');
    history.resetHistory();

    expect(deleteAnimationGraphKey(finalTarget)).toBe(true);

    const layer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((item) => item.id === target.layerId)!;
    expect(layer.animationTracks.x).toBeUndefined();
    for (const frame of [0, 19, 24])
      expect(getLayerPropertyValueAtFrame(layer, 'x', frame)).toBe(345);
    expect(useSelectionStore.getState().selectedLayerProperty).toBe('x');
    expect(useTimelineStore.getState().currentFrame).toBe(19);
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expect(currentTrack(target.layerId)).toEqual(originalTrack);
  });

  it('refuses missing, replaced-project and locked targets without deleting source', () => {
    const target = editFixture();
    expect(deleteAnimationGraphKey({ ...target, projectId: 'different-project' })).toBe(false);
    expect(deleteAnimationGraphKey({ ...target, compositionId: 'different-composition' })).toBe(
      false,
    );
    expect(deleteAnimationGraphKey({ ...target, keyframeId: 'missing-key' })).toBe(false);
    expect(currentTrack(target.layerId)).toEqual(target.originalTrack);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
    useProjectStore.getState().toggleLayerLock(target.layerId);
    history.resetHistory();
    expect(deleteAnimationGraphKey(target)).toBe(false);
    expect(currentTrack(target.layerId)).toEqual(target.originalTrack);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });

  it('does not apply a stale menu after the track changed', () => {
    const target = editFixture();
    useProjectStore
      .getState()
      .updateLayerPropertyKeyframeValue(target.layerId, 'x', target.originalTrack[0]!.id, 777);
    const changed = structuredClone(currentTrack(target.layerId));
    history.resetHistory();
    expect(deleteAnimationGraphKey(target)).toBe(false);
    expect(currentTrack(target.layerId)).toEqual(changed);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });
});
