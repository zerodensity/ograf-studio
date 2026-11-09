import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { generateExportZip } from './exportZip';

describe('cancellable export ZIP compression', () => {
  it('produces a readable ZIP with the original entries when the signal stays active', async () => {
    const zip = new JSZip();
    const metadata = '{"name":"News"}';
    const packageBytes = new Uint8Array([1, 2, 3, 0, 255]);
    zip.file('set-export.json', metadata);
    zip.file('templates/news.ograf.zip', packageBytes);

    const blob = await generateExportZip(zip, new AbortController().signal);
    const restored = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(await restored.file('set-export.json')?.async('string')).toBe(metadata);
    expect(await restored.file('templates/news.ograf.zip')?.async('uint8array')).toEqual(
      packageBytes,
    );
  });

  it('pauses a running compression stream when cancelled during a large entry', async () => {
    const zip = new JSZip();
    const data = new Uint8Array(1024 * 1024);
    let state = 7;
    for (let index = 0; index < data.length; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[index] = state >>> 24;
    }
    zip.file('payload.bin', data);
    const stream = zip.generateInternalStream({
      type: 'uint8array',
      compression: 'DEFLATE',
      streamFiles: true,
    });
    vi.spyOn(zip, 'generateInternalStream').mockReturnValue(stream);
    const pause = vi.spyOn(stream, 'pause');
    const completed = vi.fn();
    const controller = new AbortController();
    const reason = new DOMException('Export cancelled.', 'AbortError');
    let cancelledAt = 0;
    stream.on('end', completed).on('data', (_chunk, metadata) => {
      if (!controller.signal.aborted && metadata.percent > 0 && metadata.percent < 100) {
        cancelledAt = metadata.percent;
        controller.abort(reason);
      }
    });

    await expect(generateExportZip(zip, controller.signal)).rejects.toBe(reason);
    expect(cancelledAt).toBeGreaterThan(0);
    expect(cancelledAt).toBeLessThan(100);
    expect(pause).toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
  });
});
