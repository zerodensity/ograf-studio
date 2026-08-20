import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useTimelineStore, type TimelineController } from './timelineStore';

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
    durationFrames: 120,
    controller,
  });
  return controller;
}

describe('project and timeline synchronization', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      currentFrame: 0,
      isPlaying: false,
      durationFrames: 0,
      controller: null,
    });
  });

  it('stops the outgoing timeline and resets to frame zero when loading a project', () => {
    const controller = installTimelineAtFrame(42);
    const project = createProject({ name: 'Loaded project' });

    useProjectStore.getState().loadProject(project);

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 0,
      isPlaying: false,
      durationFrames: 0,
      controller: null,
    });
    expect(useProjectStore.getState().project.name).toBe('Loaded project');
  });

  it('resets transient playback state when creating a new project', () => {
    const controller = installTimelineAtFrame(30);

    useProjectStore.getState().newProject();

    expect(controller.stop).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 0,
      isPlaying: false,
      durationFrames: 0,
      controller: null,
    });
  });
});
