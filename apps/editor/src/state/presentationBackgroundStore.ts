import { create } from 'zustand';
import type { CanvasPresentationBackground } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { stopWebcamPresentation } from './webcamPreview';

export interface PresentationBackgroundSettings {
  mode: CanvasPresentationBackground;
  imageSource: string;
  imageName: string;
}
export type PresentationBackgroundStorageStatus =
  'idle' | 'loading' | 'saving' | 'saved' | 'session-only';
export interface PresentationBackgroundSnapshot {
  ownerKey: string | null;
  settings: PresentationBackgroundSettings;
  storageError: string | null;
  storageStatus: PresentationBackgroundStorageStatus;
}
export interface PresentationBackgroundStorage {
  read(ownerKey: string): Promise<PresentationBackgroundSettings | null>;
  write(ownerKey: string, settings: PresentationBackgroundSettings): Promise<void>;
}

interface ProjectState {
  project: {
    id: string;
    mainCompositionId: string;
    compositions: ReadonlyArray<{
      id: string;
      layout: {
        presentationBackground?: CanvasPresentationBackground;
        presentationBackgroundImageSource?: string;
        presentationBackgroundImageName?: string;
      };
    }>;
  };
  activeCompositionId: string;
}
interface SetState {
  projectSet: { id: string; templates: ReadonlyArray<{ project: { id: string } }> } | null;
}
interface ReadableStore<State> {
  getState(): State;
  subscribe(listener: () => void): () => void;
}

const emptySettings: PresentationBackgroundSettings = {
  mode: 'none',
  imageSource: '',
  imageName: '',
};
const emptySnapshot: PresentationBackgroundSnapshot = {
  ownerKey: null,
  settings: emptySettings,
  storageError: null,
  storageStatus: 'idle',
};
const imageByteLimit = 10 * 1024 * 1024;
const modes = new Set(['none', 'big-buck-bunny', 'still-image', 'webcam']);

/** The existing picker accepts a 10 MiB file, not a 10 MiB base64 string. */
function validImageSource(source: string): boolean {
  if (!source.startsWith('data:')) return source.length <= 64 * 1024;
  const comma = source.indexOf(',');
  if (comma < 0 || comma > 256 || !/^data:image\//i.test(source)) return false;
  const header = source.slice(0, comma);
  const data = source.slice(comma + 1);
  if (/;base64$/i.test(header)) {
    if (data.length > Math.ceil(imageByteLimit / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
      return false;
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    return (data.length * 3) / 4 - padding <= imageByteLimit;
  }
  try {
    return (
      data.length <= imageByteLimit * 3 &&
      new TextEncoder().encode(decodeURIComponent(data)).length <= imageByteLimit
    );
  } catch {
    return false;
  }
}

function validSettings(value: unknown): value is PresentationBackgroundSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as PresentationBackgroundSettings;
  return (
    modes.has(settings.mode) &&
    typeof settings.imageSource === 'string' &&
    validImageSource(settings.imageSource) &&
    typeof settings.imageName === 'string' &&
    settings.imageName.length <= 1024
  );
}

/** Separate from workspace preferences and graphic files; images never enter localStorage. */
export function createPresentationBackgroundStorage(): PresentationBackgroundStorage {
  let database: Promise<IDBDatabase> | undefined;
  const open = () => {
    if (database) return database;
    database = new Promise<IDBDatabase>((resolve, reject) => {
      let factory: IDBFactory | undefined;
      try {
        factory = globalThis.indexedDB;
      } catch (error) {
        reject(error);
        return;
      }
      if (!factory) {
        reject(new Error('Local preview background storage is unavailable in this browser.'));
        return;
      }
      const request = factory.open('ograf-studio-presentation-backgrounds', 1);
      let finished = false;
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        reject(error);
      };
      const timeout = setTimeout(
        () => fail(new Error('Local preview background storage did not open.')),
        5000,
      );
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('backgrounds'))
          request.result.createObjectStore('backgrounds', { keyPath: 'ownerKey' });
      };
      request.onerror = () =>
        fail(request.error ?? new Error('Could not open local preview background storage.'));
      request.onblocked = () =>
        fail(new Error('Local preview background storage is blocked by another window.'));
      request.onsuccess = () => {
        if (finished) {
          request.result.close();
          return;
        }
        finished = true;
        clearTimeout(timeout);
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
    });
    void database.catch(() => {
      database = undefined;
    });
    return database;
  };
  return {
    async read(ownerKey) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('backgrounds', 'readonly');
        const request = transaction.objectStore('backgrounds').get(ownerKey);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Could not read the preview background.'));
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Could not read the preview background.'));
        transaction.oncomplete = () => {
          const record: unknown = request.result;
          if (record === undefined) {
            resolve(null);
            return;
          }
          if (
            !record ||
            typeof record !== 'object' ||
            !('version' in record) ||
            record.version !== 1 ||
            !('settings' in record) ||
            !validSettings(record.settings)
          ) {
            reject(new Error('The saved preview background is invalid.'));
            return;
          }
          resolve({ ...record.settings });
        };
      });
    },
    async write(ownerKey, settings) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('backgrounds', 'readwrite');
        transaction
          .objectStore('backgrounds')
          .put({ version: 1, ownerKey, settings, updatedAt: Date.now() });
        // A request succeeding is not a durable write until the transaction completes.
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Could not save the preview background.'));
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Could not save the preview background.'));
      });
    },
  };
}

