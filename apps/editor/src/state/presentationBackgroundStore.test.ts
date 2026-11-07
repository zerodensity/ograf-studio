import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPresentationBackgroundSession,
  createPresentationBackgroundStorage,
  type PresentationBackgroundSettings,
  type PresentationBackgroundSnapshot,
} from './presentationBackgroundStore';

function fakeStore<State>(initial: State) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: State) {
      state = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settings = (
  mode: PresentationBackgroundSettings['mode'] = 'none',
  imageSource = '',
): PresentationBackgroundSettings => ({
  mode,
  imageSource,
  imageName: imageSource ? 'Still' : '',
});
const projectState = (id = 'one', seed = settings()) => ({
  project: {
    id,
    mainCompositionId: 'main',
    compositions: [
      {
        id: 'main',
        layout: {
          presentationBackground: seed.mode,
          presentationBackgroundImageSource: seed.imageSource,
          presentationBackgroundImageName: seed.imageName,
        },
      },
    ],
  },
  activeCompositionId: 'main',
});
const set = (id = 'show', ids = ['one', 'two']) => ({
  id,
  templates: ids.map((id) => ({ project: { id } })),
});
function memoryStorage() {
  const records = new Map<string, PresentationBackgroundSettings>();
  const read = vi.fn(async (key: string) => records.get(key) ?? null);
  const write = vi.fn(async (key: string, value: PresentationBackgroundSettings) => {
    records.set(key, { ...value });
  });
  return { records, read, write };
}
const cleanups: Array<() => void> = [];
function fixture({
  storage = memoryStorage(),
  seed = settings(),
  documentSet = set() as ReturnType<typeof set> | null,
} = {}) {
  const projects = fakeStore(projectState('one', seed));
  const projectSets = fakeStore({ projectSet: documentSet });
  const publish = vi.fn<(value: PresentationBackgroundSnapshot) => void>();
  const stopPresentation = vi.fn();
  const session = createPresentationBackgroundSession({
    projects,
    projectSets,
    storage,
    publish,
    stopPresentation,
  });
  cleanups.push(session.dispose);
  return {
    projects,
    projectSets,
    publish,
    stopPresentation,
    session,
    storage,
    snapshot: () => publish.mock.calls.at(-1)![0],
  };
}
const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('presentation background document ownership', () => {
  it('seeds a set once and retains explicit None through project-first template navigation and edits', async () => {
    const f = fixture({ seed: settings('big-buck-bunny') });
    const initialSource = structuredClone(f.projects.getState());
    await flush();
    expect(f.snapshot().ownerKey).toBe('set:show');
    expect(f.session.update({ mode: 'none' }, 'set:show')).toBe(true);
    expect(f.projects.getState()).toEqual(initialSource);
    f.projects.set(projectState('two', settings('webcam')));
    f.projectSets.set({ projectSet: set() });
    await flush();
    expect(f.snapshot().settings.mode).toBe('none');
    expect(f.storage.read).toHaveBeenCalledTimes(1);
    expect(f.stopPresentation).not.toHaveBeenCalled();
  });

  it('does not seed a new set from the previous project while set-first loading is incomplete', async () => {
    const f = fixture();
    f.projectSets.set({ projectSet: set('new-set', ['new']) });
    await flush();
    expect(f.snapshot().ownerKey).toBeNull();
    expect(f.storage.read).not.toHaveBeenCalledWith('set:new-set');
    f.projects.set(
      projectState('new', settings('still-image', 'https://example.test/backdrop.png')),
    );
    await flush();
    expect(f.snapshot().ownerKey).toBe('set:new-set');
    expect(f.snapshot().settings.imageSource).toContain('backdrop.png');
  });

  it('coalesces project-first/set-clear loading and rejects an old asynchronous image owner', async () => {
    const f = fixture();
    await flush();
    f.projects.set(projectState('standalone', settings('big-buck-bunny')));
    f.projectSets.set({ projectSet: null });
    // The observer microtask has not run yet, but update must check the current document.
    expect(f.session.update({ mode: 'still-image', imageSource: 'old.png' }, 'set:show')).toBe(
      false,
    );
    await flush();
    expect(f.snapshot().ownerKey).toBe('project:standalone');
    expect(f.snapshot().settings.mode).toBe('big-buck-bunny');
    expect(f.storage.read.mock.calls.map(([key]) => key)).toEqual([
      'set:show',
      'project:standalone',
    ]);
    f.projectSets.set({ projectSet: set() });
    f.projects.set(projectState());
    await flush();
    expect(f.snapshot().ownerKey).toBe('set:show');
    expect(f.storage.read).toHaveBeenCalledTimes(2);
  });

  it('distinguishes a standalone project from a set containing the same project', async () => {
    const f = fixture();
    f.session.update({ mode: 'big-buck-bunny' });
    f.projectSets.set({ projectSet: null });
    await flush();
    expect(f.snapshot().ownerKey).toBe('project:one');
    expect(f.snapshot().settings.mode).toBe('none');
  });

  it('releases presentation only for an explicit actual change away from webcam', async () => {
    const f = fixture({ seed: settings('webcam') });
    await flush();
    expect(f.stopPresentation).not.toHaveBeenCalled();
    f.session.update({ imageName: 'remembered image' });
    f.session.update({ mode: 'webcam' });
    expect(f.stopPresentation).not.toHaveBeenCalled();
    f.session.update({ mode: 'none' });
    f.session.update({ mode: 'none' });
    expect(f.stopPresentation).toHaveBeenCalledOnce();
    f.session.dispose();
    expect(f.projects.listenerCount()).toBe(0);
    expect(f.projectSets.listenerCount()).toBe(0);
    expect(f.stopPresentation).toHaveBeenCalledOnce();
  });
});

describe('presentation background persistence and asynchronous races', () => {
  it('releases a current legacy Webcam presentation when hydration restores a different mode', async () => {
    const pending = deferred<PresentationBackgroundSettings | null>();
    const storage = memoryStorage();
    storage.read.mockImplementationOnce(() => pending.promise);
    const f = fixture({ storage, seed: settings('webcam') });
    expect(f.stopPresentation).not.toHaveBeenCalled();
    pending.resolve(settings('none'));
    await flush();
    expect(f.stopPresentation).toHaveBeenCalledOnce();
    expect(f.snapshot().settings.mode).toBe('none');
  });

  it('does not release a new document camera when an old Webcam owner finishes hydration', async () => {
    const pending = deferred<PresentationBackgroundSettings | null>();
    const storage = memoryStorage();
    storage.read.mockImplementationOnce(() => pending.promise);
    const f = fixture({ storage, seed: settings('webcam') });
    f.projects.set(projectState('new', settings('webcam')));
    f.projectSets.set({ projectSet: null });
    await flush();
    pending.resolve(settings('none'));
    await flush();
    expect(f.stopPresentation).not.toHaveBeenCalled();
    expect(f.snapshot().ownerKey).toBe('project:new');
    expect(f.snapshot().settings.mode).toBe('webcam');
  });

  it('preserves an explicit Webcam Start intent against saved None', async () => {
    const pending = deferred<PresentationBackgroundSettings | null>();
    const storage = memoryStorage();
    storage.read.mockImplementationOnce(() => pending.promise);
    const f = fixture({ storage, seed: settings('webcam') });
    f.session.update({ mode: 'webcam' });
    pending.resolve(settings('none'));
    await flush();
    expect(f.stopPresentation).not.toHaveBeenCalled();
    expect(f.snapshot().settings.mode).toBe('webcam');
    expect(storage.records.get('set:show')?.mode).toBe('webcam');
  });

  it('restores the same set after a new session without copying its settings into graphic source', async () => {
    const storage = memoryStorage();
    const f = fixture({ storage });
    await flush();
    f.session.update({
      mode: 'still-image',
      imageSource: 'data:image/png;base64,AQID',
      imageName: 'My image',
    });
    await flush();
    expect(f.snapshot().storageStatus).toBe('saved');
    f.session.dispose();
    const reopened = fixture({ storage, seed: settings('webcam') });
    await flush();
    expect(reopened.snapshot().settings).toEqual({
      mode: 'still-image',
      imageSource: 'data:image/png;base64,AQID',
      imageName: 'My image',
    });
    expect(
      reopened.projects.getState().project.compositions[0]!.layout.presentationBackground,
    ).toBe('webcam');
    expect(reopened.stopPresentation).toHaveBeenCalledOnce();
  });

  it('an explicit None selection defeats a late saved value even when the seed is already None', async () => {
    const pending = deferred<PresentationBackgroundSettings | null>();
    const storage = memoryStorage();
    storage.read.mockImplementation(() => pending.promise);
    const f = fixture({ storage });
    f.session.update({ mode: 'none' });
    await flush();
    pending.resolve(settings('webcam'));
    await flush();
    expect(f.snapshot().settings.mode).toBe('none');
    expect(f.snapshot().storageStatus).toBe('saved');
    expect(storage.records.get('set:show')?.mode).toBe('none');
  });

  it('does not publish late hydration into another document or a disposed session', async () => {
    const pending = deferred<PresentationBackgroundSettings | null>();
    const storage = memoryStorage();
    storage.read.mockImplementationOnce(() => pending.promise);
    const f = fixture({ storage });
    f.projects.set(projectState('new'));
    f.projectSets.set({ projectSet: null });
    await flush();
    const count = f.publish.mock.calls.length;
    pending.resolve(settings('webcam'));
    await flush();
    expect(f.publish).toHaveBeenCalledTimes(count);
    expect(f.snapshot().ownerKey).toBe('project:new');
    const late = deferred<PresentationBackgroundSettings | null>();
    storage.read.mockImplementationOnce(() => late.promise);
    f.projects.set(projectState('third'));
    await flush();
    f.session.dispose();
    const afterDispose = f.publish.mock.calls.length;
    late.resolve(settings('still-image', 'late.png'));
    await flush();
    expect(f.publish).toHaveBeenCalledTimes(afterDispose);
    expect(f.session.update({ mode: 'none' })).toBe(false);
  });

  it('serializes and coalesces writes, acknowledging only the latest successful transaction', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const storage = memoryStorage();
    storage.write
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const f = fixture({ storage });
    await flush(); // Initial seed write is pending.
    f.session.update({ mode: 'big-buck-bunny' });
    f.session.update({ mode: 'still-image', imageSource: 'final.png' });
    expect(storage.write).toHaveBeenCalledTimes(1);
    first.resolve();
    await flush();
    expect(storage.write).toHaveBeenCalledTimes(2);
    expect(storage.write.mock.calls[1]![1].imageSource).toBe('final.png');
    expect(f.snapshot().storageStatus).toBe('saving');
    second.resolve();
    await flush();
    expect(f.snapshot().storageStatus).toBe('saved');
  });

  it('keeps settings usable after storage failure and clears the error after a later successful edit', async () => {
    const storage = memoryStorage();
    storage.read.mockRejectedValueOnce(new Error('Storage denied'));
    storage.write.mockRejectedValueOnce(new Error('Quota exceeded'));
    const f = fixture({ storage });
    await flush();
    expect(f.snapshot().storageError).toBe('Storage denied');
    expect(f.session.update({ mode: 'big-buck-bunny' })).toBe(true);
    await flush();
    expect(f.snapshot().settings.mode).toBe('big-buck-bunny');
    expect(f.snapshot().storageStatus).toBe('session-only');
    expect(f.snapshot().storageError).toBe('Quota exceeded');
    f.session.update({ mode: 'none' });
    await flush();
    expect(f.snapshot().storageStatus).toBe('saved');
    expect(f.snapshot().storageError).toBeNull();
  });

  it('accepts a 10 MiB binary image after base64 encoding and rejects oversized or invalid settings', async () => {
    const f = fixture();
    await flush();
    const encoded = 'A'.repeat(Math.ceil((10 * 1024 * 1024) / 3) * 4 - 2) + '==';
    expect(
      f.session.update({ mode: 'still-image', imageSource: `data:image/png;base64,${encoded}` }),
    ).toBe(true);
    expect(
      f.session.update({ imageSource: `data:image/png;base64,${encoded.slice(0, -2)}AAAA` }),
    ).toBe(false);
    expect(f.session.update({ imageSource: 'data:text/html;base64,AQID' })).toBe(false);
    expect(f.session.update({ mode: 'unexpected' as 'none' })).toBe(false);
    expect(f.session.update({ mode: 'none' }, null)).toBe(false);
  });
});

