import {
  DOCK_PANE_IDS,
  createDefaultDockLayout,
  parseDockLayout,
  type DockGroupState,
  type DockLayoutState,
  type DockPaneId,
  type DockZone,
} from './dockModel';
import {
  normalizeAssistantContextPreferences,
  type AssistantContextPreferences,
} from './assistantPreferences';
export {
  ASSISTANT_CONTEXT_TOKEN_BOUNDS,
  DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
  normalizeAssistantContextPreferences,
  type AssistantContextPreferences,
} from './assistantPreferences';

export interface DetachedPanePlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  screen?: { left: number; top: number; width: number; height: number };
}

export interface WorkspaceSnapshot {
  version: 1;
  layout: DockLayoutState;
  sizes: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    outerLeft?: number;
    outerRight?: number;
    outerTop?: number;
    outerBottom?: number;
  };
  detached: Partial<Record<DockPaneId, DetachedPanePlacement>>;
}

export interface WorkspacePreset {
  id: string;
  name: string;
  builtin: boolean;
  snapshot: WorkspaceSnapshot;
}

export interface WorkspaceStartup {
  mode: 'last' | 'preset';
  presetId: string;
  restoreDetached: boolean;
}

export interface StudioEditorPreferences {
  syncEditorPreview: boolean;
  durationUnit?: 'seconds' | 'frames' | 'timecode';
  /** Per-user preference; older profiles show the welcome screen by default. */
  showWelcomeOnStartup?: boolean;
  /** Assistant context budgets belong to this user, never template or set source files. */
  assistantContext?: AssistantContextPreferences;
  /** Initial choices in Studio's export dialog. */
  exportDefaults?: StudioExportDefaults;
}

export interface StudioExportDefaults {
  scope: 'template' | 'set';
  format: 'zip' | 'html' | 'both';
}

export const DEFAULT_STUDIO_EXPORT_DEFAULTS: Readonly<StudioExportDefaults> = {
  scope: 'set',
  format: 'both',
};

export function normalizeStudioExportDefaults(value: unknown): StudioExportDefaults {
  const preferences = record(value) ? value : {};
  return {
    scope: preferences.scope === 'template' ? 'template' : DEFAULT_STUDIO_EXPORT_DEFAULTS.scope,
    format:
      preferences.format === 'zip' || preferences.format === 'html'
        ? preferences.format
        : DEFAULT_STUDIO_EXPORT_DEFAULTS.format,
  };
}

export interface PersistedWorkspaceState {
  format: 'ograf-studio-workspaces';
  version: 1;
  presets: WorkspacePreset[];
  session: {
    current: WorkspaceSnapshot;
    activePresetId: string;
    lastDetached?: Partial<Record<DockPaneId, DetachedPanePlacement>>;
  };
  startup: WorkspaceStartup;
  editorPreferences?: StudioEditorPreferences;
}

export const WORKSPACE_STORAGE_KEY = 'ograf-studio:workspaces:v1';
export const MAX_WORKSPACE_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_WORKSPACE_PRESETS = 100;
export const DEFAULT_WORKSPACE_ID = 'builtin-default';
export const FIRST_RUN_WORKSPACE_ID = 'builtin-essentials';
export const DEFAULT_WORKSPACE_SIZES: WorkspaceSnapshot['sizes'] = {
  left: 380,
  right: 300,
  top: 220,
  bottom: 220,
};
const ZONES: DockZone[] = ['left', 'right', 'top', 'bottom'];
const SIZE_LIMITS: Record<DockZone, [number, number]> = {
  left: [220, 520],
  right: [220, 520],
  top: [120, 420],
  bottom: [120, 480],
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)))
    : fallback;
}

export function normalizeWorkspaceSizes(value: unknown): WorkspaceSnapshot['sizes'] {
  const candidate = record(value) ? value : {};
  const sizes = { ...DEFAULT_WORKSPACE_SIZES };
  for (const zone of ZONES) {
    const [min, max] = SIZE_LIMITS[zone];
    sizes[zone] = boundedNumber(candidate[zone], min, max, sizes[zone]);
  }
  const outerSizes = [
    ['outerLeft', 'left'],
    ['outerRight', 'right'],
    ['outerTop', 'top'],
    ['outerBottom', 'bottom'],
  ] as const;
  for (const [key, zone] of outerSizes) {
    if (typeof candidate[key] === 'number' && Number.isFinite(candidate[key])) {
      const [min, max] = SIZE_LIMITS[zone];
      sizes[key] = boundedNumber(candidate[key], min, max, sizes[zone]);
    }
  }
  return sizes;
}

