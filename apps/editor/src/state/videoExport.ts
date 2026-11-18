import { NLE_EXPORT_PROFILE, compositionForExportProfile } from '@ograf-editor/codegen';
import type { Composition, Project } from '@ograf-editor/scene-model';
import { mountCompositionFrames } from './agentCapture';
import { awaitExportOperation } from './exportAbort';
import type { ExportFile } from './offlinePreviewPackage';
import { movieHold, movieSounds, movieTimeline, type MovieSound } from './videoExportTimeline';
import { writeWebm, type WebmAudioTrack, type WebmColour, type WebmFrame } from './webmFile';

export type WebmExportProgress =
  { stage: 'picture'; frame: number; frames: number } | { stage: 'sound' } | { stage: 'file' };

export interface WebmExportOptions {
  /** Keep what the graphic does not cover see-through, instead of filling it. */
  transparent: boolean;
  /** Seconds the movie waits on each Step, as a graphic waits on air. */
  holdSeconds: number;
  signal: AbortSignal;
  onProgress?: (progress: WebmExportProgress) => void;
}

const SOUND_RATE = 48_000;
const SOUND_CHANNELS = 2;
const SOUND_FRAME_SAMPLES = 960;
/** A key picture every two seconds: a player can start there, and so can a WebM cluster. */
const KEY_PICTURE_SECONDS = 2;

/** VP9 levels: [level, luma samples a second, luma samples a picture]. */
const VP9_LEVELS = [
  [10, 829_440, 36_864],
  [11, 2_764_800, 73_728],
  [20, 4_608_000, 122_880],
  [21, 9_216_000, 245_760],
  [30, 20_736_000, 552_960],
  [31, 36_864_000, 983_040],
  [40, 83_558_400, 2_228_224],
  [41, 160_432_128, 2_228_224],
  [50, 311_951_360, 8_912_896],
  [51, 588_251_136, 8_912_896],
  [52, 1_176_502_272, 8_912_896],
  [60, 1_176_502_272, 35_651_584],
  [61, 2_353_004_544, 35_651_584],
  [62, 4_706_009_088, 35_651_584],
] as const;

/** Matroska's numbers for the colour names an encoder reports. */
const COLOUR_NUMBERS = {
  matrix: { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6 },
  primaries: { bt709: 1, bt470bg: 5, smpte170m: 6 },
  transfer: { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13 },
} as const;
const UNSPECIFIED_COLOUR = 2;

export function webmExportSupported(): boolean {
  return (
    typeof VideoEncoder === 'function' &&
    typeof AudioEncoder === 'function' &&
    typeof VideoFrame === 'function' &&
    typeof OfflineAudioContext === 'function'
  );
}

function vp9Codec(width: number, height: number, frameRate: number): string {
  const picture = width * height;
  const level =
    VP9_LEVELS.find(([, rate, size]) => picture * frameRate <= rate && picture <= size)?.[0] ??
    VP9_LEVELS.at(-1)![0];
  return `vp09.00.${level}.08`;
}

interface EncodedPicture {
  timeUs: number;
  key: boolean;
  data: Uint8Array;
}

