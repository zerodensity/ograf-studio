import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportArtifacts, ExportProfile } from '@ograf-editor/codegen';
import { createProject } from '@ograf-editor/scene-model';
import { createProjectSet } from './projectSet';

const compile = vi.hoisted(() => vi.fn());
vi.mock('./coordinatedCompile', () => ({ buildCoordinatedProjectSetArtifacts: compile }));
import { buildCoordinatedProjectSetArtifactsTask } from './coordinatedCompileTask';

class CompileWorker {
  static instances: CompileWorker[] = [];
  static postError: Error | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  url: URL;
  options: WorkerOptions;
  postMessage = vi.fn(() => {
    if (CompileWorker.postError) throw CompileWorker.postError;
  });
  terminate = vi.fn();
  constructor(url: URL, options: WorkerOptions) {
    this.url = url;
    this.options = options;
    CompileWorker.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const artifacts = {
  valid: true,
  errors: [],
  mainJs: 'verified runtime',
} as unknown as ExportArtifacts;
const dualProfile: ExportProfile = {
  id: 'dual',
  name: 'Dual',
  mode: 'dual',
  graphicIdSuffix: '',
  fileNameSuffix: '-dual',
};
const realtimeProfile: ExportProfile = {
  id: 'realtime',
  name: 'Real-time',
  mode: 'realtime',
  graphicIdSuffix: '-rt',
  fileNameSuffix: '-rt',
};
const fixture = () => createProjectSet('Responsive compilation', createProject());
beforeEach(() => {
  vi.clearAllMocks();
  compile.mockReturnValue(artifacts);
  CompileWorker.instances = [];
  CompileWorker.postError = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('responsive coordinated compilation task', () => {
  it('uses a module worker and returns its exact compiled snapshot without mutating source', async () => {
    vi.stubGlobal('Worker', CompileWorker);
    const source = fixture(),
      before = structuredClone(source);
    const task = buildCoordinatedProjectSetArtifactsTask(source, dualProfile);
    const worker = CompileWorker.instances[0]!;
    expect(worker.url.pathname).toContain('coordinatedCompile.worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledWith({ set: source, profile: dualProfile });
    worker.emit({ type: 'complete', artifacts });
    await expect(task).resolves.toBe(artifacts);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(compile).not.toHaveBeenCalled();
    expect(source).toEqual(before);
  });

  it('rejects an already-aborted load before creating a worker or running a fallback', async () => {
    vi.stubGlobal('Worker', CompileWorker);
    const abort = new AbortController();
    abort.abort();
    await expect(
      buildCoordinatedProjectSetArtifactsTask(fixture(), undefined, abort.signal),
    ).rejects.toBe(abort.signal.reason);
    expect(CompileWorker.instances).toHaveLength(0);
    expect(compile).not.toHaveBeenCalled();
  });

  it('terminates cancelled workers once and ignores queued success/error callbacks', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', CompileWorker);
    const abort = new AbortController();
    const source = fixture(),
      before = structuredClone(source);
    const task = buildCoordinatedProjectSetArtifactsTask(source, undefined, abort.signal);
    const worker = CompileWorker.instances[0]!;
    const lateSuccess = worker.onmessage!,
      lateError = worker.onerror!;
    const reason = new DOMException('Export cancelled by the operator.', 'AbortError');
    const rejected = expect(task).rejects.toBe(reason);
    abort.abort(reason);
    await rejected;
    lateSuccess({ data: { type: 'complete', artifacts } } as MessageEvent);
    lateError({ message: 'late failure' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(source).toEqual(before);
  });

  it('removes its abort listener and ignores late errors after successful completion', async () => {
    vi.stubGlobal('Worker', CompileWorker);
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const task = buildCoordinatedProjectSetArtifactsTask(fixture(), undefined, abort.signal);
    const worker = CompileWorker.instances[0]!,
      lateError = worker.onerror!;
    worker.emit({ type: 'complete', artifacts });
    await expect(task).resolves.toBe(artifacts);
    lateError({ message: 'late failure' });
    abort.abort();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(['declared', 'runtime', 'decode'] as const)(
    'rejects %s failures and preserves the document',
    async (mode) => {
      vi.stubGlobal('Worker', CompileWorker);
      const source = fixture(),
        before = structuredClone(source);
      const task = buildCoordinatedProjectSetArtifactsTask(source);
      const worker = CompileWorker.instances[0]!;
      const rejected = expect(task).rejects.toThrow(
        mode === 'decode' ? 'Could not read' : 'Invalid source',
      );
      if (mode === 'declared') worker.emit({ type: 'error', message: 'Invalid source' });
      if (mode === 'runtime') worker.onerror?.({ message: 'Invalid source' });
      if (mode === 'decode') worker.onmessageerror?.();
      await rejected;
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(source).toEqual(before);
    },
  );

  it('bounds a stalled compiler and cleans up its timer, listener and worker', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', CompileWorker);
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const task = buildCoordinatedProjectSetArtifactsTask(fixture(), undefined, abort.signal);
    const rejected = expect(task).rejects.toThrow('two minutes');
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(CompileWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up postMessage cloning failures rather than leaving a stalled worker', async () => {
    vi.stubGlobal('Worker', CompileWorker);
    CompileWorker.postError = new DOMException('Cannot clone source', 'DataCloneError');
    await expect(buildCoordinatedProjectSetArtifactsTask(fixture())).rejects.toThrow(
      'Cannot clone',
    );
    expect(CompileWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('uses the pure fallback when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const source = fixture();
    await expect(buildCoordinatedProjectSetArtifactsTask(source, realtimeProfile)).resolves.toBe(
      artifacts,
    );
    expect(compile).toHaveBeenCalledWith(source, realtimeProfile);
  });

  it('uses the pure fallback when a module worker cannot be created', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Worker unavailable');
        }
      },
    );
    const source = fixture();
    await expect(buildCoordinatedProjectSetArtifactsTask(source)).resolves.toBe(artifacts);
    expect(compile).toHaveBeenCalledWith(source, undefined);
  });

  it('propagates fallback validation errors without changing source', async () => {
    vi.stubGlobal('Worker', undefined);
    const source = fixture(),
      before = structuredClone(source);
    compile.mockImplementationOnce(() => {
      throw new Error('Invalid source');
    });
    await expect(buildCoordinatedProjectSetArtifactsTask(source)).rejects.toThrow('Invalid source');
    expect(source).toEqual(before);
  });
});
