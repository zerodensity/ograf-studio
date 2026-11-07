import {
  createProjectSetArchive,
  type ProjectSetDocument,
  type ProjectSetArchiveProgress,
} from './projectSet';

export async function createProjectSetArchiveTask(
  set: ProjectSetDocument,
  options: {
    legacyFormat?: boolean;
    archiveMode?: 'compact' | 'compatible';
    onProgress?: (progress: ProjectSetArchiveProgress) => void;
  } = {},
): Promise<Blob> {
  if (typeof Worker === 'undefined') return createProjectSetArchive(set, options);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./projectSetArchive.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return createProjectSetArchive(set, options);
  }
  return new Promise<Blob>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error, blob?: Blob) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(blob!);
    };
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            'Template-set save exceeded two minutes. Retry saving; the open document is preserved.',
          ),
        ),
      120_000,
    );
    worker.onerror = (event) =>
      finish(new Error(event.message || 'Template-set archive worker failed.'));
    worker.onmessageerror = () =>
      finish(new Error('Could not read the prepared template-set archive.'));
    worker.onmessage = (event: MessageEvent) => {
      if (done) return;
      const result = event.data;
      if (result.type === 'progress') options.onProgress?.(result.progress);
      else if (result.type === 'complete') finish(undefined, result.blob);
      else if (result.type === 'error') finish(new Error(result.message));
    };
    try {
      worker.postMessage({
        set,
        legacyFormat: options.legacyFormat,
        ...(options.archiveMode ? { archiveMode: options.archiveMode } : {}),
      });
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}
