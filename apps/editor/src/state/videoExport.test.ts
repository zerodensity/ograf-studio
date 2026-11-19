import { createComposition, createProject } from '@ograf-editor/scene-model';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCompositionFrames, type CaptureHold } from './agentCapture';
import { createExportFolder, discardExportFolder, writeExportFolderFile } from './exportFolderSave';
import { createFramePicturePool } from './framePicturePool';
import {
  preparePngSequenceExportFile,
  prepareWebmExportFile,
  savePngSequenceInFolder,
} from './videoExport';
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

/** A picture that only remembers which frame it shows, so the ZIP entries prove ordering. */
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

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('PNG sequence export', () => {
  it('preserves the authored crop and Step holds in a sized sequence', async () => {
    const composition = createComposition({
      width: 600,
      height: 300,
      crop: { x: 20, y: 10, width: 400, height: 200 },
      backgroundColor: '#ff0000',
      frameRate: 10,
    });
    const { dispose, pool } = mockMountedFrames(101, 51);
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    const size = { width: 101, height: 51 };

    const file = await preparePngSequenceExportFile(project, composition, {
      holdSeconds: 0.2,
      onProgress,
      signal,
      size,
      transparent: true,
    });

    expect(file).toMatchObject({
      format: 'png-sequence',
      fileName: 'Lower third.png-sequence.zip',
    });
    // A movie this short is not worth a second mounted tree.
    expect(mountCompositionFrames).toHaveBeenCalledWith(
      { ...composition, backgroundColor: 'transparent' },
      'transparent',
      signal,
      size,
      1,
    );
    expect(composition.backgroundColor).toBe('#ff0000');

    const archive = await JSZip.loadAsync(await file.blob.arrayBuffer(), { checkCRC32: true });
    expect(Object.keys(archive.files)).toEqual(
      Array.from({ length: 27 }, (_, index) => `frame-${String(index + 1).padStart(4, '0')}.png`),
    );
    expect(await archive.file('frame-0014.png')?.async('uint8array')).toEqual(
      new Uint8Array([12, 1]),
    );
    expect(await archive.file('frame-0015.png')?.async('uint8array')).toEqual(
      new Uint8Array([12, 2]),
    );
    expect(await archive.file('frame-0016.png')?.async('uint8array')).toEqual(
      new Uint8Array([13, 2]),
    );
    // Progress counts finished frames in the movie's order, whatever order the workers answer in.
    expect(onProgress.mock.calls.slice(0, 27)).toEqual(
      Array.from({ length: 27 }, (_, index) => [
        { stage: 'picture', frame: index + 1, frames: 27 },
      ]),
    );
    expect(onProgress).toHaveBeenLastCalledWith({ stage: 'file' });
    expect(dispose).toHaveBeenCalledOnce();
    expect(pool.dispose).toHaveBeenCalledOnce();
  });

  it('stops and releases the scene and the workers when frame export is cancelled', async () => {
    const { pictureAt, dispose, pool } = mockMountedFrames(60, 30);
    const controller = new AbortController();
    const reason = new DOMException('Export cancelled.', 'AbortError');
    const composition = createComposition();
    const onProgress = vi.fn(() => controller.abort(reason));

    await expect(
      preparePngSequenceExportFile(project, composition, {
        holdSeconds: 0,
        signal: controller.signal,
        transparent: false,
        onProgress,
      }),
    ).rejects.toBe(reason);
    // Only the frames already on their way when the first one finished were drawn.
    expect(pictureAt.mock.calls.length).toBeLessThanOrEqual(pool.size + 3);
    expect(onProgress).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(pool.dispose).toHaveBeenCalledOnce();
  });

  it('mounts a tree for every thirty frames, up to four and one less than the cores', async () => {
    const composition = createComposition({ frameRate: 50 });
    const options = { holdSeconds: 3, signal: new AbortController().signal, transparent: true };
    const frames = movieTimeline(composition, 3).frames.length;
    expect(frames).toBeGreaterThan(90);
    for (const [cores, copies] of [
      [16, 4],
      [3, 2],
      [1, 1],
    ] as const) {
      vi.stubGlobal('navigator', { hardwareConcurrency: cores });
      mockMountedFrames(60, 30);
      await preparePngSequenceExportFile(project, composition, options);
      expect(vi.mocked(mountCompositionFrames).mock.lastCall?.[4]).toBe(copies);
    }
  });

  it('rejects invalid raster dimensions before mounting', async () => {
    await expect(
      preparePngSequenceExportFile(project, createComposition(), {
        holdSeconds: 0,
        signal: new AbortController().signal,
        size: { width: 0, height: 1.5 },
        transparent: true,
      }),
    ).rejects.toThrow('Enter positive whole pixel dimensions');
    expect(mountCompositionFrames).not.toHaveBeenCalled();
  });
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

describe('PNG sequence in a folder', () => {
  const parent = { name: 'picked' } as unknown as FileSystemDirectoryHandle;
  const folder = { name: 'made' } as unknown as FileSystemDirectoryHandle;
  const composition = createComposition({ width: 60, height: 30, frameRate: 10 });
  const frames = movieTimeline(composition, 0.2).frames.length;

  function mockFolder() {
    vi.mocked(createExportFolder).mockResolvedValue({ name: 'Lower third.png-sequence', folder });
    vi.mocked(discardExportFolder).mockImplementation(async (_parent, _name, failure) => {
      throw failure;
    });
  }

  it('writes every frame as its own file and reports them in the order of the movie', async () => {
    const { dispose, pool } = mockMountedFrames(60, 30);
    mockFolder();
    const written = new Map<string, Uint8Array>();
    vi.mocked(writeExportFolderFile).mockImplementation(async (_folder, name, data) => {
      written.set(name, new Uint8Array(await data.arrayBuffer()));
    });
    const onProgress = vi.fn();
    const signal = new AbortController().signal;

    await expect(
      savePngSequenceInFolder(
        project,
        composition,
        { holdSeconds: 0.2, signal, transparent: true, onProgress },
        parent,
      ),
    ).resolves.toBe('Lower third.png-sequence');

    expect(createExportFolder).toHaveBeenCalledWith(
      parent,
      { format: 'png-sequence', fileName: 'Lower third.png-sequence.zip' },
      signal,
    );
    expect([...written.keys()].sort()).toEqual(
      Array.from(
        { length: frames },
        (_, index) => `frame-${String(index + 1).padStart(4, '0')}.png`,
      ),
    );
    expect(written.get('frame-0015.png')).toEqual(new Uint8Array([12, 2]));
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
      await new Promise((resolve) => setTimeout(resolve, name === 'frame-0002.png' ? 0 : 5));
      writing -= 1;
      if (name === 'frame-0002.png') throw failure;
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

  it('removes the folder when the export is cancelled', async () => {
    mockMountedFrames(60, 30);
    mockFolder();
    vi.mocked(writeExportFolderFile).mockResolvedValue();
    const controller = new AbortController();
    const reason = new DOMException('Export cancelled.', 'AbortError');

    await expect(
      savePngSequenceInFolder(
        project,
        composition,
        {
          holdSeconds: 0.2,
          signal: controller.signal,
          transparent: true,
          onProgress: () => controller.abort(reason),
        },
        parent,
      ),
    ).rejects.toBe(reason);
    expect(discardExportFolder).toHaveBeenCalledWith(parent, 'Lower third.png-sequence', reason);
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
