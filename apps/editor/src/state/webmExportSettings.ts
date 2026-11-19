import { getCompositionOutputRect, type Composition } from '@ograf-editor/scene-model';
import { movieSounds, movieTiming, type MovieTiming } from './videoExportTimeline';

export const WEBM_AUDIO_BITRATE = 128_000;

interface WebmOutputSettings {
  transparent: boolean;
  holdSeconds: number;
  size?: { width: number; height: number };
  bitrate?: number;
  blackFrameAtStart?: boolean;
  blackFrameAtEnd?: boolean;
}

/** VP9 stores colour at half resolution, so the encoded raster must have even sides. */
export function webmRasterSize({ width, height }: { width: number; height: number }) {
  return { width: width + (width % 2), height: height + (height % 2) };
}

export function webmVideoBitrates(
  size: { width: number; height: number },
  frameRate: number,
  { transparent, bitrate }: Pick<WebmOutputSettings, 'transparent' | 'bitrate'>,
) {
  const autoColour = Math.round(
    Math.min(40e6, Math.max(1e6, size.width * size.height * frameRate * 0.03)),
  );
  const autoAlpha = transparent ? Math.round(autoColour / 2) : 0;
  const alpha =
    transparent && bitrate !== undefined ? Math.max(1, Math.round(bitrate / 3)) : autoAlpha;
  const colour = bitrate === undefined ? autoColour : bitrate - alpha;
  return { colour, alpha, autoVideoBitrate: autoColour + autoAlpha };
}

export function webmMovieTiming(
  timeline: MovieTiming,
  {
    blackFrameAtStart,
    blackFrameAtEnd,
  }: Pick<WebmOutputSettings, 'blackFrameAtStart' | 'blackFrameAtEnd'>,
) {
  const startFrames = blackFrameAtStart ? 1 : 0;
  const endFrames = blackFrameAtEnd ? 1 : 0;
  const frameCount = startFrames + timeline.frameCount + endFrames;
  return { startFrames, endFrames, frameCount, durationSeconds: frameCount / timeline.frameRate };
}

/** Estimate target payload bytes before encoding, including the alpha and eligible audio streams. */
export function estimateWebmExport(composition: Composition, options: WebmOutputSettings) {
  const raster = webmRasterSize(options.size ?? getCompositionOutputRect(composition));
  const timeline = movieTiming(composition, options.holdSeconds);
  const { durationSeconds, startFrames, endFrames } = webmMovieTiming(timeline, options);
  const { colour, alpha, autoVideoBitrate } = webmVideoBitrates(
    raster,
    timeline.frameRate,
    options,
  );
  const videoBitrate = colour + alpha;
  const sounds = movieSounds(composition, timeline, {
    startFrames,
    endFrames,
    resolveSources: false,
  });
  const audioBitrate = sounds.some(({ startSeconds }) => startSeconds < durationSeconds)
    ? WEBM_AUDIO_BITRATE
    : 0;
  const estimatedBytes = Math.round(((videoBitrate + audioBitrate) * durationSeconds) / 8);
  return {
    ...raster,
    videoBitrate,
    autoVideoBitrate,
    audioBitrate,
    durationSeconds,
    estimatedBytes,
  };
}
