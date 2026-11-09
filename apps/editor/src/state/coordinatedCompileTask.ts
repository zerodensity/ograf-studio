import type { ExportArtifacts, ExportProfile } from '@ograf-editor/codegen';
import type { ProjectSetDocument } from './projectSet';
import { buildCoordinatedProjectSetArtifacts } from './coordinatedCompile';

export async function buildCoordinatedProjectSetArtifactsTask(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  signal?: AbortSignal,
): Promise<ExportArtifacts> {
  signal?.throwIfAborted();
  const compileOnMainThread = () => {
    signal?.throwIfAborted();
    const artifacts = buildCoordinatedProjectSetArtifacts(set, profile);
    signal?.throwIfAborted();
    return artifacts;
  };
  if (typeof Worker === 'undefined') return compileOnMainThread();
  let worker: Worker;
  try {
    worker = new Worker(new URL('./coordinatedCompile.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return compileOnMainThread();
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (result: { error: unknown } | { artifacts: ExportArtifacts }) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if ('error' in result) reject(result.error);
      else resolve(result.artifacts);
    };
    const cancel = () => finish({ error: signal!.reason });
    const timeout = setTimeout(
      () =>
        finish({
          error: new Error(
            'Coordinated preview compilation exceeded two minutes. The source is preserved.',
          ),
        }),
      120_000,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = (event) =>
      finish({ error: new Error(event.message || 'Coordinated preview compiler failed.') });
    worker.onmessageerror = () =>
      finish({ error: new Error('Could not read coordinated preview compilation.') });
    worker.onmessage = (event) => {
      if (done) return;
      if (event.data.type === 'error') finish({ error: new Error(event.data.message) });
      else if (event.data.type === 'complete') finish({ artifacts: event.data.artifacts });
    };
    if (signal?.aborted) {
      cancel();
      return;
    }
    try {
      worker.postMessage({ set, profile });
    } catch (cause) {
      finish({ error: cause instanceof Error ? cause : new Error(String(cause)) });
    }
  });
}
