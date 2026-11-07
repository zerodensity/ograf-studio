import { create } from 'zustand';
import { loadBundledStudioPlugins, type BundledStudioPluginLoad } from './bundledStudioPlugins';
import {
  rendererPluginKey,
  assertRendererPluginModule,
  validateRendererPluginSnapshot,
  validateStudioPluginSnapshot,
  isRendererPluginSnapshot,
  isAnimationPresetPluginSnapshot,
  isShaderPackPluginSnapshot,
  studioPluginReference,
  type RendererPluginReference,
  type RendererPluginSnapshot,
  type StudioPluginSnapshot,
  type ShaderPackPluginSnapshot,
} from '@ograf-editor/scene-model';

const PREFERENCES_KEY = 'ograf-studio:renderer-plugin-preferences:v1';
const DATABASE_NAME = 'ograf-studio-renderer-plugins';
const CATALOG_STORE = 'installed';

export const rendererPluginReference = (snapshot: StudioPluginSnapshot): RendererPluginReference =>
  studioPluginReference(snapshot);

export interface RendererPluginCatalogEntry {
  snapshot: StudioPluginSnapshot;
  installedAt: string;
}

export interface InstalledStudioPlugin extends RendererPluginCatalogEntry {
  enabled: boolean;
  trusted: boolean;
  bundled?: boolean;
}
export interface InstalledRendererPlugin extends InstalledStudioPlugin {
  snapshot: RendererPluginSnapshot;
}
export function isInstalledChartPlugin(
  entry: InstalledStudioPlugin,
): entry is InstalledRendererPlugin {
  return isRendererPluginSnapshot(entry.snapshot);
}
export interface InstalledShaderPackPlugin extends InstalledStudioPlugin {
  snapshot: ShaderPackPluginSnapshot;
}
export function isInstalledShaderPackPlugin(
  entry: InstalledStudioPlugin,
): entry is InstalledShaderPackPlugin {
  return isShaderPackPluginSnapshot(entry.snapshot);
}

export interface RendererPluginCatalogStorage {
  list(): Promise<RendererPluginCatalogEntry[]>;
  save(entry: RendererPluginCatalogEntry): Promise<void>;
  remove(key: string): Promise<void>;
}

interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PluginPreferences {
  enabled: Record<string, boolean>;
  trusted: string[];
  defaultProvider: RendererPluginReference | null;
  defaultProviderConfigured?: boolean;
}

interface RendererPluginSettings {
  installed: InstalledStudioPlugin[];
  initialized: boolean;
  loading: boolean;
  error: string;
  defaultProvider: RendererPluginReference | null;
  /** Invalidates mounted previews when installation or local execution policy changes. */
  revision: number;
  initialize(): Promise<void>;
  /** Reload same-origin catalog/preferences; revocation takes effect before the database read. */
  refresh(): Promise<void>;
  /** Call only after the user explicitly reviews and trusts these exact local bytes. */
  install(snapshot: StudioPluginSnapshot): Promise<void>;
  setEnabled(reference: RendererPluginReference, enabled: boolean): void;
  remove(reference: RendererPluginReference): Promise<void>;
  setDefaultProvider(reference: RendererPluginReference | null): void;
}

function readPreferences(storage?: PreferencesStorage): PluginPreferences {
  const empty = {
    enabled: {},
    trusted: [],
    defaultProvider: null,
    defaultProviderConfigured: false,
  };
  try {
    const value = JSON.parse(
      storage?.getItem(PREFERENCES_KEY) ?? 'null',
    ) as Partial<PluginPreferences> | null;
    if (!value || typeof value !== 'object') return empty;
    return {
      enabled: value.enabled && typeof value.enabled === 'object' ? value.enabled : {},
      trusted: Array.isArray(value.trusted)
        ? value.trusted.filter((key) => typeof key === 'string')
        : [],
      defaultProvider:
        value.defaultProvider &&
        typeof value.defaultProvider.id === 'string' &&
        typeof value.defaultProvider.version === 'string' &&
        typeof value.defaultProvider.sha256 === 'string'
          ? value.defaultProvider
          : null,
      defaultProviderConfigured:
        value.defaultProviderConfigured === true ||
        (value.defaultProviderConfigured === undefined && Object.hasOwn(value, 'defaultProvider')),
    };
  } catch {
    return empty;
  }
}

