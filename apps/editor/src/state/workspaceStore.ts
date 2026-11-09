import { create } from 'zustand';
import type { DockLayoutState, DockPaneId } from '../layout/dockModel';
import {
  DEFAULT_WORKSPACE_ID,
  FIRST_RUN_WORKSPACE_ID,
  MAX_WORKSPACE_IMPORT_BYTES,
  MAX_WORKSPACE_PRESETS,
  WORKSPACE_STORAGE_KEY,
  cloneWorkspaceSnapshot,
  createBuiltinWorkspacePresets,
  exportWorkspacePresets,
  normalizeWorkspaceName,
  normalizeWorkspaceSizes,
  normalizeAssistantContextPreferences,
  normalizeStudioExportDefaults,
  parseDetachedPanePlacement,
  parseWorkspacePresetImport,
  parseWorkspaceSnapshot,
  parseWorkspaceState,
  serializeWorkspaceState,
  workspaceSnapshotsEqual,
  type DetachedPanePlacement,
  type PersistedWorkspaceState,
  type StudioEditorPreferences,
  type WorkspacePreset,
  type WorkspaceSnapshot,
  type WorkspaceStartup,
} from './workspaceModel';

export type {
  DetachedPanePlacement,
  StudioEditorPreferences,
  WorkspacePreset,
  WorkspaceSnapshot,
  WorkspaceStartup,
} from './workspaceModel';
export { DEFAULT_WORKSPACE_ID, serializeWorkspaceState } from './workspaceModel';

export interface WorkspaceStoreState {
  current: WorkspaceSnapshot;
  lastDetached: Partial<Record<DockPaneId, DetachedPanePlacement>>;
  activePresetId: string;
  presets: WorkspacePreset[];
  startup: WorkspaceStartup;
  editorPreferences: StudioEditorPreferences;
  applyRevision: number;
  modified: boolean;
  storageError: string | null;
  updateLayout: (layout: DockLayoutState) => void;
  updateSizes: (sizes: Partial<WorkspaceSnapshot['sizes']>) => void;
  updateDetached: (pane: DockPaneId, placement: DetachedPanePlacement | null) => void;
  applyPreset: (id: string) => void;
  resetCurrent: () => void;
  saveAs: (name: string) => string;
  updateCurrentPreset: () => void;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
  updateStartup: (startup: Partial<WorkspaceStartup>) => void;
  updateEditorPreferences: (preferences: Partial<StudioEditorPreferences>) => void;
  importPresets: (value: unknown) => void;
  exportPresets: () => object;
  flush: () => void;
  setStorageError: (message: string | null) => void;
}

function restoredState(persisted: PersistedWorkspaceState) {
  const presets = [...createBuiltinWorkspacePresets(), ...persisted.presets];
  const activePresetId =
    persisted.startup.mode === 'preset'
      ? persisted.startup.presetId
      : persisted.session.activePresetId;
  const active = presets.find((preset) => preset.id === activePresetId)!;
  const current = cloneWorkspaceSnapshot(
    persisted.startup.mode === 'preset' ? active.snapshot : persisted.session.current,
  );
  return {
    presets,
    activePresetId,
    current,
    lastDetached: { ...persisted.session.lastDetached, ...current.detached },
    startup: persisted.startup,
    editorPreferences: {
      syncEditorPreview: persisted.editorPreferences?.syncEditorPreview === true,
      durationUnit: persisted.editorPreferences?.durationUnit ?? 'seconds',
      showWelcomeOnStartup: persisted.editorPreferences?.showWelcomeOnStartup !== false,
      assistantContext: normalizeAssistantContextPreferences(
        persisted.editorPreferences?.assistantContext,
      ),
      exportDefaults: normalizeStudioExportDefaults(persisted.editorPreferences?.exportDefaults),
    },
    modified: !workspaceSnapshotsEqual(current, active.snapshot),
  };
}