interface Entry {
  ownerKey: string;
  settings: PresentationBackgroundSettings;
  revision: number;
  storageStatus: PresentationBackgroundStorageStatus;
  storageError: string | null;
  pendingWrite?: { settings: PresentationBackgroundSettings; revision: number };
  writing: boolean;
}

/** Injectable document observer keeps camera, graphic state and storage lifecycles independent. */
export function createPresentationBackgroundSession({
  projects,
  projectSets,
  storage,
  publish,
  stopPresentation,
}: {
  projects: ReadableStore<ProjectState>;
  projectSets: ReadableStore<SetState>;
  storage: PresentationBackgroundStorage;
  publish(snapshot: PresentationBackgroundSnapshot): void;
  stopPresentation(): void;
}) {
  const entries = new Map<string, Entry>();
  let current: Entry | null = null;
  let disposed = false;
  let scheduled = false;
  const emit = (entry: Entry | null) => {
    if (disposed || entry !== current) return;
    publish(
      entry
        ? {
            ownerKey: entry.ownerKey,
            settings: entry.settings,
            storageStatus: entry.storageStatus,
            storageError: entry.storageError,
          }
        : emptySnapshot,
    );
  };
  const save = async (entry: Entry) => {
    if (entry.writing) return;
    entry.writing = true;
    // Serialize each owner's writes so an older completion cannot overwrite the newest image.
    while (entry.pendingWrite) {
      const pending = entry.pendingWrite;
      entry.pendingWrite = undefined;
      try {
        await storage.write(entry.ownerKey, pending.settings);
        if (entry.revision === pending.revision) {
          entry.storageStatus = 'saved';
          entry.storageError = null;
        }
      } catch (error) {
        if (entry.revision === pending.revision) {
          entry.storageStatus = 'session-only';
          entry.storageError = error instanceof Error ? error.message : String(error);
        }
      }
      emit(entry);
    }
    entry.writing = false;
  };
  const queueSave = (entry: Entry) => {
    entry.pendingWrite = { settings: { ...entry.settings }, revision: entry.revision };
    entry.storageStatus = 'saving';
    entry.storageError = null;
    emit(entry);
    void save(entry);
  };
  const hydrate = async (entry: Entry) => {
    const revision = entry.revision;
    try {
      const saved = await storage.read(entry.ownerKey);
      if (disposed || entry.revision !== revision) return;
      if (saved) {
        if (!validSettings(saved)) throw new Error('The saved preview background is invalid.');
        // A legacy Webcam seed can be visible while storage opens. Never leave its capture
        // hidden by a restored different mode, or stop the new document for an old read.
        const releaseCamera =
          entry === current && entry.settings.mode === 'webcam' && saved.mode !== 'webcam';
        entry.settings = { ...saved };
        entry.storageStatus = 'saved';
        entry.storageError = null;
        if (releaseCamera) stopPresentation();
        emit(entry);
      } else queueSave(entry);
    } catch (error) {
      if (disposed || entry.revision !== revision) return;
      entry.storageStatus = 'session-only';
      entry.storageError = error instanceof Error ? error.message : String(error);
      emit(entry);
    }
  };
  const reconcile = () => {
    if (disposed) return;
    const { project, activeCompositionId } = projects.getState();
    const set = projectSets.getState().projectSet;
    // Opening a set can publish it before its child project. Never seed it from the old document.
    const ownerKey = set
      ? set.templates.some((template) => template.project.id === project.id)
        ? `set:${set.id}`
        : null
      : `project:${project.id}`;
    if (ownerKey === (current?.ownerKey ?? null)) return;
    if (!ownerKey) {
      current = null;
      emit(null);
      return;
    }
    const cached = entries.get(ownerKey);
    if (cached) {
      current = cached;
      emit(current);
      return;
    }
    const composition =
      project.compositions.find((item) => item.id === activeCompositionId) ??
      project.compositions.find((item) => item.id === project.mainCompositionId) ??
      project.compositions[0];
    const layout = composition?.layout;
    const seed = {
      mode: layout?.presentationBackground ?? 'none',
      imageSource: layout?.presentationBackgroundImageSource ?? '',
      imageName: layout?.presentationBackgroundImageName ?? '',
    };
    current = {
      ownerKey,
      settings: validSettings(seed) ? seed : { ...emptySettings },
      revision: 0,
      storageStatus: 'loading',
      storageError: null,
      writing: false,
    };
    entries.set(ownerKey, current);
    emit(current);
    void hydrate(current);
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      reconcile();
    });
  };
  const unsubscribeProject = projects.subscribe(schedule);
  const unsubscribeSet = projectSets.subscribe(schedule);
  reconcile();
  return {
    update(
      patch: Partial<PresentationBackgroundSettings>,
      expectedOwnerKey?: string | null,
    ): boolean {
      if (disposed) return false;
      // File readers can finish between a store change and the deferred observer.
      reconcile();
      if (!current || (expectedOwnerKey !== undefined && expectedOwnerKey !== current.ownerKey))
        return false;
      if (
        !Object.keys(patch).length ||
        Object.keys(patch).some((key) => !['mode', 'imageSource', 'imageName'].includes(key))
      )
        return false;
      const next = { ...current.settings, ...patch };
      if (!validSettings(next)) return false;
      const releaseCamera = current.settings.mode === 'webcam' && next.mode !== 'webcam';
      // An explicit choice of None also defeats late hydration, even if it matches the seed.
      current.revision++;
      current.settings = next;
      if (releaseCamera) stopPresentation();
      queueSave(current);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeProject();
      unsubscribeSet();
      // Finish queued durable writes, but never publish or stop capture during observer cleanup.
    },
  };
}

type Session = ReturnType<typeof createPresentationBackgroundSession>;
let session: Session | null = null;
export const usePresentationBackgroundStore = create<
  PresentationBackgroundSnapshot & {
    update(
      patch: Partial<PresentationBackgroundSettings>,
      expectedOwnerKey?: string | null,
    ): boolean;
  }
>(() => ({
  ...emptySnapshot,
  update: (patch, expectedOwnerKey) => session?.update(patch, expectedOwnerKey) ?? false,
}));

let stopSession: (() => void) | null = null;
export function initializePresentationBackgroundSession(): () => void {
  if (stopSession) return stopSession;
  session = createPresentationBackgroundSession({
    projects: useProjectStore,
    projectSets: useProjectSetStore,
    storage: createPresentationBackgroundStorage(),
    publish: (snapshot) => usePresentationBackgroundStore.setState(snapshot),
    stopPresentation: stopWebcamPresentation,
  });
  const stop = () => {
    if (stopSession !== stop) return;
    session?.dispose();
    session = null;
    stopSession = null;
  };
  stopSession = stop;
  return stop;
}

if (import.meta.hot) import.meta.hot.dispose(() => stopSession?.());