function indexedDbCatalog(): RendererPluginCatalogStorage {
  let database: Promise<IDBDatabase> | undefined;
  const open = () =>
    (database ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Local plugin storage is unavailable in this browser.'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(CATALOG_STORE))
          request.result.createObjectStore(CATALOG_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Could not open local plugin storage.'));
    }));
  return {
    async list() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db
          .transaction(CATALOG_STORE, 'readonly')
          .objectStore(CATALOG_STORE)
          .getAll();
        request.onsuccess = () => resolve(request.result as RendererPluginCatalogEntry[]);
        request.onerror = () =>
          reject(request.error ?? new Error('Could not read installed plugins.'));
      });
    },
    async save(entry) {
      const db = await open();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(CATALOG_STORE, 'readwrite');
        const store = transaction.objectStore(CATALOG_STORE);
        let collision: Error | undefined;
        const existing = store.getAll();
        existing.onsuccess = () => {
          const entries = existing.result as RendererPluginCatalogEntry[];
          if (
            entries.some(
              (item) =>
                item.snapshot?.manifest?.id === entry.snapshot.manifest.id &&
                item.snapshot.manifest.kind !== entry.snapshot.manifest.kind,
            )
          ) {
            collision = new Error('A plugin ID cannot be used by different plugin kinds.');
            transaction.abort();
            return;
          }
          store.put({ ...entry, key: rendererPluginKey(rendererPluginReference(entry.snapshot)) });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(collision ?? transaction.error ?? new Error('Could not save installed plugin.'));
      });
    },
    async remove(key) {
      const db = await open();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(CATALOG_STORE, 'readwrite');
        transaction.objectStore(CATALOG_STORE).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error ?? new Error('Could not remove installed plugin.'));
      });
    },
  };
}

