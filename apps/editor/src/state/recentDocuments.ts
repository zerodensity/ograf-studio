import type { StudioDocument } from './studioDocument';

/** Local history retains handles/URLs, never copies of document bytes or granted permissions. */
export interface RecentDocument {
  id: string;
  name: string;
  openedAt: number;
  handle?: FileSystemFileHandle;
  url?: string;
}
export const MAX_RECENT_DOCUMENTS = 10;
const DATABASE = 'ograf-studio-recent-documents';
const STORE = 'documents';
type DocumentSource = { handle: FileSystemFileHandle } | { url: string; name: string };
const openedSources = new WeakMap<StudioDocument, DocumentSource>();

export interface RecentDocumentsStorage {
  read(): Promise<RecentDocument[]>;
  /** Atomically insert/update this record and prune the entire stored history to the limit. */
  commit(record: RecentDocument): Promise<void>;
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Recent document URLs must use HTTP(S) without embedded credentials.');
  url.hash = '';
  return url.href;
}

export function sortedRecentDocuments(items: readonly RecentDocument[]): RecentDocument[] {
  return items
    .filter((item) => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.name !== 'string' ||
        !Number.isFinite(item.openedAt)
      )
        return false;
      if (item.handle && typeof item.handle.getFile === 'function') return true;
      try {
        return typeof item.url === 'string' && normalizedUrl(item.url) === item.url;
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.openedAt - a.openedAt || a.id.localeCompare(b.id));
}

export function updatedRecentDocuments(
  items: readonly RecentDocument[],
  record: RecentDocument,
): RecentDocument[] {
  return sortedRecentDocuments([...items.filter((item) => item.id !== record.id), record]).slice(
    0,
    MAX_RECENT_DOCUMENTS,
  );
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Recent document storage is blocked.'));
  });
}

const browserStorage: RecentDocumentsStorage = {
  async read() {
    const db = await database();
    try {
      return await new Promise<RecentDocument[]>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).getAll();
        request.onsuccess = () => resolve(request.result as RecentDocument[]);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  },
  async commit(record) {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const read = store.getAll();
        read.onsuccess = () => {
          // Read every row inside the write transaction, including older versions' hidden rows.
          const retained = updatedRecentDocuments(read.result as RecentDocument[], record);
          store.clear();
          for (const item of retained) store.put(item);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  },
};

export function createRecentDocumentsHistory(
  storage: RecentDocumentsStorage,
  options: { now?: () => number; id?: () => string } = {},
) {
  let pending = Promise.resolve();
  const remember = (source: DocumentSource) => {
    const work = pending.then(async () => {
      const previous = sortedRecentDocuments(await storage.read());
      let existing: RecentDocument | undefined;
      if ('handle' in source) {
        for (const item of previous) {
          try {
            if (
              item.handle &&
              (item.handle === source.handle || (await item.handle.isSameEntry?.(source.handle)))
            ) {
              existing = item;
              break;
            }
          } catch {
            /* An inaccessible old handle must not block a different valid document. */
          }
        }
      } else existing = previous.find((item) => item.url === source.url);
      await storage.commit({
        id: existing?.id ?? options.id?.() ?? crypto.randomUUID(),
        name: 'handle' in source ? source.handle.name : source.name,
        openedAt: Math.max(options.now?.() ?? Date.now(), (previous[0]?.openedAt ?? 0) + 1),
        ...source,
      });
    });
    pending = work.catch(() => undefined);
    return work;
  };
  return {
    async list() {
      await pending;
      return sortedRecentDocuments(await storage.read()).slice(0, MAX_RECENT_DOCUMENTS);
    },
    rememberHandle: (handle: FileSystemFileHandle) => remember({ handle }),
    rememberUrl: async (url: string, name: string) => remember({ url: normalizedUrl(url), name }),
  };
}

const history = createRecentDocumentsHistory(browserStorage);
export async function readRecentDocuments(): Promise<{
  documents: RecentDocument[];
  unavailable: boolean;
}> {
  try {
    return { documents: await history.list(), unavailable: false };
  } catch {
    return { documents: [], unavailable: true };
  }
}
export async function listRecentDocuments(): Promise<RecentDocument[]> {
  return (await readRecentDocuments()).documents;
}
export async function rememberRecentDocument(handle: FileSystemFileHandle): Promise<void> {
  try {
    await history.rememberHandle(handle);
  } catch {
    /* Optional local history must not block saving. */
  }
}

/** Associate a validated read; history is recorded only when the document is actually applied. */
export function associateRecentDocument(
  document: StudioDocument,
  source: DocumentSource,
): StudioDocument {
  openedSources.set(document, source);
  return document;
}
export function rememberOpenedStudioDocument(document: StudioDocument): void {
  const source = openedSources.get(document);
  if (!source) return;
  void (
    'handle' in source
      ? history.rememberHandle(source.handle)
      : history.rememberUrl(source.url, source.name)
  ).catch(() => undefined);
}

/** Invoke directly from the click so a retained file handle can request fresh read permission. */
export async function readRecentDocument(item: RecentDocument): Promise<StudioDocument> {
  if (item.url) return (await import('./fileIO')).openStudioDocumentFromUrl(item.url);
  const handle = item.handle as
    | (FileSystemFileHandle & {
        requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
      })
    | undefined;
  if (!handle || typeof handle.getFile !== 'function')
    throw new Error('This recent file cannot be reopened. Choose Open to select it again.');
  if (handle.requestPermission && (await handle.requestPermission({ mode: 'read' })) !== 'granted')
    throw new Error('File access was not granted. Choose Open to select the file again.');
  const file = await handle.getFile();
  const { parseStudioDocument } = await import('./studioDocument');
  return associateRecentDocument(await parseStudioDocument(await file.arrayBuffer()), { handle });
}
