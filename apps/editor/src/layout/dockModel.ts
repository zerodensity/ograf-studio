export const DOCK_PANE_IDS = [
  'layers',
  'chat',
  'resources',
  'inspector',
  'data',
  'export',
  'timeline',
] as const;

export type DockPaneId = (typeof DOCK_PANE_IDS)[number];
export type DockZone = 'left' | 'right' | 'top' | 'bottom';
export type DockTabInsertSide = 'before' | 'after';

export const DOCK_PANE_LABELS: Record<DockPaneId, string> = {
  layers: 'Layers',
  chat: 'Chat',
  resources: 'Resources',
  inspector: 'Inspector',
  data: 'Data',
  export: 'Preview & Export',
  timeline: 'Timeline',
};

export interface DockGroupState {
  id: string;
  panes: DockPaneId[];
  activePane: DockPaneId;
  weight: number;
}

export interface FloatingPaneState {
  pane: DockPaneId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockLayoutState {
  version: 1;
  zones: Record<DockZone, DockGroupState[]>;
  floating: FloatingPaneState[];
  closed: DockPaneId[];
}

export interface DockProximityBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DockFloatingRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const VALID_PANES = new Set<string>(DOCK_PANE_IDS);
const ZONES: DockZone[] = ['left', 'right', 'top', 'bottom'];

export function createDefaultDockLayout(): DockLayoutState {
  return {
    version: 1,
    zones: {
      left: [
        { id: 'left-authoring', panes: ['layers', 'chat'], activePane: 'layers', weight: 1 },
        { id: 'left-resources', panes: ['resources'], activePane: 'resources', weight: 1 },
      ],
      right: [
        {
          id: 'right-properties',
          panes: ['inspector', 'data', 'export'],
          activePane: 'inspector',
          weight: 1,
        },
      ],
      top: [],
      bottom: [{ id: 'bottom-timeline', panes: ['timeline'], activePane: 'timeline', weight: 1 }],
    },
    floating: [],
    closed: [],
  };
}

function cloneLayout(layout: DockLayoutState): DockLayoutState {
  return {
    version: 1,
    zones: {
      left: layout.zones.left.map((group) => ({ ...group, panes: [...group.panes] })),
      right: layout.zones.right.map((group) => ({ ...group, panes: [...group.panes] })),
      top: layout.zones.top.map((group) => ({ ...group, panes: [...group.panes] })),
      bottom: layout.zones.bottom.map((group) => ({ ...group, panes: [...group.panes] })),
    },
    floating: layout.floating.map((pane) => ({ ...pane })),
    closed: [...layout.closed],
  };
}

export function findDockGroup(layout: DockLayoutState, pane: DockPaneId): string | null {
  for (const zone of ZONES) {
    const group = layout.zones[zone].find((candidate) => candidate.panes.includes(pane));
    if (group) return group.id;
  }
  return null;
}

function withoutPane(layout: DockLayoutState, pane: DockPaneId): DockLayoutState {
  const next = cloneLayout(layout);
  for (const zone of ZONES) {
    next.zones[zone] = next.zones[zone]
      .map((group) => {
        const panes = group.panes.filter((candidate) => candidate !== pane);
        return {
          ...group,
          panes,
          activePane: panes.includes(group.activePane) ? group.activePane : panes[0]!,
        };
      })
      .filter((group) => group.panes.length > 0);
  }
  next.floating = next.floating.filter((candidate) => candidate.pane !== pane);
  next.closed = next.closed.filter((candidate) => candidate !== pane);
  return next;
}

function uniqueGroupId(layout: DockLayoutState, pane: DockPaneId, zone: DockZone): string {
  const ids = new Set(
    ZONES.flatMap((candidate) => layout.zones[candidate].map((group) => group.id)),
  );
  const base = `${zone}-${pane}`;
  let id = base;
  let suffix = 2;
  while (ids.has(id)) id = `${base}-${suffix++}`;
  return id;
}

export function dockPaneToZone(
  layout: DockLayoutState,
  pane: DockPaneId,
  zone: DockZone,
): DockLayoutState {
  const next = withoutPane(layout, pane);
  const group = {
    id: uniqueGroupId(next, pane, zone),
    panes: [pane],
    activePane: pane,
    weight: 1,
  };
  if (zone === 'bottom') next.zones.bottom.unshift(group);
  else next.zones[zone].push(group);
  return next;
}

export function dockPaneToGroup(
  layout: DockLayoutState,
  pane: DockPaneId,
  targetGroupId: string,
): DockLayoutState {
  if (findDockGroup(layout, pane) === targetGroupId) return layout;
  const next = withoutPane(layout, pane);
  for (const zone of ZONES) {
    const group = next.zones[zone].find((candidate) => candidate.id === targetGroupId);
    if (!group) continue;
    group.panes.push(pane);
    group.activePane = pane;
    return next;
  }
  return layout;
}

export function dockPaneAdjacentToTab(
  layout: DockLayoutState,
  pane: DockPaneId,
  targetGroupId: string,
  targetPane: DockPaneId,
  side: DockTabInsertSide,
): DockLayoutState {
  if (pane === targetPane) return layout;
  const next = withoutPane(layout, pane);
  for (const zone of ZONES) {
    const group = next.zones[zone].find((candidate) => candidate.id === targetGroupId);
    if (!group) continue;
    const targetIndex = group.panes.indexOf(targetPane);
    if (targetIndex < 0) return layout;
    group.panes.splice(targetIndex + (side === 'after' ? 1 : 0), 0, pane);
    group.activePane = pane;
    return next;
  }
  return layout;
}

export function floatDockPane(
  layout: DockLayoutState,
  pane: DockPaneId,
  position: Partial<Omit<FloatingPaneState, 'pane'>> = {},
): DockLayoutState {
  const next = withoutPane(layout, pane);
  next.floating.push({
    pane,
    x: position.x ?? 160,
    y: position.y ?? 100,
    width: position.width ?? 360,
    height: position.height ?? 440,
  });
  return next;
}

export function activateDockPane(
  layout: DockLayoutState,
  groupId: string,
  pane: DockPaneId,
): DockLayoutState {
  const next = cloneLayout(layout);
  for (const zone of ZONES) {
    const group = next.zones[zone].find((candidate) => candidate.id === groupId);
    if (group?.panes.includes(pane)) group.activePane = pane;
  }
  return next;
}

export function moveFloatingDockPane(
  layout: DockLayoutState,
  pane: DockPaneId,
  x: number,
  y: number,
): DockLayoutState {
  const next = cloneLayout(layout);
  const floating = next.floating.find((candidate) => candidate.pane === pane);
  if (floating) {
    floating.x = Math.round(x);
    floating.y = Math.round(y);
  }
  return next;
}

export function resizeDockGroups(
  layout: DockLayoutState,
  zone: DockZone,
  weights: Record<string, number>,
): DockLayoutState {
  const next = cloneLayout(layout);
  for (const group of next.zones[zone]) {
    const weight = weights[group.id];
    if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
      group.weight = Math.max(1, weight);
    }
  }
  return next;
}

