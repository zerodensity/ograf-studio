import { create } from 'zustand';
import { EMPTY_EXAMPLE_CATALOG, mergeExampleCatalogs, type ExampleCatalog } from './exampleCatalog';
import {
  BUILTIN_CATALOG_PATH,
  fetchCatalog,
  isExampleSaved,
  ONLINE_CATALOG_URL,
  openExampleFileCache,
  readSavedCatalog,
  type ExampleFileCache,
} from './exampleCatalogClient';

/** Reopening the window within this time reuses the list instead of asking the server again. */
const REFRESH_AFTER_MS = 5 * 60_000;

let fileCache: Promise<ExampleFileCache | null> | undefined;
/** One saved-files store for the session; `null` where the browser offers none. */
export function exampleFileCache(): Promise<ExampleFileCache | null> {
  return (fileCache ??= openExampleFileCache());
}

async function savedIds(catalog: ExampleCatalog): Promise<ReadonlySet<string>> {
  const cache = await exampleFileCache();
  const saved = await Promise.all(
    catalog.examples.map(async (example) =>
      (await isExampleSaved(example, cache)) ? example.id : null,
    ),
  );
  return new Set(saved.filter((id): id is string => id !== null));
}

let refreshing: Promise<void> | null = null;
let refreshedAt = 0;

/** Session state: the examples Studio knows about, and which of them open without a connection. */
export const useExampleCatalogStore = create<{
  catalog: ExampleCatalog;
  /** Whether the examples repo answered the last check; `null` until the first check ends. */
  online: boolean | null;
  savedIds: ReadonlySet<string>;
  /** Show what is saved at once, then bring the list up to date in the background. */
  refresh: () => Promise<void>;
  markSaved: (id: string) => void;
}>((set, get) => ({
  catalog: EMPTY_EXAMPLE_CATALOG,
  online: null,
  savedIds: new Set(),
  markSaved: (id) => set((state) => ({ savedIds: new Set(state.savedIds).add(id) })),
  refresh: () => {
    if (refreshing) return refreshing;
    if (get().online && Date.now() - refreshedAt < REFRESH_AFTER_MS) return Promise.resolve();
    const fetcher = (input: string, init?: RequestInit) => fetch(input, init);
    const show = async (catalog: ExampleCatalog, online: boolean | null) =>
      set({ catalog, online, savedIds: await savedIds(catalog) });
    refreshing = (async () => {
      const cache = await exampleFileCache();
      const builtinUrl = new URL(BUILTIN_CATALOG_PATH, document.baseURI).href;
      const [builtin, saved] = await Promise.all([
        fetchCatalog(builtinUrl, 'builtin', fetcher, null),
        readSavedCatalog(cache, ONLINE_CATALOG_URL),
      ]);
      const shipped = builtin ?? EMPTY_EXAMPLE_CATALOG;
      await show(mergeExampleCatalogs(shipped, saved ?? EMPTY_EXAMPLE_CATALOG), get().online);
      const current = await fetchCatalog(ONLINE_CATALOG_URL, 'online', fetcher, cache);
      if (current) {
        refreshedAt = Date.now();
        await show(mergeExampleCatalogs(shipped, current), true);
      } else set({ online: false });
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  },
}));
