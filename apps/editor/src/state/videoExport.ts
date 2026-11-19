import { NLE_EXPORT_PROFILE, compositionForExportProfile } from '@ograf-editor/codegen';
import type { Composition, Project } from '@ograf-editor/scene-model';
import { mountCompositionFrames } from './agentCapture';
import {
  createFramePicturePool,
  inOrder,
  type FramePicturePool,
  type FramePlanes,
} from './framePicturePool';
import { awaitExportOperation } from './exportAbort';
import {
  createExportFolder,
  discardExportFolder,
  sanitizeExportName,
  writeExportFolderFile,
} from './exportFolderSave';
import type { ExportFile } from './offlinePreviewPackage';
import {
  movieHold,
  movieSounds,
  movieTimeline,
  type MovieSound,
  type MovieTimeline,
} from './videoExportTimeline';
import { writeWebm, type WebmAudioTrack, type WebmColour, type WebmFrame } from './webmFile';

export type WebmExportProgress =
  { stage: 'picture'; frame: number; frames: number } | { stage: 'sound' } | { stage: 'file' };

interface VideoFrameExportOptions {
  /** Keep what the graphic does not cover see-through, instead of filling it. */
  transparent: boolean;
  /** Seconds the movie waits on each Step, as a graphic waits on air. */
  holdSeconds: number;
  /** Raster size after cropping and rendering the authored composition. */
  size?: { width: number; height: number };
  signal: AbortSignal;
  onProgress?: (progress: WebmExportProgress) => void;
}

export interface WebmExportOptions extends VideoFrameExportOptions {
  /** Total target bitrate in bits per second for color and transparency. */
  bitrate?: number;
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

/** Past four trees the page itself is what limits a PNG sequence's frames. */
const PNG_FRAME_COPIES = 4;
/**
 * A WebM moves at its encoder's pace. Two trees outrun the encoder on a 60 Hz screen, and more
 * only take the processor from it: on a fast screen four made the movie slower.
 */
const WEBM_FRAME_COPIES = 2;

/**
 * How many trees of the composition render at once, `most` at best. A tree takes about as long to
 * mount as thirty frames take to render.
 */
function frameCopies(frames: number, most: number): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(most, cores - 1, Math.ceil(frames / 30)));
}