export function closeDockPane(layout: DockLayoutState, pane: DockPaneId): DockLayoutState {
  const next = withoutPane(layout, pane);
  next.closed.push(pane);
  return next;
}

export function reopenDockPane(layout: DockLayoutState, pane: DockPaneId): DockLayoutState {
  if (!layout.closed.includes(pane)) return layout;
  const next = withoutPane(layout, pane);
  const defaults = createDefaultDockLayout();
  for (const zone of ZONES) {
    const defaultGroupIndex = defaults.zones[zone].findIndex((group) => group.panes.includes(pane));
    if (defaultGroupIndex < 0) continue;
    const defaultGroup = defaults.zones[zone][defaultGroupIndex]!;
    const existingGroup = next.zones[zone].find((group) => group.id === defaultGroup.id);
    if (existingGroup) {
      const defaultPaneIndex = defaultGroup.panes.indexOf(pane);
      let insertionIndex = existingGroup.panes.length;
      for (const candidate of existingGroup.panes) {
        if (defaultGroup.panes.indexOf(candidate) > defaultPaneIndex) {
          insertionIndex = existingGroup.panes.indexOf(candidate);
          break;
        }
      }
      existingGroup.panes.splice(insertionIndex, 0, pane);
      existingGroup.activePane = pane;
    } else {
      next.zones[zone].splice(Math.min(defaultGroupIndex, next.zones[zone].length), 0, {
        id: defaultGroup.id,
        panes: [pane],
        activePane: pane,
        weight: defaultGroup.weight,
      });
    }
    return next;
  }
  return layout;
}

export function dockZoneNearPointer(
  clientX: number,
  clientY: number,
  bounds: DockProximityBounds,
  threshold = 132,
): DockZone | null {
  if (
    clientX < bounds.left - threshold ||
    clientX > bounds.right + threshold ||
    clientY < bounds.top - threshold ||
    clientY > bounds.bottom + threshold
  ) {
    return null;
  }
  const candidates: Array<{ zone: DockZone; distance: number }> = [
    { zone: 'left', distance: Math.abs(clientX - bounds.left) },
    { zone: 'right', distance: Math.abs(bounds.right - clientX) },
    { zone: 'top', distance: Math.abs(clientY - bounds.top) },
    { zone: 'bottom', distance: Math.abs(bounds.bottom - clientY) },
  ];
  candidates.sort((first, second) => first.distance - second.distance);
  return candidates[0]!.distance <= threshold ? candidates[0]!.zone : null;
}

