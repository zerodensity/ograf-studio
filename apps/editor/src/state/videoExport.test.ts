import { createComposition, createProject } from '@ograf-editor/scene-model';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCompositionFrames, type CaptureHold } from './agentCapture';
import { preparePngSequenceExportFile, prepareWebmExportFile } from './videoExport';

vi.mock('./agentCapture', () => ({ mountCompositionFrames: vi.fn() }));

const project = createProject({ name: 'Lower third' });

function mockMountedFrames(width: number, height: number) {
  const canvasAt = vi.fn(async (frame: number, hold?: CaptureHold) => {
    // A tiny stand-in for the already encoded frame lets the ZIP entries prove ordering.
    const png = new Blob([new Uint8Array([frame, hold?.frames ?? 0])], { type: 'image/png' });
    return {
      width,
      height,
      toBlob: (callback: BlobCallback) => callback(png),
    } as HTMLCanvasElement;
  });
  const dispose = vi.fn();
  vi.mocked(mountCompositionFrames).mockResolvedValue({ width, height, canvasAt, dispose });
  return { canvasAt, dispose };
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
    const { dispose } = mockMountedFrames(101, 51);
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
    expect(mountCompositionFrames).toHaveBeenCalledWith(
      { ...composition, backgroundColor: 'transparent' },
      'transparent',
      signal,
      size,
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
    expect(onProgress).toHaveBeenLastCalledWith({ stage: 'file' });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('disposes the mounted scene when frame export is cancelled', async () => {
    const { canvasAt, dispose } = mockMountedFrames(60, 30);
    const controller = new AbortController();
    const reason = new DOMException('Export cancelled.', 'AbortError');

    await expect(
      preparePngSequenceExportFile(project, createComposition(), {
        holdSeconds: 0,
        signal: controller.signal,
        transparent: false,
        onProgress: () => controller.abort(reason),
      }),
    ).rejects.toBe(reason);
    expect(canvasAt).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
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
