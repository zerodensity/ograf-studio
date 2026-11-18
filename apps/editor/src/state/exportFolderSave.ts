import { chooseCertifiedArtifactWriter, verifySavedExportFile } from './certifiedArtifactSave';
import type { ExportFile } from './offlinePreviewPackage';

const INVALID_NAME_CHARACTERS = /[<>:"/\\|?*]/g;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const EXPORT_EXTENSIONS = ['.ograf-set.zip', '.ograf.zip', '.html', '.webm'] as const;
const FORMAT_EXTENSION = { zip: '.ograf.zip', html: '.html', webm: '.webm' } as const;

function exportNameParts(file: Pick<ExportFile, 'format' | 'fileName'>): {
  base: string;
  extension: string;
} {
  const extension =
    EXPORT_EXTENSIONS.find((value) => file.fileName.toLowerCase().endsWith(value)) ??
    FORMAT_EXTENSION[file.format];
  const stem = file.fileName.toLowerCase().endsWith(extension)
    ? file.fileName.slice(0, -extension.length)
    : file.fileName;
  const visible = [...stem].map((char) => (char.charCodeAt(0) < 32 ? '-' : char)).join('');
  const base =
    visible
      .replace(INVALID_NAME_CHARACTERS, '-')
      .slice(0, 150)
      .replace(/^[. ]+|[. ]+$/g, '') || 'Untitled graphic';
  return { base: RESERVED_WINDOWS_NAME.test(base) ? `_${base}` : base, extension };
}

export function getUnnumberedExportFileName(file: Pick<ExportFile, 'format' | 'fileName'>): string {
  const { base, extension } = exportNameParts(file);
  return base + extension;
}

async function nameExists(folder: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await folder.getFileHandle(name);
    return true;
  } catch (error) {
    const kind = (error as { name?: string })?.name;
    if (kind === 'NotFoundError') return false;
    if (kind === 'TypeMismatchError') return true; // A directory already has this name.
    throw error;
  }
}

function requirePreparedFiles(files: readonly ExportFile[]): void {
  if (!files.length || files.some(({ blob }) => !blob.size))
    throw new Error('The export has no complete files to save.');
}

async function availableNames(
  folder: FileSystemDirectoryHandle,
  files: readonly ExportFile[],
  signal?: AbortSignal,
): Promise<string[]> {
  const names = files.map(exportNameParts);
  for (let index = 1; index <= 1000; index += 1) {
    signal?.throwIfAborted();
    const suffix = index === 1 ? '' : ` (${index})`;
    const candidates = names.map(({ base, extension }) => `${base}${suffix}${extension}`);
    if (new Set(candidates.map((name) => name.toLowerCase())).size !== candidates.length)
      throw new Error('The export contains duplicate file names.');
    const occupied = await Promise.all(candidates.map((name) => nameExists(folder, name)));
    if (occupied.every((found) => !found)) return candidates;
  }
  throw new Error('Too many exports have this name. Choose another folder.');
}

/** Write exact certified blobs to one selected directory, without replacing earlier exports. */
export async function saveExportFilesInFolder(
  folder: FileSystemDirectoryHandle,
  files: readonly ExportFile[],
  signal?: AbortSignal,
): Promise<string[]> {
  requirePreparedFiles(files);
  signal?.throwIfAborted();
  const names = await availableNames(folder, files, signal);
  const pending: {
    name: string;
    handle: FileSystemFileHandle;
    writer?: FileSystemWritableFileStream;
    committed: boolean;
    blob: Blob;
  }[] = [];
  try {
    // File handles and their empty placeholders are created only after all artifacts are certified.
    for (const [index, file] of files.entries()) {
      signal?.throwIfAborted();
      const name = names[index]!;
      if (await nameExists(folder, name))
        throw new Error(`“${name}” appeared in the folder. Try saving again.`);
      signal?.throwIfAborted();
      const handle = await folder.getFileHandle(name, { create: true });
      if ((await handle.getFile()).size)
        throw new Error(`“${name}” appeared in the folder. Try saving again.`);
      const entry = { name, handle, committed: false, blob: file.blob };
      pending.push(entry);
      signal?.throwIfAborted();
    }
    for (const entry of pending) {
      signal?.throwIfAborted();
      entry.writer = await entry.handle.createWritable();
      signal?.throwIfAborted();
      await entry.writer.write(entry.blob);
    }

    // Stage both writes before committing either. File System Access commits each file separately.
    signal?.throwIfAborted();
    for (const entry of pending) {
      await entry.writer!.close();
      entry.committed = true;
      await verifySavedExportFile(entry.handle, entry.blob);
    }
    return names;
  } catch (error) {
    const incomplete = pending.filter((entry) => !entry.committed);
    await Promise.allSettled(incomplete.map((entry) => entry.writer?.abort()));
    const cleanup = await Promise.allSettled(
      incomplete.map(async ({ name, handle }) => {
        if (!(await handle.getFile()).size) await folder.removeEntry(name);
      }),
    );
    const written = pending.filter((entry) => entry.committed).map(({ name }) => name);
    const unremoved = incomplete.filter((_, index) => cleanup[index]?.status === 'rejected');
    if (written.length || unremoved.length) {
      const details = [
        written.length ? `Files already written: ${written.join(', ')}.` : '',
        unremoved.length
          ? `Check for incomplete files: ${unremoved.map(({ name }) => name).join(', ')}.`
          : '',
      ].filter(Boolean);
      throw new Error(
        [error instanceof Error ? error.message : String(error), ...details].join(' '),
        { cause: error },
      );
    }
    throw error;
  }
}

/** The browser controls where downloads go; this only requests delivery. */
export async function downloadExportFiles(
  owner: Window,
  files: readonly ExportFile[],
): Promise<void> {
  requirePreparedFiles(files);
  for (const file of files) {
    const writer = await chooseCertifiedArtifactWriter(file.fileName, {
      ownerWindow: owner,
      downloadOnly: true,
      format: file.format,
    });
    await writer(file.blob);
  }
}