export function parseDetachedPanePlacement(value: unknown): DetachedPanePlacement | null {
  if (!record(value)) return null;
  if (
    !['left', 'top', 'width', 'height'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    )
  )
    return null;
  const placement: DetachedPanePlacement = {
    left: boundedNumber(value.left, -100000, 100000, 40),
    top: boundedNumber(value.top, -100000, 100000, 40),
    width: boundedNumber(value.width, 240, 16384, 480),
    height: boundedNumber(value.height, 160, 16384, 640),
  };
  const screen = value.screen;
  if (
    record(screen) &&
    ['left', 'top', 'width', 'height'].every(
      (key) => typeof screen[key] === 'number' && Number.isFinite(screen[key]),
    )
  ) {
    placement.screen = {
      left: boundedNumber(screen.left, -100000, 100000, 0),
      top: boundedNumber(screen.top, -100000, 100000, 0),
      width: boundedNumber(screen.width, 240, 16384, 1920),
      height: boundedNumber(screen.height, 160, 16384, 1080),
    };
  }
  return placement;
}

export function parseDetachedPlacements(
  value: unknown,
): Partial<Record<DockPaneId, DetachedPanePlacement>> {
  const placements: Partial<Record<DockPaneId, DetachedPanePlacement>> = {};
  if (record(value)) {
    for (const pane of DOCK_PANE_IDS) {
      const placement = parseDetachedPanePlacement(value[pane]);
      if (placement) placements[pane] = placement;
    }
  }
  return placements;
}

function validDockLayout(value: unknown): value is Record<string, unknown> {
  if (!record(value) || value.version !== 1 || !record(value.zones)) return false;
  if (!Array.isArray(value.floating) || value.floating.length > DOCK_PANE_IDS.length) return false;
  if (
    value.closed !== undefined &&
    (!Array.isArray(value.closed) || value.closed.length > DOCK_PANE_IDS.length)
  )
    return false;
  if (value.outerZones !== undefined && !record(value.outerZones)) return false;
  return [value.zones, ...(value.outerZones === undefined ? [] : [value.outerZones])].every(
    (zones) =>
      ZONES.every((zone) => {
        const groups = (zones as Record<string, unknown>)[zone];
        return (
          Array.isArray(groups) &&
          groups.length <= DOCK_PANE_IDS.length &&
          groups.every(
            (group) =>
              record(group) &&
              Array.isArray(group.panes) &&
              group.panes.length <= DOCK_PANE_IDS.length,
          )
        );
      }),
  );
}

/** Returns a sanitized, detached copy, or null for an unsupported document. */
export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!record(value) || value.version !== 1 || !validDockLayout(value.layout)) return null;
  const layout = parseDockLayout(value.layout);
  const groupIds = new Set<string>();
  for (const zone of ZONES) {
    for (const [prefix, groups] of [
      ['', layout.zones[zone]],
      ['outer-', layout.outerZones?.[zone] ?? []],
    ] as const) {
      for (const [index, group] of groups.entries()) {
        let id = group.id.slice(0, 100);
        if (!id || groupIds.has(id)) id = `${prefix}${zone}-workspace-${index}`;
        while (groupIds.has(id)) id += '-1';
        group.id = id;
        groupIds.add(id);
        group.weight = Math.max(0.01, Math.min(100000, group.weight));
      }
    }
  }
  layout.floating = layout.floating.map((pane) => ({
    ...pane,
    x: boundedNumber(pane.x, 0, 100000, 160),
    y: boundedNumber(pane.y, 0, 100000, 100),
    width: boundedNumber(pane.width, 240, 16384, 480),
    height: boundedNumber(pane.height, 160, 16384, 440),
  }));
  const detached: WorkspaceSnapshot['detached'] = {};
  if (record(value.detached)) {
    for (const pane of DOCK_PANE_IDS) {
      const placement = parseDetachedPanePlacement(value.detached[pane]);
      if (placement && !layout.closed.includes(pane)) detached[pane] = placement;
    }
  }
  return { version: 1, layout, sizes: normalizeWorkspaceSizes(value.sizes), detached };
}

export function cloneWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return parseWorkspaceSnapshot(snapshot)!;
}

export function workspaceSnapshotsEqual(
  first: WorkspaceSnapshot,
  second: WorkspaceSnapshot,
): boolean {
  return (
    JSON.stringify(cloneWorkspaceSnapshot(first)) === JSON.stringify(cloneWorkspaceSnapshot(second))
  );
}