describe('IndexedDB storage boundary', () => {
  it('reports absent IndexedDB without making local settings unusable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const backend = createPresentationBackgroundStorage();
    await expect(backend.read('set:show')).rejects.toThrow('unavailable');
    await expect(backend.write('set:show', settings())).rejects.toThrow('unavailable');
  });

  it('does not acknowledge a write before its transaction commits', async () => {
    const request = {} as IDBOpenDBRequest;
    const transaction = {
      objectStore: () => ({ put: vi.fn() }),
      oncomplete: null,
      onabort: null,
      onerror: null,
    } as unknown as IDBTransaction;
    const database = { transaction: () => transaction, close: vi.fn() } as unknown as IDBDatabase;
    Object.assign(request, { result: database });
    vi.stubGlobal('indexedDB', { open: () => request });
    const backend = createPresentationBackgroundStorage();
    const done = vi.fn();
    const writing = backend.write('project:one', settings()).then(done);
    request.onsuccess?.call(request, new Event('success'));
    await flush();
    expect(done).not.toHaveBeenCalled();
    transaction.oncomplete?.call(transaction, new Event('complete'));
    await writing;
    expect(done).toHaveBeenCalledOnce();
  });

  it('rejects a blocked open and closes a database that opens after failure', async () => {
    const request = {} as IDBOpenDBRequest;
    const close = vi.fn();
    Object.assign(request, { result: { close } });
    vi.stubGlobal('indexedDB', { open: () => request });
    const backend = createPresentationBackgroundStorage();
    const reading = backend.read('set:show');
    const rejected = expect(reading).rejects.toThrow('blocked');
    request.onblocked?.call(request, new Event('blocked') as IDBVersionChangeEvent);
    await rejected;
    request.onsuccess?.call(request, new Event('success'));
    expect(close).toHaveBeenCalledOnce();
  });
});