/** One VP9 encoder and the pictures it has produced. */
function pictureEncoder(config: VideoEncoderConfig) {
  const pictures: EncodedPicture[] = [];
  let colour: VideoColorSpaceInit | null = null;
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      pictures.push({ timeUs: chunk.timestamp, key: chunk.type === 'key', data });
      colour ??= metadata?.decoderConfig?.colorSpace ?? null;
    },
    error(error) {
      failure = error;
    },
  });
  encoder.configure(config);
  return {
    pictures,
    colour: () => colour,
    encode(frame: VideoFrame, key: boolean) {
      try {
        if (failure) throw failure;
        encoder.encode(frame, { keyFrame: key });
      } finally {
        frame.close();
      }
    },
    /** Lets the encoder catch up, so pictures do not pile up in memory faster than it works. */
    async settle(signal: AbortSignal) {
      while (encoder.encodeQueueSize > 2) {
        signal.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
      if (failure) throw failure;
    },
    async finish() {
      await encoder.flush();
      if (failure) throw failure;
    },
    close() {
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}

function webmColour(colour: VideoColorSpaceInit | null): WebmColour | null {
  if (!colour?.matrix || !colour.primaries || !colour.transfer) return null;
  const number = (table: Record<string, number>, name: string) => table[name] ?? UNSPECIFIED_COLOUR;
  return {
    matrix: number(COLOUR_NUMBERS.matrix, colour.matrix),
    primaries: number(COLOUR_NUMBERS.primaries, colour.primaries),
    transfer: number(COLOUR_NUMBERS.transfer, colour.transfer),
    range: colour.fullRange ? 2 : 1,
  };
}

/** The Opus identification header, for an encoder that does not hand one over. */
function opusHead(channels: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode('OpusHead'));
  const view = new DataView(head.buffer);
  view.setUint8(8, 1);
  view.setUint8(9, channels);
  view.setUint16(10, 312, true); // libopus's start-up delay at 48 kHz
  view.setUint32(12, SOUND_RATE, true);
  return head;
}

/** Mixes the movie's sounds on its own clock and encodes the mix as Opus. */
async function encodeSound(
  sounds: readonly MovieSound[],
  seconds: number,
  signal: AbortSignal,
): Promise<WebmAudioTrack | null> {
  const audible = sounds.filter(({ startSeconds }) => startSeconds < seconds);
  if (!audible.length) return null;
  const context = new OfflineAudioContext(
    SOUND_CHANNELS,
    Math.ceil(seconds * SOUND_RATE),
    SOUND_RATE,
  );
  const decoded = new Map<string, Promise<AudioBuffer>>();
  for (const sound of audible) {
    if (!decoded.has(sound.src))
      decoded.set(
        sound.src,
        fetch(sound.src, { signal })
          .then((response) => {
            if (!response.ok)
              throw new Error(`A sound file could not be read (${response.status}).`);
            return response.arrayBuffer();
          })
          .then((bytes) => context.decodeAudioData(bytes)),
      );
    const buffer = await awaitExportOperation(decoded.get(sound.src)!, signal);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = sound.speed;
    const gain = context.createGain();
    gain.gain.value = sound.volume;
    source.connect(gain).connect(context.destination);
    const span = sound.spanSeconds ?? Math.max(0, buffer.duration - sound.offsetSeconds);
    if (sound.loop) {
      source.loop = true;
      source.loopStart = sound.offsetSeconds;
      source.loopEnd = sound.offsetSeconds + span;
      source.start(sound.startSeconds, sound.offsetSeconds);
    } else {
      source.start(sound.startSeconds, sound.offsetSeconds, span);
    }
    if (sound.stopSeconds !== null) source.stop(sound.stopSeconds);
  }
  const mixed = await awaitExportOperation(context.startRendering(), signal);

  const frames: WebmFrame[] = [];
  let head: Uint8Array | null = null;
  let failure: Error | null = null;
  const encoder = new AudioEncoder({
    output(chunk, metadata) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({ timeMs: Math.round(chunk.timestamp / 1000), key: true, data });
      const description = metadata?.decoderConfig?.description;
      if (description && !head)
        head = ArrayBuffer.isView(description)
          ? new Uint8Array(
              description.buffer,
              description.byteOffset,
              description.byteLength,
            ).slice()
          : new Uint8Array(description).slice();
    },
    error(error) {
      failure = error;
    },
  });
  try {
    encoder.configure({
      codec: 'opus',
      sampleRate: SOUND_RATE,
      numberOfChannels: SOUND_CHANNELS,
      bitrate: 128_000,
    });
    const channels = Array.from({ length: SOUND_CHANNELS }, (_, index) =>
      mixed.getChannelData(index),
    );
    for (let at = 0; at < mixed.length; at += SOUND_FRAME_SAMPLES) {
      signal.throwIfAborted();
      const size = Math.min(SOUND_FRAME_SAMPLES, mixed.length - at);
      const planes = new Float32Array(size * SOUND_CHANNELS);
      channels.forEach((channel, index) =>
        planes.set(channel.subarray(at, at + size), index * size),
      );
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: SOUND_RATE,
        numberOfFrames: size,
        numberOfChannels: SOUND_CHANNELS,
        timestamp: Math.round((at / SOUND_RATE) * 1e6),
        data: planes,
      });
      encoder.encode(data);
      data.close();
    }
    await awaitExportOperation(encoder.flush(), signal);
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  return {
    opusHead: head ?? opusHead(SOUND_CHANNELS),
    sampleRate: SOUND_RATE,
    channels: SOUND_CHANNELS,
    frames,
  };
}

/**
 * Renders a template's timeline as a WebM movie with the browser's own encoders: VP9 picture, and
 * Opus sound when the template has sound on its timeline. The movie plays from Start to End and
 * waits on every Step.
 */