export function normalizeWorkspaceName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a workspace name.');
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Workspace names must contain 1–80 characters without control characters.');
  }
  return name;
}

function group(id: string, panes: DockPaneId[], activePane = panes[0]!): DockGroupState {
  return { id, panes, activePane, weight: 1 };
}

function presetLayout(groups: Partial<Record<DockZone, DockGroupState[]>>): DockLayoutState {
  const zones = { left: [], right: [], top: [], bottom: [], ...groups };
  const included = new Set(
    Object.values(zones).flatMap((items) => items.flatMap((item) => item.panes)),
  );
  return {
    version: 1,
    zones,
    floating: [],
    closed: DOCK_PANE_IDS.filter((pane) => !included.has(pane)),
  };
}

export function createBuiltinWorkspacePresets(): WorkspacePreset[] {
  const make = (
    id: string,
    name: string,
    layout: DockLayoutState,
    sizes = DEFAULT_WORKSPACE_SIZES,
    detached: WorkspaceSnapshot['detached'] = {},
  ): WorkspacePreset => ({
    id: `builtin-${id}`,
    name,
    builtin: true,
    snapshot: { version: 1, layout, sizes: { ...sizes }, detached },
  });
  const design = presetLayout({
    left: [
      group('design-scene', ['layers', 'templates', 'scene-tree']),
      group('design-resources', ['resources', 'chat']),
    ],
    right: [group('design-properties', ['inspector', 'brand-kit', 'export'])],
    bottom: [group('design-timeline', ['timeline', 'plugins', 'transitions'])],
  });
  const animation = presetLayout({
    left: [
      group('animation-scene', ['layers', 'scene-tree', 'templates']),
      group('animation-assets', ['resources', 'chat']),
    ],
    right: [group('animation-properties', ['inspector', 'rules', 'export'])],
    bottom: [group('animation-timeline', ['timeline', 'plugins', 'transitions'])],
  });
  const data = presetLayout({
    left: [
      group('data-scene', ['scene-tree', 'templates', 'layers']),
      group('data-fields', ['data', 'resources', 'chat']),
    ],
    right: [
      group('data-rules', ['rules', 'inspector', 'brand-kit']),
      group('data-preview', ['export']),
    ],
    bottom: [group('data-timeline', ['timeline', 'plugins', 'transitions'])],
  });
  const secondScreen = { left: 1920, top: 0, width: 1920, height: 1080 };
  return [
    make('default', 'Default', createDefaultDockLayout()),
    make(
      'essentials',
      'Essentials',
      presetLayout({
        left: [group('essentials-layers', ['layers'])],
        right: [group('essentials-properties', ['inspector'])],
        bottom: [group('essentials-timeline', ['timeline'])],
      }),
      { left: 250, right: 280, top: 220, bottom: 220 },
    ),
    make('design', 'Design', design, { left: 330, right: 360, top: 220, bottom: 160 }),
    make('animation', 'Animation', animation, { left: 320, right: 320, top: 220, bottom: 360 }),
    make('data-rules', 'Data & Rules', data, { left: 400, right: 480, top: 220, bottom: 160 }),
    make('dual-monitor', 'Dual Monitor', createDefaultDockLayout(), DEFAULT_WORKSPACE_SIZES, {
      timeline: { left: 1960, top: 540, width: 1600, height: 480, screen: { ...secondScreen } },
      export: { left: 1960, top: 40, width: 1000, height: 460, screen: { ...secondScreen } },
    }),
  ];
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value);
}

function parseCustomPresets(value: unknown): WorkspacePreset[] | null {
  if (!Array.isArray(value) || value.length > MAX_WORKSPACE_PRESETS) return null;
  const presets: WorkspacePreset[] = [];
  const ids = new Set<string>();
  const names = new Set(
    createBuiltinWorkspacePresets().map((item) => item.name.toLocaleLowerCase()),
  );
  for (const candidate of value) {
    if (
      !record(candidate) ||
      !validId(candidate.id) ||
      candidate.id.startsWith('builtin-') ||
      ids.has(candidate.id)
    )
      return null;
    let name: string;
    try {
      name = normalizeWorkspaceName(candidate.name);
    } catch {
      return null;
    }
    const snapshot = parseWorkspaceSnapshot(candidate.snapshot);
    if (!snapshot || names.has(name.toLocaleLowerCase())) return null;
    names.add(name.toLocaleLowerCase());
    ids.add(candidate.id);
    presets.push({ id: candidate.id, name, builtin: false, snapshot });
  }
  return presets;
}