function initialState() {
  const presets = createBuiltinWorkspacePresets();
  const firstRun = presets.find((preset) => preset.id === FIRST_RUN_WORKSPACE_ID)!;
  const fallback = {
    presets,
    activePresetId: FIRST_RUN_WORKSPACE_ID,
    current: cloneWorkspaceSnapshot(firstRun.snapshot),
    lastDetached: {} as Partial<Record<DockPaneId, DetachedPanePlacement>>,
    startup: {
      mode: 'last',
      presetId: FIRST_RUN_WORKSPACE_ID,
      restoreDetached: true,
    } as WorkspaceStartup,
    editorPreferences: {
      syncEditorPreview: false,
      durationUnit: 'seconds' as const,
      showWelcomeOnStartup: true,
      assistantContext: normalizeAssistantContextPreferences(null),
      exportDefaults: normalizeStudioExportDefaults(null),
    },
    modified: false,
    storageError: null as string | null,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw) {
      let persisted: PersistedWorkspaceState | null = null;
      try {
        if (raw.length <= MAX_WORKSPACE_IMPORT_BYTES)
          persisted = parseWorkspaceState(JSON.parse(raw));
      } catch {
        // Preserve the user's files and recover only the independent workspace preference.
      }
      if (persisted) return { ...restoredState(persisted), storageError: null };
      return {
        ...fallback,
        storageError:
          'Saved workspace settings could not be read. The default workspace has been opened.',
      };
    }
    const oldLayout = window.localStorage.getItem('ograf-studio:dock-layout:v1');
    const oldSizes = window.localStorage.getItem('ograf-editor:panel-sizes');
    const oldLeftTab = window.localStorage.getItem('ograf-studio:left-tab');
    if (!oldLayout && !oldSizes && !oldLeftTab) return fallback;
    let layout: unknown;
    const defaultLayout = cloneWorkspaceSnapshot(presets[0]!.snapshot).layout;
    if (oldLeftTab === 'chat') {
      defaultLayout.zones.left[0]!.activePane = 'chat';
    }
    let sizes: Record<string, unknown> = {};
    try {
      layout = oldLayout ? JSON.parse(oldLayout) : defaultLayout;
    } catch {
      layout = defaultLayout;
    }
    try {
      sizes = oldSizes ? JSON.parse(oldSizes) : {};
    } catch {
      sizes = {};
    }
    if (!sizes || typeof sizes !== 'object' || Array.isArray(sizes)) sizes = {};
    const current =
      parseWorkspaceSnapshot({
        version: 1,
        layout,
        sizes: {
          left: sizes['left-sidebar'],
          right: sizes['right-tabs'],
          top: sizes['top-dock'],
          bottom: sizes.timeline,
        },
        detached: {},
      }) ?? fallback.current;
    return {
      ...fallback,
      activePresetId: DEFAULT_WORKSPACE_ID,
      startup: { ...fallback.startup, presetId: DEFAULT_WORKSPACE_ID },
      current,
      modified: !workspaceSnapshotsEqual(current, presets[0]!.snapshot),
    };
  } catch {
    return {
      ...fallback,
      storageError:
        'Browser storage is unavailable. Workspace changes will last for this session only; export presets to keep a copy.',
    };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return `workspace-${crypto.randomUUID()}`;
  return `workspace-${Date.now().toString(36)}-${(++nextId).toString(36)}`;
}

function requirePreset(presets: WorkspacePreset[], id: string): WorkspacePreset {
  const preset = presets.find((item) => item.id === id);
  if (!preset) throw new Error('This workspace no longer exists.');
  return preset;
}

function requireEditablePreset(presets: WorkspacePreset[], id: string): WorkspacePreset {
  const preset = requirePreset(presets, id);
  if (preset.builtin)
    throw new Error(
      'Built-in workspaces are read-only. Use Save Workspace As to create your own preset.',
    );
  return preset;
}

