import { createComposition, createProject } from '@ograf-editor/scene-model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCompositionFrames, type CaptureHold } from './agentCapture';
import { createExportFolder, discardExportFolder, writeExportFolderFile } from './exportFolderSave';
import { createFramePicturePool } from './framePicturePool';
import { prepareWebmExportFile, savePngSequenceInFolder } from './videoExport';
import { movieTimeline } from './videoExportTimeline';

vi.mock('./agentCapture', () => ({ mountCompositionFrames: vi.fn() }));
vi.mock('./exportFolderSave', async (original) => ({
  ...(await original<typeof import('./exportFolderSave')>()),
  createExportFolder: vi.fn(),
  discardExportFolder: vi.fn(),
  writeExportFolderFile: vi.fn(),
}));
vi.mock('./framePicturePool', async (original) => ({
  ...(await original<typeof import('./framePicturePool')>()),
  createFramePicturePool: vi.fn(),
}));

const project = createProject({ name: 'Lower third' });

/** A picture that only remembers which frame it shows, so the PNG files prove ordering. */
type StandInPicture = ImageBitmap & { png: ArrayBuffer };

function mockMountedFrames(width: number, height: number, copies = 2) {
  const pictureAt = vi.fn(async (frame: number, hold?: CaptureHold) => {
    const png = new Uint8Array([frame, hold?.frames ?? 0]).buffer;
    return { width, height, close: vi.fn(), png } as unknown as StandInPicture;
  });
  const dispose = vi.fn();
  vi.mocked(mountCompositionFrames).mockResolvedValue({
    width,
    height,
    copies,
    pictureAt,
    dispose,
  });
  // Workers that answer out of step: a later frame's file is ready before an earlier one's.
  let turn = 0;
  const pool = {
    size: 2,
    png: vi.fn(async (picture: ImageBitmap) => {
      await new Promise((resolve) => setTimeout(resolve, turn++ % 2 ? 0 : 3));
      return (picture as StandInPicture).png;
    }),
    planes: vi.fn(),
    dispose: vi.fn(),
  };
  vi.mocked(createFramePicturePool).mockReturnValue(pool);
  return { pictureAt, dispose, pool };
}

function rejectAlphaEncoderConfig() {
  const isConfigSupported = vi
    .fn()
    .mockResolvedValueOnce({ supported: true })
    .mockResolvedValueOnce({ supported: false });
  vi.stubGlobal(
    'VideoEncoder',
    class {
      static isConfigSupported = isConfigSupported;
    },
  );
  vi.stubGlobal('AudioEncoder', class {});
  vi.stubGlobal('VideoFrame', class {});
  vi.stubGlobal('OfflineAudioContext', class {});
  return isConfigSupported;
}