export async function prepareWebmExportFile(
  project: Project,
  composition: Composition,
  { transparent, holdSeconds, signal, onProgress }: WebmExportOptions,
): Promise<ExportFile> {
  if (!webmExportSupported())
    throw new Error('This browser cannot encode video. Use a current Chrome or Edge for WebM.');
  signal.throwIfAborted();
  const timeline = movieTimeline(composition, holdSeconds);
  const { frameRate } = timeline;
  const frameCount = timeline.frames.length;
  const mounted = await mountCompositionFrames(
    transparent ? compositionForExportProfile(composition, NLE_EXPORT_PROFILE) : composition,
    transparent ? 'transparent' : '#000000',
    signal,
  );
  // VP9 pictures store colour at half size, so the picture's sides are made even.
  const width = mounted.width + (mounted.width % 2);
  const height = mounted.height + (mounted.height % 2);
  const config: VideoEncoderConfig = {
    codec: vp9Codec(width, height, frameRate),
    width,
    height,
    framerate: frameRate,
    bitrate: Math.round(Math.min(40e6, Math.max(1e6, width * height * frameRate * 0.03))),
    latencyMode: 'quality',
  };
  const encoders: ReturnType<typeof pictureEncoder>[] = [];
  try {
    if (!(await VideoEncoder.isConfigSupported(config)).supported)
      throw new Error(`This browser cannot encode a ${width} × ${height} WebM.`);
    const colourEncoder = pictureEncoder(config);
    encoders.push(colourEncoder);
    // Transparency is a second picture stream whose brightness is the alpha.
    const alphaEncoder = transparent
      ? pictureEncoder({ ...config, bitrate: Math.round(config.bitrate! / 2) })
      : null;
    if (alphaEncoder) encoders.push(alphaEncoder);

    const work = document.createElement('canvas');
    work.width = width;
    work.height = height;
    const context = work.getContext('2d', { willReadFrequently: transparent });
    if (!context) throw new Error('The browser could not provide a drawing surface.');
    const alphaPlanes = new Uint8Array(width * height + 2 * (width / 2) * (height / 2)).fill(128);
    const keyEvery = Math.max(1, Math.round(frameRate * KEY_PICTURE_SECONDS));

    for (const [index, movieFrame] of timeline.frames.entries()) {
      signal.throwIfAborted();
      const canvas = await mounted.canvasAt(movieFrame.frame, movieHold(timeline, movieFrame));
      context.clearRect(0, 0, width, height);
      if (!transparent) {
        context.fillStyle = '#000000';
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(canvas, 0, 0);
      const timing = {
        timestamp: Math.round((index * 1e6) / frameRate),
        duration: Math.round(1e6 / frameRate),
      };
      const key = index % keyEvery === 0;
      if (alphaEncoder) {
        // getImageData gives colours that are not multiplied by their alpha, as WebM stores them.
        const pixels = context.getImageData(0, 0, width, height).data;
        for (let pixel = 0; pixel < width * height; pixel += 1)
          alphaPlanes[pixel] = pixels[pixel * 4 + 3]!;
        const size = { codedWidth: width, codedHeight: height, ...timing };
        colourEncoder.encode(new VideoFrame(pixels, { format: 'RGBX', ...size }), key);
        alphaEncoder.encode(new VideoFrame(alphaPlanes, { format: 'I420', ...size }), key);
      } else {
        colourEncoder.encode(new VideoFrame(work, { ...timing, alpha: 'discard' }), key);
      }
      for (const encoder of encoders) await encoder.settle(signal);
      onProgress?.({ stage: 'picture', frame: index + 1, frames: frameCount });
    }
    for (const encoder of encoders) await awaitExportOperation(encoder.finish(), signal);
    const alphaPictures = alphaEncoder?.pictures;
    if (
      colourEncoder.pictures.length !== frameCount ||
      (alphaPictures && alphaPictures.length !== frameCount)
    )
      throw new Error('The video encoder did not return every picture.');

    onProgress?.({ stage: 'sound' });
    const audio = await encodeSound(
      movieSounds(composition, timeline),
      frameCount / frameRate,
      signal,
    );

    onProgress?.({ stage: 'file' });
    const bytes = writeWebm({
      durationMs: (frameCount * 1000) / frameRate,
      video: {
        width,
        height,
        frameMs: 1000 / frameRate,
        colour: webmColour(colourEncoder.colour()),
        frames: colourEncoder.pictures.map((picture, index) => {
          const alpha = alphaPictures?.[index];
          return {
            timeMs: Math.round(picture.timeUs / 1000),
            // A player starts decoding at a key picture, so both streams must have one there.
            key: picture.key && (alpha?.key ?? true),
            data: picture.data,
            ...(alpha ? { alpha: alpha.data } : {}),
          };
        }),
      },
      audio,
      app: 'OGraf Studio',
    });
    signal.throwIfAborted();
    return {
      format: 'webm',
      fileName: `${project.name || 'untitled'}.webm`,
      blob: new Blob([bytes], { type: 'video/webm' }),
    };
  } finally {
    for (const encoder of encoders) encoder.close();
    mounted.dispose();
  }
}
