import { describe, expect, it } from 'vitest';
import { verifySavedExportFile } from './certifiedArtifactSave';
import {
  createExportFolder,
  discardExportFolder,
  saveExportFilesInFolder,
  writeExportFolderFile,
} from './exportFolderSave';
import type { ExportFile } from './offlinePreviewPackage';

const files: ExportFile[] = [
  { fileName: 'News.ograf.zip', format: 'zip', blob: new Blob(['certified ZIP']) },
  { fileName: 'News.html', format: 'html', blob: new Blob(['certified HTML']) },
];

interface FolderFixture {
  folder: FileSystemDirectoryHandle;
  stored: Map<string, Blob>;
  folders: Map<string, FolderFixture>;
  operations: string[];
}

function folderFixture(
  options: { onWrite?: () => void; failClose?: string; failRemove?: boolean } = {},
): FolderFixture {
  const stored = new Map<string, Blob>();
  const folders = new Map<string, FolderFixture>();
  const operations: string[] = [];
  const folder = {
    async getDirectoryHandle(name: string, { create = false } = {}) {
      if (stored.has(name)) throw new DOMException('A file has this name', 'TypeMismatchError');
      if (!folders.has(name)) {
        if (!create) throw new DOMException('Folder missing', 'NotFoundError');
        operations.push(`create folder:${name}`);
        folders.set(name, folderFixture(options));
      }
      return folders.get(name)!.folder;
    },
    async getFileHandle(name: string, { create = false } = {}) {
      if (folders.has(name)) throw new DOMException('A folder has this name', 'TypeMismatchError');
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
      if (options.failRemove) throw new DOMException('In use', 'NoModificationAllowedError');
      operations.push(`remove:${name}`);
      stored.delete(name);
      folders.delete(name);
    },
  } as unknown as FileSystemDirectoryHandle;
  return { folder, stored, folders, operations };
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

  it('saves a WebM movie under its own extension, beside an earlier one', async () => {
    const { folder, stored } = folderFixture();
    stored.set('News.webm', new Blob(['earlier movie']));
    const names = await saveExportFilesInFolder(folder, [
      { fileName: 'News.webm', format: 'webm', blob: new Blob(['movie']) },
    ]);
    expect(names).toEqual(['News (2).webm']);
    expect(await stored.get('News (2).webm')?.text()).toBe('movie');
    expect(await stored.get('News.webm')?.text()).toBe('earlier movie');
  });

  it('uses the PNG sequence suffix and preserves earlier archives', async () => {
    const { folder, stored } = folderFixture();
    stored.set('News.png-sequence.zip', new Blob(['earlier sequence']));
    await expect(
      saveExportFilesInFolder(folder, [
        { fileName: 'News.png-sequence.zip', format: 'png-sequence', blob: new Blob(['frames']) },
      ]),
    ).resolves.toEqual(['News (2).png-sequence.zip']);
    expect(await stored.get('News (2).png-sequence.zip')?.text()).toBe('frames');
    expect(await stored.get('News.png-sequence.zip')?.text()).toBe('earlier sequence');
  });
});

it('detects saved byte differences beyond the first verification block', async () => {
  const leadingBlock = new Uint8Array(8 * 1024 * 1024);
  const expected = new Blob([leadingBlock, 'A']);
  const handle = {
    async getFile() {
      return new File([leadingBlock, 'B'], 'News.png-sequence.zip');
    },
  } as FileSystemFileHandle;

  await expect(verifySavedExportFile(handle, expected)).rejects.toThrow('Saved file checksum');
});

describe('an export folder', () => {
  const sequence = { fileName: 'News.png-sequence.zip', format: 'png-sequence' } as const;

  it('is named after the export without .zip, beside earlier files and folders', async () => {
    const { folder, stored, folders } = folderFixture();
    expect((await createExportFolder(folder, sequence)).name).toBe('News.png-sequence');
    stored.set('News (2).png-sequence', new Blob(['a file with the next name']));
    const third = await createExportFolder(folder, sequence);
    expect(third.name).toBe('News (3).png-sequence');
    expect(third.folder).toBe(folders.get('News (3).png-sequence')!.folder);
    expect([...folders.keys()]).toEqual(['News.png-sequence', 'News (3).png-sequence']);
  });

  it('is not made once the export is cancelled', async () => {
    const { folder, folders } = folderFixture();
    const cancel = new AbortController();
    cancel.abort();
    await expect(createExportFolder(folder, sequence, cancel.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(folders.size).toBe(0);
  });

  it('takes a file in full', async () => {
    const { folder, stored, operations } = folderFixture();
    await writeExportFolderFile(folder, 'frame-0001.png', new Blob(['picture']));
    expect(await stored.get('frame-0001.png')?.text()).toBe('picture');
    expect(operations).toEqual([
      'create:frame-0001.png',
      'write:frame-0001.png',
      'close:frame-0001.png',
    ]);
  });

  it('drops a file it could not finish and says why', async () => {
    const { folder, operations } = folderFixture({ failClose: 'frame-0001.png' });
    await expect(
      writeExportFolderFile(folder, 'frame-0001.png', new Blob(['picture'])),
    ).rejects.toThrow('Disk full');
    expect(operations.at(-1)).toBe('abort:frame-0001.png');
  });

  it('does not commit a file once the export is cancelled', async () => {
    const cancel = new AbortController();
    const { folder, operations } = folderFixture({ onWrite: () => cancel.abort() });
    await expect(
      writeExportFolderFile(folder, 'frame-0001.png', new Blob(['picture']), cancel.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(operations).not.toContain('close:frame-0001.png');
    expect(operations.at(-1)).toBe('abort:frame-0001.png');
  });

  it('is removed with the failure that ended its export', async () => {
    const { folder, folders } = folderFixture();
    const { name } = await createExportFolder(folder, sequence);
    const failure = new Error('The shader could not draw.');
    await expect(discardExportFolder(folder, name, failure)).rejects.toBe(failure);
    expect(folders.size).toBe(0);
  });

  it('is named in the failure when it could not be removed', async () => {
    const { folder } = folderFixture({ failRemove: true });
    const { name } = await createExportFolder(folder, sequence);
    await expect(
      discardExportFolder(folder, name, new Error('The shader could not draw.')),
    ).rejects.toThrow(
      'The shader could not draw. Check for an incomplete folder: News.png-sequence.',
    );
  });
});