function mockWebmEncoder() {
  const encoded = vi.fn<(frame: VideoFrame, keyFrame: boolean) => void>();
  class TestVideoFrame {
    close = vi.fn();
    timestamp: number;
    duration: number;

    constructor(
      _canvas: unknown,
      { timestamp, duration }: { timestamp: number; duration: number },
    ) {
      this.timestamp = timestamp;
      this.duration = duration;
    }
  }
  class TestVideoEncoder {
    private readonly init: VideoEncoderInit;

    static async isConfigSupported() {
      return { supported: true };
    }

    constructor(init: VideoEncoderInit) {
      this.init = init;
    }

    configure() {}
    async flush() {}
    close() {}

    encode(frame: VideoFrame, { keyFrame }: VideoEncoderEncodeOptions) {
      encoded(frame, keyFrame ?? false);
      this.init.output({
        byteLength: 1,
        timestamp: frame.timestamp,
        duration: frame.duration,
        type: keyFrame ? 'key' : 'delta',
        copyTo: () => {},
      });
    }
  }
  const createImageBitmap = vi.fn(async (_canvas: HTMLCanvasElement) => ({ close: vi.fn() }));
  vi.stubGlobal('VideoEncoder', TestVideoEncoder);
  vi.stubGlobal('VideoFrame', TestVideoFrame);
  vi.stubGlobal('AudioEncoder', class {});
  vi.stubGlobal('OfflineAudioContext', class {});
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  vi.stubGlobal('document', {
    createElement() {
      const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
      return { getContext: () => context };
    },
  });
  return { createImageBitmap, encoded, TestVideoFrame };
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('WebM encoder configuration', () => {
  it('splits the target bitrate and pads odd raster dimensions for the encoders', async () => {
    const { dispose } = mockMountedFrames(541, 959);
    const isConfigSupported = rejectAlphaEncoderConfig();
    const signal = new AbortController().signal;
    const size = { width: 541, height: 959 };

    await expect(
      prepareWebmExportFile(project, createComposition(), {
        bitrate: 9_000_000,
        holdSeconds: 0,
        signal,
        size,
        transparent: true,
      }),
    ).rejects.toThrow('542 × 960 WebM at the selected bitrate');

    expect(mountCompositionFrames).toHaveBeenCalledWith(
      expect.anything(),
      'transparent',
      signal,
      size,
      expect.any(Number),
    );
    expect(isConfigSupported).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        width: 542,
        height: 960,
        bitrate: 6_000_000,
      }),
    );
    expect(isConfigSupported).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        width: 542,
        height: 960,
        bitrate: 3_000_000,
      }),
    );
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps the original native-size automatic bitrate budget', async () => {
    const composition = createComposition({ width: 1920, height: 1080, frameRate: 60 });
    mockMountedFrames(1920, 1080);
    const isConfigSupported = rejectAlphaEncoderConfig();

    await expect(
      prepareWebmExportFile(project, composition, {
        holdSeconds: 0,
        signal: new AbortController().signal,
        transparent: true,
      }),
    ).rejects.toThrow('1920 × 1080 WebM');

    expect(isConfigSupported).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ bitrate: 3_732_480 }),
    );
    expect(isConfigSupported).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bitrate: 1_866_240 }),
    );
  });
});

describe('WebM black frames', () => {
  it.each([
    [false, false, false],
    [true, true, false],
    [false, false, true],
    [true, true, true],
    [false, true, true],
  ])(
    'preserves frame order with transparency %s, a black opening %s and a black closing %s',
    async (transparent, blackFrameAtStart, blackFrameAtEnd) => {
      const composition = createComposition({ width: 61, height: 31, frameRate: 10 });
      const { pictureAt, dispose, pool } = mockMountedFrames(61, 31);
      const { createImageBitmap, encoded, TestVideoFrame } = mockWebmEncoder();
      pool.planes.mockImplementation(async (picture, { timestamp, duration }) => {
        picture.close();
        return {
          colour: new TestVideoFrame(null, { timestamp, duration }),
          alpha: new TestVideoFrame(null, { timestamp, duration }),
        };
      });
      const onProgress = vi.fn();
      const result = await prepareWebmExportFile(project, composition, {
        transparent,
        blackFrameAtStart,
        blackFrameAtEnd,
        holdSeconds: 0.2,
        signal: new AbortController().signal,
        onProgress,
      });

      const timeline = movieTimeline(composition, 0.2);
      const startFrames = Number(blackFrameAtStart);
      const endFrames = Number(blackFrameAtEnd);
      const frames = startFrames + timeline.frames.length + endFrames;
      expect(result.format).toBe('webm');
      expect(pictureAt.mock.calls.map(([frame, hold]) => [frame, hold?.frames])).toEqual(
        timeline.frames.map(({ frame, heldHere }) => [
          frame,
          frame > 12 ? timeline.holdFrames : heldHere,
        ]),
      );
      expect(createImageBitmap).toHaveBeenCalledTimes(startFrames + endFrames);
      for (const [canvas] of createImageBitmap.mock.calls) {
        expect([canvas.width, canvas.height]).toEqual([62, 32]);
        const context = canvas.getContext('2d');
        expect(context?.fillStyle).toBe('#000000');
        expect(context?.fillRect).toHaveBeenCalledWith(0, 0, 62, 32);
      }
      const timestamps = Array.from({ length: frames }, (_, index) => index * 100_000);
      expect(encoded.mock.calls.map(([frame]) => frame.timestamp)).toEqual(
        transparent ? timestamps.flatMap((timestamp) => [timestamp, timestamp]) : timestamps,
      );
      expect(encoded.mock.calls.every(([frame]) => frame.duration === 100_000)).toBe(true);
      const keyTimestamps = encoded.mock.calls
        .filter(([, key]) => key)
        .map(([frame]) => frame.timestamp);
      expect(keyTimestamps).toContain(0);
      expect(keyTimestamps).toContain(startFrames * 100_000);
      if (blackFrameAtEnd) expect(keyTimestamps).toContain((frames - 1) * 100_000);
      if (transparent) {
        const pictures = pool.planes.mock.calls.map(([picture]) => picture);
        if (blackFrameAtStart)
          expect(pictures[0]).toBe(await createImageBitmap.mock.results[0]?.value);
        if (blackFrameAtEnd)
          expect(pictures.at(-1)).toBe(await createImageBitmap.mock.results.at(-1)?.value);
      } else {
        expect(pool.planes).not.toHaveBeenCalled();
      }
      expect(onProgress).toHaveBeenCalledWith({ stage: 'picture', frame: frames, frames });
      expect(dispose).toHaveBeenCalledOnce();
    },
  );
});

