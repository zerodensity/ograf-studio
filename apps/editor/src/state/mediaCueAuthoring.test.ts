import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAsset,
  createProject,
  mediaCueEffectiveDurationFrames,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';

describe('Media Cue authoring', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('creates keyframe-triggered video cues without canvas layers', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.assets.push(
      createAsset({
        id: 'audio',
        name: 'Theme.mp3',
        kind: 'audio',
        mimeType: 'audio/mpeg',
        durationMs: 4_000,
      }),
      createAsset({
        id: 'video',
        name: 'Intro.mp4',
        kind: 'media',
        mimeType: 'video/mp4',
        durationMs: 8_000,
      }),
    );
    useProjectStore.getState().loadProject(project);
    const videoCueId = useProjectStore.getState().addMediaCueFromAsset('video');
    const state = useProjectStore.getState();
    const current = state.project.compositions[0]!;
    expect(current.layers).toEqual([]);
    expect(current.mediaCues).toHaveLength(1);
    expect(current.mediaCues.find((cue) => cue.id === videoCueId)?.sources[0]).toMatchObject({
      mediaType: 'video',
      src: 'asset:video',
    });
    const videoCue = current.mediaCues.find((cue) => cue.id === videoCueId)!;
    expect(videoCue).toMatchObject({
      trigger: { type: 'lifecycle', keyframeId: current.keyframes[1]!.id },
      durationFrames: null,
    });
    expect(mediaCueEffectiveDurationFrames(videoCue, current)).toBe(200);
    expect(state.project).toMatchObject({ supportsRealTime: true, supportsNonRealTime: false });
  });

  it('creates a one-shot Sound Event at any frame', () => {
    const project = createProject();
    project.compositions[0]!.assets.push(
      createAsset({
        id: 'audio',
        name: 'Goal Sting.wav',
        kind: 'audio',
        mimeType: 'audio/wav',
        durationMs: 4_000,
      }),
    );
    useProjectStore.getState().loadProject(project);
    const cueId = useProjectStore.getState().addSoundEventFromAsset('audio', 17);
    const state = useProjectStore.getState();
    const current = state.project.compositions[0]!;
    const cue = current.mediaCues.find((candidate) => candidate.id === cueId)!;
    expect(current.layers).toEqual([]);
    expect(cue).toMatchObject({
      name: 'Goal Sting',
      trigger: { type: 'timeline', startFrame: 17 },
      loop: false,
      muted: false,
      retrigger: 'restart',
      sources: [{ mediaType: 'audio', src: 'asset:audio' }],
    });
    expect(mediaCueEffectiveDurationFrames(cue, current)).toBe(100);
  });

  it('creates advanced audio playback cues as manual so they stay out of Sound Events', () => {
    const project = createProject();
    project.compositions[0]!.assets.push(
      createAsset({
        id: 'audio',
        name: 'Input.wav',
        kind: 'audio',
        mimeType: 'audio/wav',
        durationMs: 2_000,
      }),
    );
    useProjectStore.getState().loadProject(project);
    const cueId = useProjectStore.getState().addMediaCueFromAsset('audio');
    const cue = useProjectStore
      .getState()
      .project.compositions[0]!.mediaCues.find((candidate) => candidate.id === cueId)!;
    expect(cue).toMatchObject({
      name: 'Input',
      trigger: { type: 'manual' },
      sources: [{ mediaType: 'audio', src: 'asset:audio' }],
    });
  });

  it('creates live cues on the active lifecycle keyframe', () => {
    const state = useProjectStore.getState();
    const cueId = state.addLiveMediaCue();
    const current = useProjectStore.getState().project.compositions[0]!;
    expect(current.mediaCues.find((cue) => cue.id === cueId)?.trigger).toEqual({
      type: 'lifecycle',
      keyframeId: current.keyframes[1]!.id,
    });
    useProjectStore.getState().setActiveKeyframe(current.keyframes[0]!.id);
    const beforeId = useProjectStore.getState().addLiveMediaCue();
    const before = useProjectStore.getState().project.compositions[0]!;
    expect(before.mediaCues.find((cue) => cue.id === beforeId)?.trigger).toEqual({
      type: 'lifecycle',
      keyframeId: before.keyframes[0]!.id,
    });
  });

  it('updates and removes cues independently of their source assets', () => {
    const project = createProject();
    project.compositions[0]!.assets.push(
      createAsset({ id: 'video', name: 'Intro.mp4', kind: 'media', mimeType: 'video/mp4' }),
    );
    useProjectStore.getState().loadProject(project);
    const cueId = useProjectStore.getState().addMediaCueFromAsset('video');
    useProjectStore.getState().updateMediaCue(cueId, {
      name: 'Program',
      trigger: { type: 'customAction', actionId: 'take-program' },
      retrigger: 'restart',
    });
    expect(useProjectStore.getState().project.compositions[0]!.mediaCues[0]).toMatchObject({
      name: 'Program',
      trigger: { type: 'customAction', actionId: 'take-program' },
    });
    useProjectStore.getState().removeMediaCue(cueId);
    expect(useProjectStore.getState().project.compositions[0]!.mediaCues).toEqual([]);
    expect(useProjectStore.getState().project.compositions[0]!.assets).toHaveLength(1);
  });
});