export function createRendererPluginSettingsStore(
  catalog: RendererPluginCatalogStorage,
  storage?: PreferencesStorage,
  includedPlugins?: () => Promise<BundledStudioPluginLoad>,
) {
  let preferences = readPreferences(storage);
  let initializing: Promise<void> | undefined;
  let refreshEpoch = 0;
  let installationQueue: Promise<void> = Promise.resolve();
  let bundledEntries: RendererPluginCatalogEntry[] = [];
  const bundledKeys = new Set<string>();
  const latestPreferences = () => (storage ? readPreferences(storage) : preferences);
  const persist = (next: PluginPreferences) => {
    storage?.setItem(PREFERENCES_KEY, JSON.stringify(next));
    // Never let a rejected persistence operation leak its trust/default edits into a later save.
    preferences = next;
  };
  const applyPreferences = (
    entries: readonly RendererPluginCatalogEntry[],
    current: PluginPreferences,
  ) => {
    const installed = entries.map((entry) => {
      const key = rendererPluginKey(rendererPluginReference(entry.snapshot));
      return {
        ...entry,
        bundled: bundledKeys.has(key),
        trusted: bundledKeys.has(key) || current.trusted.includes(key),
        enabled: Object.hasOwn(current.enabled, key)
          ? current.enabled[key] === true
          : bundledKeys.has(key),
      };
    });
    const includedChart = installed.find(
      (entry) => entry.bundled && entry.enabled && isInstalledChartPlugin(entry),
    );
    const reference =
      current.defaultProvider ??
      (!current.defaultProviderConfigured && includedChart
        ? rendererPluginReference(includedChart.snapshot)
        : null);
    const defaultProvider =
      reference &&
      installed.some(
        (entry) =>
          isInstalledChartPlugin(entry) &&
          entry.enabled &&
          entry.trusted &&
          rendererPluginKey(rendererPluginReference(entry.snapshot)) ===
            rendererPluginKey(reference),
      )
        ? reference
        : null;
    return { installed, defaultProvider };
  };
  return create<RendererPluginSettings>((set, get) => ({
    installed: [],
    initialized: false,
    loading: false,
    error: '',
    defaultProvider: preferences.defaultProvider,
    revision: 0,
    initialize() {
      if (initializing) return initializing;
      initializing = get().refresh();
      return initializing;
    },
    async refresh() {
      const epoch = ++refreshEpoch;
      preferences = latestPreferences();
      set((state) => ({
        ...applyPreferences(state.installed, preferences),
        loading: true,
        revision: state.revision + 1,
      }));
      try {
        const [local, included] = await Promise.allSettled([
          catalog.list(),
          includedPlugins ? includedPlugins() : Promise.resolve({ snapshots: [], errors: [] }),
        ]);
        if (epoch !== refreshEpoch) return;
        const issues: string[] = [];
        if (local.status === 'rejected')
          issues.push(
            local.reason instanceof Error
              ? local.reason.message
              : 'Local plugin storage is unavailable.',
          );
        if (included.status === 'rejected')
          issues.push(
            included.reason instanceof Error
              ? included.reason.message
              : 'Included plugins could not be loaded.',
          );
        const entries =
          local.status === 'fulfilled'
            ? local.value.filter(
                (entry) => entry && validateStudioPluginSnapshot(entry.snapshot).length === 0,
              )
            : [];
        if (included.status === 'fulfilled') {
          issues.push(...included.value.errors);
          bundledEntries = included.value.snapshots.map((snapshot) => {
            const errors = validateStudioPluginSnapshot(snapshot);
            if (errors.length) throw new Error(errors.join('\n'));
            const key = rendererPluginKey(rendererPluginReference(snapshot));
            const previous = entries.find(
              (entry) => rendererPluginKey(rendererPluginReference(entry.snapshot)) === key,
            );
            return { snapshot, installedAt: previous?.installedAt ?? new Date().toISOString() };
          });
          bundledKeys.clear();
          for (const entry of bundledEntries)
            bundledKeys.add(rendererPluginKey(rendererPluginReference(entry.snapshot)));
          // Retain exact included versions across future Studio upgrades and portable exports.
          if (local.status === 'fulfilled') {
            for (const entry of bundledEntries) {
              const key = rendererPluginKey(rendererPluginReference(entry.snapshot));
              const previous = entries.find(
                (item) => rendererPluginKey(rendererPluginReference(item.snapshot)) === key,
              );
              if (previous && JSON.stringify(previous.snapshot) === JSON.stringify(entry.snapshot))
                continue;
              try {
                await catalog.save(entry);
              } catch (cause) {
                issues.push(
                  cause instanceof Error
                    ? cause.message
                    : 'Included plugin bytes could not be saved locally.',
                );
              }
              if (epoch !== refreshEpoch) return;
            }
          }
          const current = latestPreferences();
          const next = {
            ...current,
            enabled: { ...current.enabled },
            trusted: [...current.trusted],
          };
          for (const key of bundledKeys) {
            if (!Object.hasOwn(next.enabled, key)) next.enabled[key] = true;
            if (!next.trusted.includes(key)) next.trusted.push(key);
          }
          if (JSON.stringify(next) !== JSON.stringify(current)) {
            try {
              persist(next);
            } catch (cause) {
              issues.push(
                cause instanceof Error
                  ? cause.message
                  : 'Included plugin preferences could not be saved.',
              );
            }
          }
        }
        preferences = latestPreferences();
        const includedKinds = new Map(
          bundledEntries.map((entry) => [entry.snapshot.manifest.id, entry.snapshot.manifest.kind]),
        );
        const validEntries = entries
          .filter((entry) => validateStudioPluginSnapshot(entry.snapshot).length === 0)
          .filter(
            (entry) =>
              !bundledKeys.has(rendererPluginKey(rendererPluginReference(entry.snapshot))) &&
              (!includedKinds.has(entry.snapshot.manifest.id) ||
                includedKinds.get(entry.snapshot.manifest.id) === entry.snapshot.manifest.kind),
          );
        validEntries.push(...bundledEntries);
        const kinds = new Map<string, string>();
        for (const entry of validEntries) {
          const manifest = entry.snapshot.manifest;
          if (kinds.has(manifest.id) && kinds.get(manifest.id) !== manifest.kind)
            throw new Error('The local catalog contains conflicting plugin kinds for one ID.');
          kinds.set(manifest.id, manifest.kind);
        }
        const resolved = applyPreferences(validEntries, preferences);
        set((state) => ({
          ...resolved,
          initialized: true,
          loading: false,
          error: [...new Set(issues)].join(' '),
          revision: state.revision + 1,
        }));
      } catch (cause: unknown) {
        if (epoch !== refreshEpoch) return;
        set({
          initialized: true,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    async install(snapshot) {
      const errors = validateStudioPluginSnapshot(snapshot);
      if (errors.length) throw new Error(errors.join('\n'));
      const previousInstallation = installationQueue;
      let release = () => {};
      installationQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previousInstallation;
      try {
        if (isRendererPluginSnapshot(snapshot)) await assertRendererPluginModule(snapshot.source);
        await get().initialize();
        const copy = structuredClone(snapshot);
        const reference = rendererPluginReference(copy);
        const key = rendererPluginKey(reference);
        const entry = { snapshot: copy, installedAt: new Date().toISOString() };
        const existing = await catalog.list();
        if (
          [...existing, ...bundledEntries].some(
            (item) =>
              item.snapshot.manifest.id === copy.manifest.id &&
              item.snapshot.manifest.kind !== copy.manifest.kind,
          )
        )
          throw new Error('A plugin ID cannot be used by different plugin kinds.');
        const previous = existing.find(
          (item) => rendererPluginKey(rendererPluginReference(item.snapshot)) === key,
        );
        await catalog.save(entry);
        const current = latestPreferences();
        try {
          persist({
            ...current,
            enabled: { ...current.enabled, [key]: true },
            trusted: [...new Set([...current.trusted, key])],
          });
        } catch (cause) {
          try {
            if (previous) await catalog.save(previous);
            else await catalog.remove(key);
          } catch (rollback) {
            throw new Error(
              `${cause instanceof Error ? cause.message : String(cause)} Plugin bytes could not be rolled back: ${rollback instanceof Error ? rollback.message : String(rollback)}`,
            );
          }
          throw cause;
        }
        const refreshing = get().loading;
        refreshEpoch += 1;
        set((state) => ({
          installed: [
            ...state.installed.filter(
              (item) => rendererPluginKey(rendererPluginReference(item.snapshot)) !== key,
            ),
            { ...entry, enabled: true, trusted: true, bundled: bundledKeys.has(key) },
          ],
          error: '',
          revision: state.revision + 1,
        }));
        if (refreshing) await get().refresh();
      } finally {
        release();
      }
    },
    setEnabled(reference, enabled) {
      const key = rendererPluginKey(reference);
      const current = latestPreferences();
      const entry = get().installed.find(
        (item) => rendererPluginKey(rendererPluginReference(item.snapshot)) === key,
      );
      if (!entry || (!bundledKeys.has(key) && !current.trusted.includes(key)))
        throw new Error('Review and trust this exact plugin version before enabling it.');
      const defaultProvider =
        !enabled && current.defaultProvider && rendererPluginKey(current.defaultProvider) === key
          ? null
          : current.defaultProvider;
      persist({
        ...current,
        enabled: { ...current.enabled, [key]: enabled },
        defaultProvider,
      });
      const refreshing = get().loading;
      refreshEpoch += 1;
      set((state) => ({
        ...applyPreferences(state.installed, preferences),
        revision: state.revision + 1,
      }));
      if (refreshing) void get().refresh();
    },
    async remove(reference) {
      await get().initialize();
      const key = rendererPluginKey(reference);
      if (bundledKeys.has(key))
        throw new Error(
          'This plugin is included with Studio. You can disable it, but it cannot be removed.',
        );
      const current = latestPreferences();
      const defaultProvider =
        current.defaultProvider && rendererPluginKey(current.defaultProvider) === key
          ? null
          : current.defaultProvider;
      // Revocation is immediate; deleting installed bytes never deletes the project's pinned copy.
      persist({
        ...current,
        enabled: { ...current.enabled, [key]: false },
        trusted: current.trusted.filter((item) => item !== key),
        defaultProvider,
      });
      const refreshing = get().loading;
      refreshEpoch += 1;
      set((state) => ({
        installed: state.installed.filter(
          (item) => rendererPluginKey(rendererPluginReference(item.snapshot)) !== key,
        ),
        defaultProvider,
        revision: state.revision + 1,
      }));
      await catalog.remove(key);
      if (refreshing) await get().refresh();
    },
    setDefaultProvider(reference) {
      const current = latestPreferences();
      if (reference) {
        const key = rendererPluginKey(reference);
        if (
          !get().installed.some(
            (item) =>
              isInstalledChartPlugin(item) &&
              (Object.hasOwn(current.enabled, key)
                ? current.enabled[key] === true
                : bundledKeys.has(key)) &&
              (bundledKeys.has(key) || current.trusted.includes(key)) &&
              rendererPluginKey(rendererPluginReference(item.snapshot)) === key,
          )
        )
          throw new Error('The default chart provider must be installed, trusted and enabled.');
      }
      persist({
        ...current,
        defaultProvider: reference ? { ...reference } : null,
        defaultProviderConfigured: true,
      });
      const refreshing = get().loading;
      refreshEpoch += 1;
      set((state) => ({
        defaultProvider: preferences.defaultProvider,
        revision: state.revision + 1,
      }));
      if (refreshing) void get().refresh();
    },
  }));
}

function browserPreferences(): PreferencesStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function canonicalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalMetadata(child)]),
    );
  return value;
}

