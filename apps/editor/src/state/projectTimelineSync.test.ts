import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useTimelineStore, type TimelineController } from './timelineStore';
import { initializeEditorSession } from './editorStartup';
import { useLayerClipboardStore } from './layerClipboardStore';
import { onAirFrame } from './onAirFrame';

function installTimelineAtFrame(frame: number): TimelineController {
  const controller: TimelineController = {
    seek: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  };
  useTimelineStore.setState({
    currentFrame: frame,
    isPlaying: true,
    autoKeyframe: true,
    durationFrames: 120,
    controller,
  });
  return controller;
}

describe('project and timeline synchronization', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      currentFrame: 0,
      autoKeyframe: false,
      isPlaying: false,
      durationFrames: 0,
      controller: null,
    });
  });

  it('stops the outgoing timeline and opens a project on its first step', () => {
    const controller = installTimelineAtFrame(42);
    const project = createProject({ name: 'Loaded project' });

    useProjectStore.getState().loadProject(project);

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: onAirFrame(project.compositions[0]!),
      autoKeyframe: false,
      isPlaying: false,
      durationFrames: 0,
      controller: null,
    });
    expect(useProjectStore.getState().project.name).toBe('Loaded project');
    const state = useProjectStore.getState();
    const composition = state.project.compositions[0]!;
    expect(
      composition.keyframes.find((keyframe) => keyframe.id === state.activeKeyframeId)?.role,
    ).toBe('step');
  });

  it('preserves outgoing playback and clipboard if project migration rejects the load', () => {
    const controller = installTimelineAtFrame(42);
    const before = useProjectStore.getState();
    const clipboard = useLayerClipboardStore.getState();
    const timeline = useTimelineStore.getState();
    const project = createProject({ name: 'Invalid incoming project' });
    project.shaders = {} as never;
    expect(() => before.loadProject(project)).toThrow('Project shader library must be an array');
    expect(useProjectStore.getState()).toBe(before);
    expect(useLayerClipboardStore.getState()).toBe(clipboard);
    expect(useTimelineStore.getState()).toBe(timeline);
    expect(controller.stop).not.toHaveBeenCalled();
  });

  it('resets transient playback state when creating a new project', () => {
    const controller = installTimelineAtFrame(30);

    useProjectStore.getState().newProject();

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 0,
      autoKeyframe: false,
      isPlaying: false,
      durationFrames: 0,
      controller: null,
    });
    const state = useProjectStore.getState();
    const composition = state.project.compositions[0]!;
    expect(
      composition.keyframes.find((keyframe) => keyframe.id === state.activeKeyframeId)?.role,
    ).toBe('step');
  });

  it('resets a reused editor session before mounting when no autosave exists', async () => {
    const controller = installTimelineAtFrame(17);

    await initializeEditorSession(null);

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 0,
      autoKeyframe: false,
      isPlaying: false,
      durationFrames: 0,
      controller: null,
    });
  });

  it('loads an autosave at its first step before mounting the editor', async () => {
    const controller = installTimelineAtFrame(17);
    const autosaved = createProject({ name: 'Autosaved project' });

    await initializeEditorSession(autosaved);

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().project.name).toBe('Autosaved project');
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: onAirFrame(autosaved.compositions[0]!),
      autoKeyframe: false,
      isPlaying: false,
      durationFrames: 0,
      controller: null,
    });
  });

  it('clears project-scoped layer clipboard content on New and load', () => {
    const sourceId = useProjectStore.getState().addLayer('rectangle');
    const source = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((layer) => layer.id === sourceId)!;
    useLayerClipboardStore.getState().copy([source]);

    useProjectStore.getState().newProject();
    expect(useLayerClipboardStore.getState().layers).toEqual([]);

    useLayerClipboardStore.getState().copy([source]);
    useProjectStore.getState().loadProject(createProject());
    expect(useLayerClipboardStore.getState().layers).toEqual([]);
  });
});
