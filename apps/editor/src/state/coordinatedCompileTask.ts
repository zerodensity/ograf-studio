import type { ExportArtifacts, ExportProfile } from '@ograf-editor/codegen';
import type { ProjectSetDocument } from './projectSet';
import { buildCoordinatedProjectSetArtifacts } from './coordinatedCompile';

export async function buildCoordinatedProjectSetArtifactsTask(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  signal?: AbortSignal,
): Promise<ExportArtifacts> {
  if (signal?.aborted) throw new Error('Playout loading was cancelled.');
  if (typeof Worker === 'undefined') return buildCoordinatedProjectSetArtifacts(set, profile);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./coordinatedCompile.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return buildCoordinatedProjectSetArtifacts(set, profile);
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error, artifacts?: ExportArtifacts) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(artifacts!);
    };
    const cancel = () => finish(new Error('Playout loading was cancelled.'));
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            'Coordinated preview compilation exceeded two minutes. The source is preserved.',
          ),
        ),
      120_000,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = (event) =>
      finish(new Error(event.message || 'Coordinated preview compiler failed.'));
    worker.onmessageerror = () =>
      finish(new Error('Could not read coordinated preview compilation.'));
    worker.onmessage = (event) => {
      if (done) return;
      if (event.data.type === 'error') finish(new Error(event.data.message));
      else if (event.data.type === 'complete') finish(undefined, event.data.artifacts);
    };
    if (signal?.aborted) {
      cancel();
      return;
    }
    try {
      worker.postMessage({ set, profile });
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}
