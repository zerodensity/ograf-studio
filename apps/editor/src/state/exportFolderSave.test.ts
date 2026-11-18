import { describe, expect, it } from 'vitest';
import { saveExportFilesInFolder } from './exportFolderSave';
import type { ExportFile } from './offlinePreviewPackage';

const files: ExportFile[] = [
  { fileName: 'News.ograf.zip', format: 'zip', blob: new Blob(['certified ZIP']) },
  { fileName: 'News.html', format: 'html', blob: new Blob(['certified HTML']) },
];

function folderFixture(options: { onWrite?: () => void; failClose?: string } = {}) {
  const stored = new Map<string, Blob>();
  const operations: string[] = [];
  const folder = {
    async getFileHandle(name: string, { create = false } = {}) {
      if (!stored.has(name)) {
        if (!create) throw new DOMException('File missing', 'NotFoundError');
        operations.push(`create:${name}`);
        stored.set(name, new Blob());
      }
      return {
        async getFile() {
          if (!stored.has(name)) throw new DOMException('File missing', 'NotFoundError');
          return stored.get(name)!;
        },
        async createWritable() {
          let staged: Blob;
          return {
            async write(blob: Blob) {
              operations.push(`write:${name}`);
              staged = blob;
              options.onWrite?.();
            },
            async close() {
              operations.push(`close:${name}`);
              if (options.failClose === name) throw new Error('Disk full');
              stored.set(name, staged);
            },
            async abort() {
              operations.push(`abort:${name}`);
            },
          };
        },
      };
    },
    async removeEntry(name: string) {
      operations.push(`remove:${name}`);
      stored.delete(name);
    },
  } as unknown as FileSystemDirectoryHandle;
  return { folder, stored, operations };
}

describe('saveExportFilesInFolder', () => {
  it('saves both certified files with a shared suffix, preserving the existing output', async () => {
    const { folder, stored, operations } = folderFixture();
    stored.set('News.html', new Blob(['earlier HTML']));
    const names = await saveExportFilesInFolder(folder, files);
    expect(names).toEqual(['News (2).ograf.zip', 'News (2).html']);
    expect(await stored.get('News.html')?.text()).toBe('earlier HTML');
    expect(await stored.get(names[0]!)?.text()).toBe('certified ZIP');
    expect(await stored.get(names[1]!)?.text()).toBe('certified HTML');
    expect(operations.indexOf('write:News (2).html')).toBeLessThan(
      operations.indexOf('close:News (2).ograf.zip'),
    );
  });

  it('refuses a missing artifact before creating either file', async () => {
    const { folder, stored } = folderFixture();
    await expect(
      saveExportFilesInFolder(folder, [files[0]!, { ...files[1]!, blob: new Blob() }]),
    ).rejects.toThrow('no complete files');
    expect(stored.size).toBe(0);
  });

  it('aborts staged writes and removes empty placeholders on cancellation before commit', async () => {
    const cancel = new AbortController();
    const { folder, stored, operations } = folderFixture({ onWrite: () => cancel.abort() });
    await expect(saveExportFilesInFolder(folder, files, cancel.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(stored.size).toBe(0);
    expect(operations.some((event) => event.startsWith('close:'))).toBe(false);
  });

  it('reports a partial commit and cleans up the failed output', async () => {
    const { folder, stored } = folderFixture({ failClose: 'News.html' });
    await expect(saveExportFilesInFolder(folder, files)).rejects.toThrow(
      'Disk full Files already written: News.ograf.zip.',
    );
    expect(await stored.get('News.ograf.zip')?.text()).toBe('certified ZIP');
    expect(stored.has('News.html')).toBe(false);
  });
});