function requireUniqueName(presets: WorkspacePreset[], name: string, exceptId?: string): string {
  const normalized = normalizeWorkspaceName(name);
  if (
    presets.some(
      (preset) =>
        preset.id !== exceptId &&
        preset.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
    )
  ) {
    throw new Error('A workspace with that name already exists. Choose another name.');
  }
  return normalized;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => {
  const updateCurrent = (current: WorkspaceSnapshot, lastDetached = get().lastDetached) => {
    const state = get();
    if (workspaceSnapshotsEqual(state.current, current) && state.lastDetached === lastDetached)
      return;
    const active = requirePreset(state.presets, state.activePresetId);
    set({ current, lastDetached, modified: !workspaceSnapshotsEqual(current, active.snapshot) });
  };
  return {
    ...initialState(),
    applyRevision: 0,
    updateLayout: (layout) => {
      const current = parseWorkspaceSnapshot({ ...get().current, layout });
      if (current) updateCurrent(current);
    },
    updateSizes: (sizes) => {
      updateCurrent({
        ...get().current,
        sizes: normalizeWorkspaceSizes({ ...get().current.sizes, ...sizes }),
      });
    },
    updateDetached: (pane, placement) => {
      const detached = { ...get().current.detached };
      let lastDetached = get().lastDetached;
      if (placement === null) delete detached[pane];
      else {
        const sanitized = parseDetachedPanePlacement(placement);
        if (!sanitized) return;
        detached[pane] = sanitized;
        if (JSON.stringify(lastDetached[pane]) !== JSON.stringify(sanitized)) {
          lastDetached = { ...lastDetached, [pane]: sanitized };
        }
      }
      updateCurrent({ ...get().current, detached }, lastDetached);
    },
    applyPreset: (id) => {
      const preset = requirePreset(get().presets, id);
      set({
        current: cloneWorkspaceSnapshot(preset.snapshot),
        lastDetached: { ...get().lastDetached, ...preset.snapshot.detached },
        activePresetId: id,
        modified: false,
        applyRevision: get().applyRevision + 1,
      });
      get().flush();
    },
    resetCurrent: () => get().applyPreset(get().activePresetId),
    saveAs: (name) => {
      const state = get();
      if (state.presets.filter((preset) => !preset.builtin).length >= MAX_WORKSPACE_PRESETS) {
        throw new Error(
          `You can save up to ${MAX_WORKSPACE_PRESETS} workspace presets. Delete a preset before adding another.`,
        );
      }
      const normalized = requireUniqueName(state.presets, name);
      const id = makeId();
      const preset: WorkspacePreset = {
        id,
        name: normalized,
        builtin: false,
        snapshot: cloneWorkspaceSnapshot(state.current),
      };
      set({ presets: [...state.presets, preset], activePresetId: id, modified: false });
      get().flush();
      return id;
    },
    updateCurrentPreset: () => {
      const state = get();
      requireEditablePreset(state.presets, state.activePresetId);
      set({
        presets: state.presets.map((preset) =>
          preset.id === state.activePresetId
            ? { ...preset, snapshot: cloneWorkspaceSnapshot(state.current) }
            : preset,
        ),
        modified: false,
      });
      get().flush();
    },
    renamePreset: (id, name) => {
      const state = get();
      requireEditablePreset(state.presets, id);
      const normalized = requireUniqueName(state.presets, name, id);
      set({
        presets: state.presets.map((preset) =>
          preset.id === id ? { ...preset, name: normalized } : preset,
        ),
      });
      get().flush();
    },
    deletePreset: (id) => {
      const state = get();
      requireEditablePreset(state.presets, id);
      const activePresetId =
        state.activePresetId === id ? DEFAULT_WORKSPACE_ID : state.activePresetId;
      const presets = state.presets.filter((preset) => preset.id !== id);
      set({
        presets,
        activePresetId,
        modified: !workspaceSnapshotsEqual(
          state.current,
          requirePreset(presets, activePresetId).snapshot,
        ),
        startup:
          state.startup.presetId === id
            ? { ...state.startup, presetId: DEFAULT_WORKSPACE_ID }
            : state.startup,
      });
      get().flush();
    },
    updateStartup: (patch) => {
      const state = get();
      const candidate = { ...state.startup, ...patch };
      if (candidate.mode !== 'last' && candidate.mode !== 'preset')
        throw new Error('Select a valid startup behavior.');
      requirePreset(state.presets, candidate.presetId);
      set({
        startup: {
          mode: candidate.mode,
          presetId: candidate.presetId,
          restoreDetached: candidate.restoreDetached === true,
        },
      });
      get().flush();
    },
    updateEditorPreferences: (patch) => {
      const previous = get().editorPreferences;
      const next = { ...previous, ...patch };
      const syncEditorPreview = next.syncEditorPreview === true;
      const showWelcomeOnStartup = next.showWelcomeOnStartup !== false;
      const assistantContext = normalizeAssistantContextPreferences(next.assistantContext);
      const exportDefaults = normalizeStudioExportDefaults(next.exportDefaults);
      const previousExportDefaults = normalizeStudioExportDefaults(previous.exportDefaults);
      const previousAssistantContext = normalizeAssistantContextPreferences(
        previous.assistantContext,
      );
      const durationUnit =
        next.durationUnit === 'frames' || next.durationUnit === 'timecode'
          ? next.durationUnit
          : 'seconds';
      if (
        syncEditorPreview === previous.syncEditorPreview &&
        durationUnit === (previous.durationUnit ?? 'seconds') &&
        showWelcomeOnStartup === (previous.showWelcomeOnStartup !== false) &&
        exportDefaults.scope === previousExportDefaults.scope &&
        exportDefaults.format === previousExportDefaults.format &&
        Object.entries(assistantContext).every(
          ([key, value]) =>
            value === previousAssistantContext[key as keyof typeof assistantContext],
        )
      )
        return;
      set({
        editorPreferences: {
          syncEditorPreview,
          durationUnit,
          showWelcomeOnStartup,
          assistantContext,
          exportDefaults,
        },
      });
      get().flush();
    },
    importPresets: (value) => {
      const incoming = parseWorkspacePresetImport(value);
      const state = get();
      if (
        state.presets.filter((preset) => !preset.builtin).length + incoming.length >
        MAX_WORKSPACE_PRESETS
      ) {
        throw new Error(
          `Import would exceed the limit of ${MAX_WORKSPACE_PRESETS} saved workspaces.`,
        );
      }
      const presets = [...state.presets];
      for (const preset of incoming) {
        let name = preset.name;
        let suffix = 2;
        while (
          presets.some((existing) => existing.name.toLocaleLowerCase() === name.toLocaleLowerCase())
        ) {
          const tail = ` (${suffix++})`;
          name = preset.name.slice(0, 80 - tail.length) + tail;
        }
        presets.push({ ...preset, id: makeId(), name });
      }
      set({ presets });
      get().flush();
    },
    exportPresets: () => exportWorkspacePresets(get().presets),
    flush: () => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = undefined;
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(
          WORKSPACE_STORAGE_KEY,
          JSON.stringify(serializeWorkspaceState(get())),
        );
        if (
          get().storageError?.startsWith('Browser storage') ||
          get().storageError?.startsWith('Saved workspace settings')
        )
          set({ storageError: null });
      } catch {
        set({
          storageError:
            'Browser storage could not save workspace settings. Export presets to keep a copy.',
        });
      }
    },
    setStorageError: (storageError) => {
      if (get().storageError !== storageError) set({ storageError });
    },
  };
});

/** Loads a standalone profile before mounting Studio; rejects unsupported data. */
export function hydrateWorkspaceState(value: unknown): void {
  const persisted = parseWorkspaceState(value);
  if (!persisted)
    throw new Error('The saved workspace profile is not a supported OGraf Studio workspace file.');
  useWorkspaceStore.setState({
    ...restoredState(persisted),
    applyRevision: useWorkspaceStore.getState().applyRevision + 1,
    storageError: null,
  });
  useWorkspaceStore.getState().flush();
}

useWorkspaceStore.subscribe((state, previous) => {
  if (
    state.current === previous.current &&
    state.lastDetached === previous.lastDetached &&
    state.presets === previous.presets &&
    state.activePresetId === previous.activePresetId &&
    state.startup === previous.startup &&
    state.editorPreferences === previous.editorPreferences
  )
    return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => useWorkspaceStore.getState().flush(), 250);
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => useWorkspaceStore.getState().flush());
  window.addEventListener('beforeunload', () => useWorkspaceStore.getState().flush());
}