export function parseWorkspaceState(value: unknown): PersistedWorkspaceState | null {
  if (
    !record(value) ||
    value.format !== 'ograf-studio-workspaces' ||
    value.version !== 1 ||
    !record(value.session)
  )
    return null;
  const presets = parseCustomPresets(value.presets);
  const current = parseWorkspaceSnapshot(value.session.current);
  if (!presets || !current) return null;
  const knownIds = new Set(
    [...createBuiltinWorkspacePresets(), ...presets].map((preset) => preset.id),
  );
  const activePresetId =
    typeof value.session.activePresetId === 'string' && knownIds.has(value.session.activePresetId)
      ? value.session.activePresetId
      : DEFAULT_WORKSPACE_ID;
  const rawStartup = record(value.startup) ? value.startup : {};
  return {
    format: 'ograf-studio-workspaces',
    version: 1,
    presets,
    session: {
      current,
      activePresetId,
      lastDetached: { ...parseDetachedPlacements(value.session.lastDetached), ...current.detached },
    },
    startup: {
      mode: rawStartup.mode === 'preset' ? 'preset' : 'last',
      presetId:
        typeof rawStartup.presetId === 'string' && knownIds.has(rawStartup.presetId)
          ? rawStartup.presetId
          : DEFAULT_WORKSPACE_ID,
      restoreDetached: rawStartup.restoreDetached !== false,
    },
    editorPreferences: {
      syncEditorPreview:
        record(value.editorPreferences) && value.editorPreferences.syncEditorPreview === true,
      showWelcomeOnStartup:
        !record(value.editorPreferences) || value.editorPreferences.showWelcomeOnStartup !== false,
      durationUnit:
        record(value.editorPreferences) &&
        (value.editorPreferences.durationUnit === 'frames' ||
          value.editorPreferences.durationUnit === 'timecode')
          ? value.editorPreferences.durationUnit
          : 'seconds',
      assistantContext: normalizeAssistantContextPreferences(
        record(value.editorPreferences) ? value.editorPreferences.assistantContext : null,
      ),
      exportDefaults: normalizeStudioExportDefaults(
        record(value.editorPreferences) ? value.editorPreferences.exportDefaults : null,
      ),
    },
  };
}

export function serializeWorkspaceState(state: {
  presets: WorkspacePreset[];
  current: WorkspaceSnapshot;
  activePresetId: string;
  startup: WorkspaceStartup;
  editorPreferences?: StudioEditorPreferences;
  lastDetached?: Partial<Record<DockPaneId, DetachedPanePlacement>>;
}): PersistedWorkspaceState {
  return {
    format: 'ograf-studio-workspaces',
    version: 1,
    presets: state.presets
      .filter((preset) => !preset.builtin)
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        builtin: false,
        snapshot: cloneWorkspaceSnapshot(preset.snapshot),
      })),
    session: {
      current: cloneWorkspaceSnapshot(state.current),
      activePresetId: state.activePresetId,
      lastDetached: parseDetachedPlacements(state.lastDetached ?? state.current.detached),
    },
    startup: { ...state.startup },
    editorPreferences: {
      syncEditorPreview: state.editorPreferences?.syncEditorPreview === true,
      durationUnit: state.editorPreferences?.durationUnit ?? 'seconds',
      showWelcomeOnStartup: state.editorPreferences?.showWelcomeOnStartup !== false,
      assistantContext: normalizeAssistantContextPreferences(
        state.editorPreferences?.assistantContext,
      ),
      exportDefaults: normalizeStudioExportDefaults(state.editorPreferences?.exportDefaults),
    },
  };
}

export function parseWorkspacePresetImport(value: unknown): WorkspacePreset[] {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new Error('The workspace file is not valid JSON.');
  }
  if (!text || text.length > MAX_WORKSPACE_IMPORT_BYTES)
    throw new Error('Workspace files must be smaller than 2 MB.');
  if (!record(value) || value.format !== 'ograf-studio-workspace-presets' || value.version !== 1) {
    throw new Error('This file is not a supported OGraf Studio workspace preset file.');
  }
  const presets = parseCustomPresets(value.presets);
  if (!presets) throw new Error('The workspace file contains invalid or duplicate presets.');
  if (!presets.length) throw new Error('The workspace file contains no saved presets.');
  return presets;
}

export function exportWorkspacePresets(presets: WorkspacePreset[]): object {
  return {
    format: 'ograf-studio-workspace-presets',
    version: 1,
    presets: presets
      .filter((preset) => !preset.builtin)
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        builtin: false,
        snapshot: cloneWorkspaceSnapshot(preset.snapshot),
      })),
  };
}