function mountVideoExportFrames(
  composition: Composition,
  { transparent, signal, size }: VideoFrameExportOptions,
  frames: number,
  mostCopies: number,
) {
  if (
    size &&
    [size.width, size.height].some(
      (dimension) => !Number.isInteger(dimension) || dimension < 1 || dimension > 0xffffffff,
    )
  )
    throw new Error('Enter positive whole pixel dimensions for the export size.');
  return mountCompositionFrames(
    transparent ? compositionForExportProfile(composition, NLE_EXPORT_PROFILE) : composition,
    transparent ? 'transparent' : '#000000',
    signal,
    size,
    frameCopies(frames, mostCopies),
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
  options: WebmExportOptions,
): Promise<ExportFile> {
  const { transparent, holdSeconds, signal, onProgress, bitrate } = options;
  if (!webmExportSupported())
    throw new Error('This browser cannot encode video. Use a current Chrome or Edge for WebM.');
  signal.throwIfAborted();
  if (bitrate !== undefined && (!Number.isSafeInteger(bitrate) || bitrate < 1))
    throw new Error('Enter a positive target video bitrate.');
  if (transparent && bitrate === 1)
    throw new Error('Transparent video needs a target bitrate of at least 2 bits per second.');
  const timeline = movieTimeline(composition, holdSeconds);
  const { frameRate } = timeline;
  const frameCount = timeline.frames.length;
  const mounted = await mountVideoExportFrames(composition, options, frameCount, WEBM_FRAME_COPIES);
  // VP9 pictures store colour at half size, so the picture's sides are made even.
  const width = mounted.width + (mounted.width % 2);
  const height = mounted.height + (mounted.height % 2);
  const autoBitrate = Math.round(Math.min(40e6, Math.max(1e6, width * height * frameRate * 0.03)));
  const alphaBitrate = transparent
    ? bitrate === undefined
      ? Math.round(autoBitrate / 2)
      : Math.max(1, Math.round(bitrate / 3))
    : 0;
  const config: VideoEncoderConfig = {
    codec: vp9Codec(width, height, frameRate),
    width,
    height,
    framerate: frameRate,
    bitrate: bitrate === undefined ? autoBitrate : bitrate - alphaBitrate,
    latencyMode: 'quality',
  };
  const encoders: ReturnType<typeof pictureEncoder>[] = [];
  let pool: FramePicturePool | undefined;
  try {
    const alphaConfig = transparent ? { ...config, bitrate: alphaBitrate } : null;
    if (
      !(await VideoEncoder.isConfigSupported(config)).supported ||
      (alphaConfig && !(await VideoEncoder.isConfigSupported(alphaConfig)).supported)
    )
      throw new Error(
        `This browser cannot encode a ${width} × ${height} WebM at the selected bitrate.`,
      );
    signal.throwIfAborted();
    const colourEncoder = pictureEncoder(config);
    encoders.push(colourEncoder);
    // Transparency is a second picture stream whose brightness is the alpha.
    const alphaEncoder = alphaConfig ? pictureEncoder(alphaConfig) : null;
    if (alphaEncoder) encoders.push(alphaEncoder);

    const keyEvery = Math.max(1, Math.round(frameRate * KEY_PICTURE_SECONDS));
    const timingAt = (index: number) => ({
      timestamp: Math.round((index * 1e6) / frameRate),
      duration: Math.round(1e6 / frameRate),
    });
    const encoded = async (index: number) => {
      for (const encoder of encoders) await encoder.settle(signal);
      onProgress?.({ stage: 'picture', frame: index + 1, frames: frameCount });
    };

    if (alphaEncoder) {
      // Splitting a frame into colour and alpha means reading every pixel back. Workers do that
      // beside the page, and the frames still reach the encoders in the movie's order.
      const workers = createFramePicturePool();
      pool = workers;
      const frames = inOrder<FramePlanes>(
        mounted.copies + workers.size,
        async ({ colour, alpha }, index) => {
          const key = index % keyEvery === 0;
          // Each encoder closes the frame it is given, also when it refuses it.
          try {
            signal.throwIfAborted();
          } catch (error) {
            colour.close();
            alpha.close();
            throw error;
          }
          try {
            colourEncoder.encode(colour, key);
          } catch (error) {
            alpha.close();
            throw error;
          }
          alphaEncoder.encode(alpha, key);
          await encoded(index);
        },
        ({ colour, alpha }) => {
          colour.close();
          alpha.close();
        },
      );
      for (const [index, movieFrame] of timeline.frames.entries()) {
        signal.throwIfAborted();
        await frames.add(
          mounted
            .pictureAt(movieFrame.frame, movieHold(timeline, movieFrame))
            .then((picture) => workers.planes(picture, { ...timingAt(index), width, height })),
        );
      }
      await awaitExportOperation(frames.finish(), signal);
    } else {
      const work = document.createElement('canvas');
      work.width = width;
      work.height = height;
      const context = work.getContext('2d');
      if (!context) throw new Error('The browser could not provide a drawing surface.');
      const pictures = inOrder<ImageBitmap>(
        mounted.copies + 1,
        async (picture, index) => {
          try {
            signal.throwIfAborted();
            context.fillStyle = '#000000';
            context.fillRect(0, 0, width, height);
            context.drawImage(picture, 0, 0);
          } finally {
            picture.close();
          }
          const frame = new VideoFrame(work, { ...timingAt(index), alpha: 'discard' });
          colourEncoder.encode(frame, index % keyEvery === 0);
          await encoded(index);
        },
        (picture) => picture.close(),
      );
      for (const movieFrame of timeline.frames) {
        signal.throwIfAborted();
        await pictures.add(mounted.pictureAt(movieFrame.frame, movieHold(timeline, movieFrame)));
      }
      await awaitExportOperation(pictures.finish(), signal);
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
    pool?.dispose();
    for (const encoder of encoders) encoder.close();
    mounted.dispose();
  }
}

/**
 * Renders the movie timeline to PNG files. Workers compress them beside the page, a few at a time,
 * so only that many uncompressed pictures exist at once. Frames are written as soon as they
 * are compressed, while progress follows their order in the movie.
 */
async function renderPngFrames(
  composition: Composition,
  options: VideoFrameExportOptions,
  timeline: MovieTimeline,
  write: (png: ArrayBuffer, index: number) => Promise<void>,
): Promise<void> {
  const { signal, onProgress } = options;
  const frameCount = timeline.frames.length;
  const mounted = await mountVideoExportFrames(composition, options, frameCount, PNG_FRAME_COPIES);
  let pool: FramePicturePool | undefined;
  let stopped = false;
  try {
    const workers = createFramePicturePool();
    pool = workers;
    const frames = inOrder<void>(mounted.copies + workers.size, (_, index) => {
      signal.throwIfAborted();
      onProgress?.({ stage: 'picture', frame: index + 1, frames: frameCount });
    });
    for (const [index, movieFrame] of timeline.frames.entries()) {
      signal.throwIfAborted();
      await frames.add(
        mounted
          .pictureAt(movieFrame.frame, movieHold(timeline, movieFrame))
          .then((picture) => workers.png(picture))
          .then((png) => {
            // After a failed frame, do not start any late writes during folder cleanup.
            if (stopped) return;
            signal.throwIfAborted();
            if (!png.byteLength)
              throw new Error('The browser could not encode the PNG at this size.');
            return write(png, index);
          }),
      );
    }
    await awaitExportOperation(frames.finish(), signal);
  } finally {
    stopped = true;
    pool?.dispose();
    mounted.dispose();
  }
}

/**
 * Render the movie timeline to numbered PNGs in a new folder inside `parent`, and return the
 * folder's name. Each frame is written as soon as it is compressed, so the movie is never held in
 * memory and has no limit on its length or size. A movie that fails or is cancelled leaves no
 * folder behind.
 */
export async function savePngSequenceInFolder(
  project: Project,
  composition: Composition,
  options: VideoFrameExportOptions,
  parent: FileSystemDirectoryHandle,
): Promise<string> {
  const { holdSeconds, signal } = options;
  signal.throwIfAborted();
  const timeline = movieTimeline(composition, holdSeconds);
  const { name, folder } = await createExportFolder(parent, project.name, signal);
  const frameNameBase = sanitizeExportName(project.name);
  const writing = new Set<Promise<void>>();
  try {
    await renderPngFrames(composition, options, timeline, async (png, index) => {
      const frameName = `${frameNameBase}.${String(index + 1).padStart(4, '0')}.png`;
      const written = writeExportFolderFile(
        folder,
        frameName,
        new Blob([png], { type: 'image/png' }),
        signal,
      );
      writing.add(written);
      try {
        await written;
      } finally {
        writing.delete(written);
      }
    });
    return name;
  } catch (error) {
    // A file still being written would keep the folder from being removed.
    await Promise.allSettled(writing);
    return await discardExportFolder(parent, name, error);
  }
}