export const useRendererPluginSettingsStore = createRendererPluginSettingsStore(
  indexedDbCatalog(),
  browserPreferences(),
  loadBundledStudioPlugins,
);

/** Exact installed bytes and trust must match; a project never grants itself execution permission. */
export function rendererPluginAllowed(snapshot: RendererPluginSnapshot): boolean {
  return isRendererPluginSnapshot(snapshot) && studioPluginAllowed(snapshot);
}

/** Exact local review/enablement applies to JSON packs too; it never executes preset data. */
export function studioPluginAllowed(snapshot: StudioPluginSnapshot): boolean {
  const key = rendererPluginKey(rendererPluginReference(snapshot));
  return useRendererPluginSettingsStore
    .getState()
    .installed.some(
      (entry) =>
        entry.enabled &&
        entry.trusted &&
        entry.snapshot.manifest.kind === snapshot.manifest.kind &&
        rendererPluginKey(rendererPluginReference(entry.snapshot)) === key &&
        ((isRendererPluginSnapshot(entry.snapshot) &&
          isRendererPluginSnapshot(snapshot) &&
          entry.snapshot.source === snapshot.source) ||
          (isAnimationPresetPluginSnapshot(entry.snapshot) &&
            isAnimationPresetPluginSnapshot(snapshot) &&
            JSON.stringify(canonicalMetadata(entry.snapshot.presets)) ===
              JSON.stringify(canonicalMetadata(snapshot.presets))) ||
          (isShaderPackPluginSnapshot(entry.snapshot) &&
            isShaderPackPluginSnapshot(snapshot) &&
            JSON.stringify(canonicalMetadata(entry.snapshot.shaders)) ===
              JSON.stringify(canonicalMetadata(snapshot.shaders)))) &&
        entry.snapshot.licenseText === snapshot.licenseText &&
        JSON.stringify(canonicalMetadata(entry.snapshot.manifest)) ===
          JSON.stringify(canonicalMetadata(snapshot.manifest)),
    );
}

