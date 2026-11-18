import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createAudioLayer,
  createComposition,
  createKeyframe,
  createMediaCue,
  createTransition,
  type Composition,
  type MediaCue,
} from '@ograf-editor/scene-model';
import { movieHold, movieSecondsAtFrame, movieSounds, movieTimeline } from './videoExportTimeline';

/** Start at frame 0, one Step at frame 12, End at frame 24, at ten frames a second. */
const oneStep = (overrides: Partial<Composition> = {}) =>
  createComposition({ frameRate: 10, ...overrides });

function twoSteps(): Composition {
  const keyframes = [
    createKeyframe({ name: 'Start', role: 'start' }),
    createKeyframe({ name: 'Step 1', role: 'step' }),
    createKeyframe({ name: 'Step 2', role: 'step' }),
    createKeyframe({ name: 'End', role: 'end' }),
  ];
  return createComposition({
    frameRate: 10,
    keyframes,
    transitions: keyframes
      .slice(1)
      .map((keyframe, index) => createTransition(keyframes[index]!.id, keyframe.id)),
  });
}

describe('movieTimeline', () => {
  it('plays the timeline through and waits on the Step', () => {
    const timeline = movieTimeline(oneStep(), 0.5);
    expect(timeline).toMatchObject({ frameRate: 10, holdFrames: 5, stepFrames: [12] });
    expect(timeline.frames).toHaveLength(25 + 5);
    expect(timeline.frames.slice(11, 19)).toEqual([
      { frame: 11, heldHere: 0 },
      { frame: 12, heldHere: 0 },
      { frame: 12, heldHere: 1 },
      { frame: 12, heldHere: 2 },
      { frame: 12, heldHere: 3 },
      { frame: 12, heldHere: 4 },
      { frame: 12, heldHere: 5 },
      { frame: 13, heldHere: 0 },
    ]);
    expect(timeline.frames.at(-1)).toEqual({ frame: 24, heldHere: 0 });
  });

  it('does not wait when the hold is zero', () => {
    expect(movieTimeline(oneStep(), 0).frames.map(({ frame }) => frame)).toEqual(
      Array.from({ length: 25 }, (_, frame) => frame),
    );
  });

  it('counts held time from the Step a loop started on', () => {
    const timeline = movieTimeline(twoSteps(), 0.5);
    expect(timeline.stepFrames).toEqual([12, 24]);
    const during = movieHold(timeline, { frame: 12, heldHere: 3 });
    expect([during.frames, during.since(0), during.since(12), during.since(13)]).toEqual([
      3, 3, 3, 0,
    ]);
    // Past the second Step: a loop that began on the first has waited through both holds.
    const after = movieHold(timeline, { frame: 30, heldHere: 0 });
    expect([after.frames, after.since(12), after.since(24), after.since(25)]).toEqual([
      10, 10, 5, 0,
    ]);
  });

  it('places a frame on the movie clock after the holds before it', () => {
    const timeline = movieTimeline(oneStep(), 0.5);
    expect(movieSecondsAtFrame(timeline, 12)).toBe(1.2);
    expect(movieSecondsAtFrame(timeline, 13)).toBe(1.8);
  });
});

describe('movieSounds', () => {
  const sound = createAsset({ kind: 'audio', dataUri: 'data:audio/wav;base64,AAAA' });
  const clip = (overrides: Partial<MediaCue> = {}) =>
    createMediaCue({
      sources: [
        { id: 'clip', name: 'Clip', kind: 'clip', mediaType: 'audio', src: `asset:${sound.id}` },
      ],
      activeSourceId: 'clip',
      ...overrides,
    });

  it('schedules timeline and Step cues on the movie clock', () => {
    const composition = oneStep({ assets: [sound] });
    composition.mediaCues = [
      clip({ trigger: { type: 'timeline', startFrame: 13 }, speed: 2, volume: 0.5 }),
      clip({ trigger: { type: 'lifecycle', keyframeId: composition.keyframes[1]!.id } }),
      clip({
        trigger: { type: 'timeline', startFrame: 0 },
        trimStartMs: 100,
        trimEndMs: 600,
        durationFrames: 5,
        loop: true,
      }),
    ];
    expect(movieSounds(composition, movieTimeline(composition, 0.5))).toEqual([
      {
        src: sound.dataUri,
        startSeconds: 1.8,
        offsetSeconds: 0,
        spanSeconds: null,
        stopSeconds: null,
        loop: false,
        speed: 2,
        volume: 0.5,
      },
      {
        src: sound.dataUri,
        startSeconds: 1.2,
        offsetSeconds: 0,
        spanSeconds: null,
        stopSeconds: null,
        loop: false,
        speed: 1,
        volume: 1,
      },
      {
        src: sound.dataUri,
        startSeconds: 0,
        offsetSeconds: 0.1,
        spanSeconds: 0.5,
        stopSeconds: 0.5,
        loop: true,
        speed: 1,
        volume: 1,
      },
    ]);
  });

  it('leaves out sounds that have no place on a timeline', () => {
    const composition = oneStep({ assets: [sound] });
    composition.mediaCues = [
      clip({ trigger: { type: 'customAction', actionId: 'sting' } }),
      clip({ trigger: { type: 'manual' } }),
      clip({ muted: true }),
      clip({ volume: 0 }),
      clip({ activeSourceId: null }),
      createMediaCue({
        sources: [{ id: 'film', name: 'Film', kind: 'clip', mediaType: 'video', src: 'film.mp4' }],
        activeSourceId: 'film',
      }),
      createMediaCue({
        sources: [{ id: 'camera', name: 'Camera', kind: 'live', tag: 'Camera' }],
        activeSourceId: 'camera',
      }),
    ];
    expect(movieSounds(composition, movieTimeline(composition, 0.5))).toEqual([]);
  });

  it('includes visible audio layers', () => {
    const heard = createAudioLayer();
    const hidden = createAudioLayer();
    hidden.isVisible = false;
    for (const layer of [heard, hidden])
      layer.element = {
        type: 'audio',
        src: `asset:${sound.id}`,
        volume: 0.8,
        loop: true,
        trimStartMs: 0,
        trimEndMs: null,
        timelineStartMs: 2000,
      };
    const composition = oneStep({ assets: [sound], layers: [heard, hidden] });
    expect(movieSounds(composition, movieTimeline(composition, 0.5))).toEqual([
      {
        src: sound.dataUri,
        // Two seconds is frame 20, which the movie reaches half a second later because of the hold.
        startSeconds: 2.5,
        offsetSeconds: 0,
        spanSeconds: null,
        stopSeconds: null,
        loop: true,
        speed: 1,
        volume: 0.8,
      },
    ]);
  });
});
