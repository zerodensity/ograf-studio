import {
  computeKeyframeFrames,
  resolveAssetValue,
  type Composition,
} from '@ograf-editor/scene-model';
import type { CaptureHold } from './agentCapture';

/** One picture of a movie: a composition frame, and how long the movie has waited on it. */
export interface MovieFrame {
  /** The composition frame shown. */
  frame: number;
  /** Frames already spent holding on this frame, when it is a Step. */
  heldHere: number;
}

/**
 * A composition's timeline as a movie plays it: straight through from Start to End, waiting on
 * every Step the way a graphic waits on air.
 */
export interface MovieTimeline {
  frameRate: number;
  /** Frames the movie waits on each Step. */
  holdFrames: number;
  /** The composition frames of the Steps, in order. */
  stepFrames: readonly number[];
  frames: readonly MovieFrame[];
}

export function movieTimeline(
  composition: Composition,
  holdSeconds: number,
  frameLimit = Number.POSITIVE_INFINITY,
): MovieTimeline {
  const frameRate = composition.frameRate;
  const holdFrames = Math.max(0, Math.round(holdSeconds * frameRate));
  const keyframes = computeKeyframeFrames(composition);
  const lastFrame = keyframes.at(-1)?.frame ?? 0;
  const stepFrames = keyframes
    .filter((_, index) => composition.keyframes[index]?.role === 'step')
    .map(({ frame }) => frame);
  const steps = new Set(stepFrames);
  const frameCount = lastFrame + 1 + holdFrames * steps.size;
  if (!Number.isSafeInteger(frameCount) || frameCount > frameLimit)
    throw new Error('The timeline has too many frames for this export. Reduce the Step hold time.');
  const frames: MovieFrame[] = [];
  for (let frame = 0; frame <= lastFrame; frame += 1) {
    frames.push({ frame, heldHere: 0 });
    if (steps.has(frame))
      for (let held = 1; held <= holdFrames; held += 1) frames.push({ frame, heldHere: held });
  }
  return { frameRate, holdFrames, stepFrames, frames };
}

/** The time a movie has waited on Steps by one of its pictures, for the frame renderer. */
export function movieHold(timeline: MovieTimeline, at: MovieFrame): CaptureHold {
  const since = (from: number) =>
    timeline.stepFrames.reduce((held, step) => {
      if (step < from || step > at.frame) return held;
      return held + (step === at.frame ? at.heldHere : timeline.holdFrames);
    }, 0);
  return { frames: since(0), since };
}

/** Seconds into the movie at which a composition frame is first shown. */
export function movieSecondsAtFrame(timeline: MovieTimeline, frame: number): number {
  const passed = timeline.stepFrames.filter((step) => step < frame).length;
  return (frame + passed * timeline.holdFrames) / timeline.frameRate;
}

/** One sound of a movie, placed on the movie's own clock. */
export interface MovieSound {
  /** A URL or data URI of the sound file. */
  src: string;
  startSeconds: number;
  /** Where in the sound file playback starts, and how much of the file is played. */
  offsetSeconds: number;
  /** Seconds of the file to play; null plays to its end. */
  spanSeconds: number | null;
  /** Movie time at which the sound is cut off; null lets it finish or loop to the end. */
  stopSeconds: number | null;
  loop: boolean;
  speed: number;
  volume: number;
}

/**
 * The sounds a movie can carry: audio layers, and sound cues that start at a frame of the timeline
 * or on arrival at a Step. Cues fired by an operator or a custom action have no place on it.
 * Any extra black frames are silent.
 */
export function movieSounds(
  composition: Composition,
  timeline: MovieTimeline,
  { startFrames = 0, endFrames = 0 }: { startFrames?: number; endFrames?: number } = {},
): MovieSound[] {
  const keyframes = computeKeyframeFrames(composition);
  const sounds: MovieSound[] = [];
  for (const cue of composition.mediaCues) {
    const source = cue.sources.find(({ id }) => id === cue.activeSourceId);
    if (!source || source.kind !== 'clip' || source.mediaType !== 'audio') continue;
    if (cue.muted || cue.volume <= 0) continue;
    const { trigger } = cue;
    const frame =
      trigger.type === 'timeline'
        ? trigger.startFrame
        : trigger.type === 'lifecycle'
          ? keyframes.find(({ keyframeId }) => keyframeId === trigger.keyframeId)?.frame
          : undefined;
    if (frame === undefined) continue;
    const startSeconds = movieSecondsAtFrame(timeline, frame);
    sounds.push({
      src: resolveAssetValue(source.src, composition.assets),
      startSeconds,
      offsetSeconds: cue.trimStartMs / 1000,
      spanSeconds: cue.trimEndMs === null ? null : (cue.trimEndMs - cue.trimStartMs) / 1000,
      stopSeconds:
        cue.durationFrames === null ? null : startSeconds + cue.durationFrames / timeline.frameRate,
      loop: cue.loop,
      speed: cue.speed,
      volume: cue.volume,
    });
  }
  for (const layer of composition.layers) {
    const { element } = layer;
    if (element.type !== 'audio' || !element.src || !layer.isVisible || element.volume <= 0)
      continue;
    sounds.push({
      src: resolveAssetValue(element.src, composition.assets),
      startSeconds: movieSecondsAtFrame(
        timeline,
        (element.timelineStartMs / 1000) * timeline.frameRate,
      ),
      offsetSeconds: element.trimStartMs / 1000,
      spanSeconds:
        element.trimEndMs === null ? null : (element.trimEndMs - element.trimStartMs) / 1000,
      stopSeconds: null,
      loop: element.loop,
      speed: 1,
      volume: element.volume,
    });
  }
  const playable = sounds.filter(({ spanSeconds }) => spanSeconds === null || spanSeconds > 0);
  if (!startFrames && !endFrames) return playable;

  const authoredDuration = timeline.frames.length / timeline.frameRate;
  const offset = startFrames / timeline.frameRate;
  const end = (timeline.frames.length + startFrames) / timeline.frameRate;
  return playable
    .filter(({ startSeconds }) => startSeconds < authoredDuration)
    .map((sound) => {
      const stop = sound.stopSeconds === null ? null : sound.stopSeconds + offset;
      return {
        ...sound,
        startSeconds: sound.startSeconds + offset,
        stopSeconds: endFrames ? Math.min(stop ?? end, end) : stop,
      };
    });
}
