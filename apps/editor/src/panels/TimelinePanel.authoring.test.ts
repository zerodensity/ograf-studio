import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createProject, createLayerPropertyKeyframe } from '@ograf-editor/scene-model';
import { EditorWindowContext, type EditorWindow } from '../layout/EditorWindow';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { TimelinePanel } from './TimelinePanel';

vi.mock('../state/historyStore', () => ({
  runDiscreteHistoryStep: (operation: () => unknown) => operation(),
}));

// Server rendering normally reads Zustand's initial snapshot. These UI assertions inspect the
// same current authoring state that a mounted panel subscribes to, without a browser DOM.
vi.mock('../state/projectStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/projectStore')>();
  return {
    ...actual,
    useProjectStore: Object.assign(
      (select: (state: ReturnType<typeof actual.useProjectStore.getState>) => unknown) =>
        select(actual.useProjectStore.getState()),
      actual.useProjectStore,
    ),
    useActiveComposition: () => {
      const state = actual.useProjectStore.getState();
      return state.project.compositions.find((item) => item.id === state.activeCompositionId)!;
    },
  };
});
vi.mock('../state/selectionStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/selectionStore')>();
  return {
    ...actual,
    useSelectionStore: Object.assign(
      (select: (state: ReturnType<typeof actual.useSelectionStore.getState>) => unknown) =>
        select(actual.useSelectionStore.getState()),
      actual.useSelectionStore,
    ),
  };
});
vi.mock('../state/timelineStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/timelineStore')>();
  return {
    ...actual,
    useTimelineStore: Object.assign(
      (select: (state: ReturnType<typeof actual.useTimelineStore.getState>) => unknown) =>
        select(actual.useTimelineStore.getState()),
      actual.useTimelineStore,
    ),
  };
});

const markup = (owner = { document: {} } as EditorWindow) =>
  renderToStaticMarkup(
    createElement(EditorWindowContext.Provider, { value: owner }, createElement(TimelinePanel)),
  );

beforeEach(() => {
  useProjectStore.getState().loadProject(createProject());
  useTimelineStore.setState({
    currentFrame: 0,
    durationFrames: 250,
    autoKeyframe: false,
    pauseAtOgrafSteps: false,
    controller: { seek: vi.fn(), play: vi.fn(), pause: vi.fn(), stop: vi.fn() },
  });
});

describe('Timeline authoring controls', () => {
  it('offers explicit Step and transform keys with Auto-keyframe off', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    useSelectionStore.getState().select(id);
    const html = markup();
    const step = html.match(/<button\b([^>]*)>\+ Step<\/button>/);
    const key = html.match(/<button\b([^>]*)>◆ Key transform<\/button>/);
    expect(step).not.toBeNull();
    expect(key).not.toBeNull();
    expect(step![1]).not.toContain('disabled');
    expect(key![1]).not.toContain('disabled');
    expect(html).toContain('aria-label="Current time"');
    expect(html).toContain('aria-pressed="true" title="Show keyframe tracks">Keys');
    expect(html).not.toContain('aria-label="Animation graph editor"');
    expect(html).not.toContain('aria-label="Resize timeline and animation curve"');
    expect(html).not.toContain('Rectangle key at frame');
    expect(html.indexOf('aria-label="Timeline display"')).toBeLessThan(
      html.indexOf('aria-label="Retime animation phase"'),
    );
  });

  it('keeps static independent channels in Keys while retaining the Graph switch', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    useSelectionStore.getState().selectLayerProperty(id, 'x');
    const html = markup();
    const key = html.match(/<button\b([^>]*)>◆ Add Position X key<\/button>/);
    expect(key).not.toBeNull();
    expect(key![1]).not.toContain('disabled');
    expect(html).not.toContain('aria-label="Animation graph editor"');
    expect(html).not.toContain('has-animation-graph');
    expect(html).not.toContain('aria-label="Resize timeline and animation curve"');
    expect(html).toContain(
      'aria-pressed="false" title="Show the selected property&#x27;s value graph">Graph',
    );
  });

  it('offers reset without selecting a key, enabling main or loop animation and disabling static or locked channels', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    useSelectionStore.getState().selectLayerProperty(id, 'x');
    const resetButton = () =>
      markup().match(/<button\b([^>]*)>Reset Position X animation<\/button>/);
    expect(resetButton()).not.toBeNull();
    expect(resetButton()![1]).toContain('disabled');
    store.addLayerPropertyKeyframe(id, 'x', 0);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBeNull();
    expect(resetButton()![1]).not.toContain('disabled');
    store.toggleLayerLock(id);
    expect(resetButton()![1]).toContain('disabled');

    const loopId = store.addLayer('rectangle');
    store.setLayerLoop(loopId, { durationFrames: 50 });
    store.setLayerLoopPropertyTrack(loopId, 'x', [
      createLayerPropertyKeyframe(0, 100),
      createLayerPropertyKeyframe(50, 200),
    ]);
    useSelectionStore.getState().selectLayerProperty(loopId, 'x');
    const loopLayer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((item) => item.id === loopId)!;
    expect(loopLayer.animationTracks.x).toBeUndefined();
    expect(resetButton()![1]).not.toContain('disabled');
  });

  it('replaces keyframe rows with the graph while keeping channel navigation, ruler and reset', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().retimeAnimationPhase('entire', 120);
    useProjectStore.getState().enableLayerPropertyAnimation(id, 'x', 0);
    useProjectStore.getState().addLayerPropertyKeyframe(id, 'x', 60);
    useSelectionStore.getState().selectLayerProperty(id, 'x');
    const html = markup();
    expect(html).toContain('has-animation-graph');
    expect(html).toContain('aria-label="Animation graph editor"');
    expect(html).toContain('aria-pressed="false" title="Show keyframe tracks">Keys');
    expect(html).toContain(
      'aria-pressed="true" title="Show the selected property&#x27;s value graph">Graph',
    );
    expect(html).toContain('x key at frame 0, value 100');
    expect(html).toContain('x key at frame 60, value 100');
    expect(html).toContain('◆ Add Position X key');
    expect(html).not.toContain('Rectangle key at frame');
    expect(html).not.toContain('Position X key at frame');
    expect(html).not.toMatch(/class="timeline-track(?:\s|")/);
    expect(html).not.toContain('aria-label="Resize timeline and animation curve"');
    expect(html).toContain('aria-label="Expand Rectangle properties"');
    expect(html).toContain('title="Select Rectangle"');
    expect(html).toContain('class="timeline-ruler');
    expect(html).toContain('aria-label="Current frame 0. Drag to scrub the timeline."');
    expect(html).toContain('Reset Position X animation');
    expect(html).toContain('class="timeline-graph-view"');
  });

  it('opens a genuinely enabled one-key channel without treating other static channels as animated', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().enableLayerPropertyAnimation(id, 'opacity', 0);
    useSelectionStore.getState().selectLayerProperty(id, 'opacity');
    expect(markup()).toContain('aria-label="Animation graph editor"');

    useSelectionStore.getState().selectLayerProperty(id, 'y');
    const staticChannel = markup();
    expect(staticChannel).not.toContain('has-animation-graph');
    expect(staticChannel).not.toContain('aria-label="Animation graph editor"');
  });
});