export function assertStudioPluginsAllowed(snapshots: readonly StudioPluginSnapshot[]): void {
  for (const snapshot of snapshots) {
    const errors = validateStudioPluginSnapshot(snapshot);
    if (errors.length) throw new Error(errors.join('\n'));
    if (!studioPluginAllowed(snapshot))
      throw new Error(
        `Plugin ${snapshot.manifest.name} ${snapshot.manifest.version} is not installed, reviewed and enabled. Open Plugins to review this exact bundle.`,
      );
  }
}

export function assertStudioRendererPluginsAllowed(
  snapshots: readonly RendererPluginSnapshot[],
): void {
  for (const snapshot of snapshots) {
    const errors = validateRendererPluginSnapshot(snapshot);
    if (errors.length) throw new Error(errors.join('\n'));
    if (!rendererPluginAllowed(snapshot))
      throw new Error(
        `Chart plugin ${snapshot.manifest.name} ${snapshot.manifest.version} is not installed, trusted and enabled. Open Plugins to review these exact bytes.`,
      );
  }
}

export function attachRendererPluginSettingsSync(
  target: EventTarget,
  store = useRendererPluginSettingsStore,
): () => void {
  const listener = (event: Event) => {
    const change = event as StorageEvent;
    if (change.key !== PREFERENCES_KEY && change.key !== null) return;
    // refresh() updates existing trust/enable flags synchronously, before loading new catalog bytes.
    void store.getState().refresh();
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}

let detachPreferencesSync: (() => void) | undefined;

export function registerRendererPluginPolicy(): void {
  (
    globalThis as unknown as {
      __OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__: typeof rendererPluginAllowed;
    }
  ).__OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__ = rendererPluginAllowed;
  detachPreferencesSync?.();
  if (typeof window !== 'undefined')
    detachPreferencesSync = attachRendererPluginSettingsSync(window);
}