export function dockZoneNearFloatingRect(
  rect: DockFloatingRect,
  bounds: DockProximityBounds,
  threshold = 40,
): DockZone | null {
  const candidates: Array<{ zone: DockZone; distance: number }> = [
    { zone: 'left', distance: Math.abs(rect.left - bounds.left) },
    { zone: 'right', distance: Math.abs(bounds.right - rect.right) },
    { zone: 'top', distance: Math.abs(rect.top - bounds.top) },
    { zone: 'bottom', distance: Math.abs(bounds.bottom - rect.bottom) },
  ];
  candidates.sort((first, second) => first.distance - second.distance);
  return candidates[0]!.distance <= threshold ? candidates[0]!.zone : null;
}

function isDockPaneId(value: unknown): value is DockPaneId {
  return typeof value === 'string' && VALID_PANES.has(value);
}

export function parseDockLayout(value: unknown): DockLayoutState {
  if (!value || typeof value !== 'object') return createDefaultDockLayout();
  const candidate = value as Partial<DockLayoutState>;
  if (candidate.version !== 1 || !candidate.zones || !Array.isArray(candidate.floating)) {
    return createDefaultDockLayout();
  }

  const seen = new Set<DockPaneId>();
  const zones = { left: [], right: [], top: [], bottom: [] } as Record<DockZone, DockGroupState[]>;
  for (const zone of ZONES) {
    const rawGroups = candidate.zones[zone];
    if (!Array.isArray(rawGroups)) return createDefaultDockLayout();
    for (const [index, rawGroup] of rawGroups.entries()) {
      if (!rawGroup || typeof rawGroup !== 'object') continue;
      const panes = Array.isArray(rawGroup.panes)
        ? rawGroup.panes.filter((pane): pane is DockPaneId => {
            if (!isDockPaneId(pane) || seen.has(pane)) return false;
            seen.add(pane);
            return true;
          })
        : [];
      if (panes.length === 0) continue;
      zones[zone].push({
        id:
          typeof rawGroup.id === 'string' && rawGroup.id
            ? rawGroup.id
            : `${zone}-restored-${index}`,
        panes,
        activePane:
          isDockPaneId(rawGroup.activePane) && panes.includes(rawGroup.activePane)
            ? rawGroup.activePane
            : panes[0]!,
        weight:
          Number.isFinite(rawGroup.weight) && Number(rawGroup.weight) > 0
            ? Number(rawGroup.weight)
            : 1,
      });
    }
  }

  const floating: FloatingPaneState[] = [];
  for (const rawPane of candidate.floating) {
    if (!rawPane || typeof rawPane !== 'object' || !isDockPaneId(rawPane.pane)) continue;
    if (seen.has(rawPane.pane)) continue;
    seen.add(rawPane.pane);
    floating.push({
      pane: rawPane.pane,
      x: Number.isFinite(rawPane.x) ? Math.max(0, Number(rawPane.x)) : 160,
      y: Number.isFinite(rawPane.y) ? Math.max(0, Number(rawPane.y)) : 100,
      width: Number.isFinite(rawPane.width) ? Math.max(240, Number(rawPane.width)) : 360,
      height: Number.isFinite(rawPane.height) ? Math.max(160, Number(rawPane.height)) : 440,
    });
  }

  const closed: DockPaneId[] = [];
  if (Array.isArray(candidate.closed)) {
    for (const pane of candidate.closed) {
      if (!isDockPaneId(pane) || seen.has(pane)) continue;
      seen.add(pane);
      closed.push(pane);
    }
  }

  const defaults = createDefaultDockLayout();
  for (const pane of DOCK_PANE_IDS) {
    if (seen.has(pane)) continue;
    for (const zone of ZONES) {
      const defaultGroup = defaults.zones[zone].find((group) => group.panes.includes(pane));
      if (!defaultGroup) continue;
      const target = zones[zone].find((group) => group.id === defaultGroup.id);
      if (target) target.panes.push(pane);
      else zones[zone].push({ ...defaultGroup, panes: [pane], activePane: pane, weight: 1 });
      seen.add(pane);
      break;
    }
  }

  return { version: 1, zones, floating, closed };
}
