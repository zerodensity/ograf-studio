import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { createProjectSet, createProjectSetArchive, openProjectSetArchive } from './projectSet';
import { createProjectSetArchiveTask } from './projectSetArchiveTask';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  TestWorker.instances = [];
});
describe('responsive template set archiving', () => {
  it('forwards the explicit compatible-save choice to the archive worker', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const set = createProjectSet('News', createProject());
    const saving = createProjectSetArchiveTask(set, { archiveMode: 'compatible' });
    const worker = TestWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({
      set,
      legacyFormat: undefined,
      archiveMode: 'compatible',
    });
    const blob = new Blob(['archive']);
    worker.emit({ type: 'complete', blob });
    await expect(saving).resolves.toBe(blob);
  });
  it('uses the archive worker, reports progress, and terminates after completion', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const set = createProjectSet('News', createProject());
    const onProgress = vi.fn();
    const saving = createProjectSetArchiveTask(set, { onProgress });
    const worker = TestWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({ set, legacyFormat: undefined });
    const progress = { phase: 'templates', percent: 30, message: 'Preparing template' };
    worker.emit({ type: 'progress', progress });
    expect(onProgress).toHaveBeenCalledWith(progress);
    const blob = new Blob(['archive']);
    worker.emit({ type: 'complete', blob });
    await expect(saving).resolves.toBe(blob);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('propagates generation failures instead of downloading a corrupt archive', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const saving = createProjectSetArchiveTask(createProjectSet('News', createProject()));
    const assertion = expect(saving).rejects.toThrow('Invalid source');
    TestWorker.instances[0]!.emit({ type: 'error', message: 'Invalid source' });
    await assertion;
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it('bounds stalled archive workers without modifying the open source', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', TestWorker);
    const set = createProjectSet('News', createProject());
    const before = structuredClone(set);
    const saving = createProjectSetArchiveTask(set);
    const assertion = expect(saving).rejects.toThrow('two minutes');
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(set).toEqual(before);
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it('retains a validated fallback with monotonic progress and archive roundtrip', async () => {
    vi.stubGlobal('Worker', undefined);
    const set = createProjectSet('News', createProject());
    const progress: number[] = [];
    const archive = await createProjectSetArchiveTask(set, {
      onProgress: (value) => progress.push(value.percent),
    });
    expect((await openProjectSetArchive(await archive.arrayBuffer())).id).toBe(set.id);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect((await createProjectSetArchive(set)).size).toBe(archive.size);
  });
});