describe('PNG sequence in a folder', () => {
  const parent = { name: 'picked' } as unknown as FileSystemDirectoryHandle;
  const folder = { name: 'made' } as unknown as FileSystemDirectoryHandle;
  const composition = createComposition({ width: 60, height: 30, frameRate: 10 });
  const frames = movieTimeline(composition, 0.2).frames.length;

  function mockFolder(name = 'Lower third.png-sequence') {
    vi.mocked(createExportFolder).mockResolvedValue({ name, folder });
    vi.mocked(discardExportFolder).mockImplementation(async (_parent, _name, failure) => {
      throw failure;
    });
  }

  it('writes and reports named frames in movie order while keeping the authored crop and Step hold', async () => {
    const cropped = createComposition({
      width: 600,
      height: 300,
      crop: { x: 20, y: 10, width: 400, height: 200 },
      backgroundColor: '#ff0000',
      frameRate: 10,
    });
    const named = { ...project, name: 'Lower:third' };
    const size = { width: 101, height: 51 };
    const { dispose, pool } = mockMountedFrames(size.width, size.height);
    mockFolder('Lower-third.png-sequence');
    const written = new Map<string, Uint8Array>();
    vi.mocked(writeExportFolderFile).mockImplementation(async (_folder, name, data) => {
      written.set(name, new Uint8Array(await data.arrayBuffer()));
    });
    const onProgress = vi.fn();
    const signal = new AbortController().signal;

    await expect(
      savePngSequenceInFolder(
        named,
        cropped,
        { holdSeconds: 0.2, signal, transparent: true, onProgress, size },
        parent,
      ),
    ).resolves.toBe('Lower-third.png-sequence');

    expect(createExportFolder).toHaveBeenCalledWith(parent, named.name, signal);
    // A movie this short is not worth a second mounted tree.
    expect(mountCompositionFrames).toHaveBeenCalledWith(
      { ...cropped, backgroundColor: 'transparent' },
      'transparent',
      signal,
      size,
      1,
    );
    expect(cropped.backgroundColor).toBe('#ff0000');
    expect([...written.keys()].sort()).toEqual(
      Array.from(
        { length: frames },
        (_, index) => `Lower-third.${String(index + 1).padStart(4, '0')}.png`,
      ),
    );
    expect(written.get('Lower-third.0014.png')).toEqual(new Uint8Array([12, 1]));
    expect(written.get('Lower-third.0015.png')).toEqual(new Uint8Array([12, 2]));
    expect(written.get('Lower-third.0016.png')).toEqual(new Uint8Array([13, 2]));
    expect(vi.mocked(writeExportFolderFile).mock.calls.every(([to]) => to === folder)).toBe(true);
    expect(onProgress.mock.calls).toEqual(
      Array.from({ length: frames }, (_, index) => [
        { stage: 'picture', frame: index + 1, frames },
      ]),
    );
    expect(discardExportFolder).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(pool.dispose).toHaveBeenCalledOnce();
  });

  it('removes the folder after a failed write, once no file is still being written', async () => {
    const { dispose } = mockMountedFrames(60, 30);
    mockFolder();
    const failure = new Error('Disk full');
    let writing = 0;
    vi.mocked(writeExportFolderFile).mockImplementation(async (_folder, name) => {
      writing += 1;
      await new Promise((resolve) => setTimeout(resolve, name === 'Lower third.0002.png' ? 0 : 5));
      writing -= 1;
      if (name === 'Lower third.0002.png') throw failure;
    });
    vi.mocked(discardExportFolder).mockImplementation(async (_parent, _name, cause) => {
      expect(writing).toBe(0);
      throw cause;
    });

    await expect(
      savePngSequenceInFolder(
        project,
        composition,
        { holdSeconds: 0.2, signal: new AbortController().signal, transparent: true },
        parent,
      ),
    ).rejects.toBe(failure);
    expect(discardExportFolder).toHaveBeenCalledWith(parent, 'Lower third.png-sequence', failure);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('stops encoding, releases resources and removes the folder when cancelled', async () => {
    const { pictureAt, dispose, pool } = mockMountedFrames(60, 30);
    mockFolder();
    vi.mocked(writeExportFolderFile).mockResolvedValue();
    const controller = new AbortController();
    const reason = new DOMException('Export cancelled.', 'AbortError');
    const onProgress = vi.fn(() => controller.abort(reason));

    await expect(
      savePngSequenceInFolder(
        project,
        composition,
        {
          holdSeconds: 0.2,
          signal: controller.signal,
          transparent: true,
          onProgress,
        },
        parent,
      ),
    ).rejects.toBe(reason);
    // Only the frames already on their way when the first one finished were drawn.
    expect(pictureAt.mock.calls.length).toBeLessThanOrEqual(pool.size + 3);
    expect(onProgress).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(pool.dispose).toHaveBeenCalledOnce();
    expect(discardExportFolder).toHaveBeenCalledWith(parent, 'Lower third.png-sequence', reason);
  });

  it('mounts a tree for every thirty frames, up to four and one less than the cores', async () => {
    const composition = createComposition({ frameRate: 50 });
    const options = { holdSeconds: 3, signal: new AbortController().signal, transparent: true };
    expect(movieTimeline(composition, 3).frames.length).toBeGreaterThan(90);
    mockFolder();
    vi.mocked(writeExportFolderFile).mockResolvedValue();
    for (const [cores, copies] of [
      [16, 4],
      [3, 2],
      [1, 1],
    ] as const) {
      vi.stubGlobal('navigator', { hardwareConcurrency: cores });
      mockMountedFrames(60, 30);
      await savePngSequenceInFolder(project, composition, options, parent);
      expect(vi.mocked(mountCompositionFrames).mock.lastCall?.[4]).toBe(copies);
    }
  });

  it('removes the folder of a movie that cannot be mounted', async () => {
    mockFolder();
    await expect(
      savePngSequenceInFolder(
        project,
        composition,
        {
          holdSeconds: 0,
          signal: new AbortController().signal,
          size: { width: 0, height: 1.5 },
          transparent: true,
        },
        parent,
      ),
    ).rejects.toThrow('Enter positive whole pixel dimensions');
    expect(discardExportFolder).toHaveBeenCalledOnce();
    expect(mountCompositionFrames).not.toHaveBeenCalled();
  });
});
