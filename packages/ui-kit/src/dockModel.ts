export const DOCK_PANE_IDS = [
  'layers',
  'templates',
  'scene-tree',
  'chat',
  'resources',
  'brand-kit',
  'inspector',
  'modifiers',
  'data',
  'rules',
  'functions',
  'export',
  'playout-controls',
  'history',
  'board',
  'review',
  'timeline',
  'plugins',
  'transitions',
] as const;

export type DockPaneId = (typeof DOCK_PANE_IDS)[number];
export const DEFAULT_RULES_UNDOCKED_WIDTH = 800;
export const DEFAULT_PLUGINS_UNDOCKED_WIDTH = 900;
export const DEFAULT_TRANSITION_LOGIC_UNDOCKED_WIDTH = 980;
export const DEFAULT_TRANSITION_LOGIC_FLOATING_WIDTH = 900;

/** Transitions opens wide, beside the Timeline. */
function isTransitionPane(pane: DockPaneId): boolean {
  return pane === 'transitions';
}

/** Layouts saved before the Transitions pane replaced Transition Logic show Transitions instead. */
function migratePane(pane: unknown): unknown {
  return pane === 'transition-logic' ? 'transitions' : pane;
}

export function detachedWindowWidth(pane: DockPaneId): number {
  if (pane === 'rules' || pane === 'functions') return DEFAULT_RULES_UNDOCKED_WIDTH;
  if (pane === 'plugins') return DEFAULT_PLUGINS_UNDOCKED_WIDTH;
  if (isTransitionPane(pane)) return DEFAULT_TRANSITION_LOGIC_UNDOCKED_WIDTH;
  if (pane === 'timeline') return 1100;
  if (pane === 'export') return 1000;
  return 480;
}

export function initialFloatingWidth(
  pane: DockPaneId,
  workspaceWidth: number,
  otherPaneWidth: number,
): number {
  return pane === 'rules' || pane === 'functions' || pane === 'plugins' || isTransitionPane(pane)
    ? Math.max(
        240,
        Math.min(
          isTransitionPane(pane)
            ? DEFAULT_TRANSITION_LOGIC_FLOATING_WIDTH
            : pane === 'plugins'
              ? DEFAULT_PLUGINS_UNDOCKED_WIDTH
              : DEFAULT_RULES_UNDOCKED_WIDTH,
          workspaceWidth - 24,
        ),
      )
    : otherPaneWidth;
}

export type DockZone = 'left' | 'right' | 'top' | 'bottom';
export type DockTabInsertSide = 'before' | 'after';

export const DOCK_PANE_LABELS: Record<DockPaneId, string> = {
  layers: 'Layers',
  templates: 'Templates',
  'scene-tree': 'Scene Outliner',
  chat: 'AI Assistant',
  resources: 'Resources',
  'brand-kit': 'Brand Kit',
  inspector: 'Properties',
  modifiers: 'Smart layout',
  data: 'Data',
  rules: 'Rules',
  functions: 'Functions',
  export: 'Preview & Export',
  'playout-controls': 'Playout Controls',
  history: 'History',
  board: 'Board',
  review: 'Review',
  timeline: 'Timeline',
  plugins: 'Plugins',
  transitions: 'Transitions',
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
  /** Groups docked outside the standard regions. Absent in legacy layouts. */
  outerZones?: Record<DockZone, DockGroupState[]>;
  /** Most recent bottom/side outer-edge choice. Missing preserves legacy side priority. */
  outerBottomFullWidth?: boolean;
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
        {
          id: 'left-authoring',
          panes: ['templates', 'layers', 'chat'],
          activePane: 'layers',
          weight: 1,
        },
        { id: 'left-resources', panes: ['resources'], activePane: 'resources', weight: 1 },
      ],
      right: [
        { id: 'right-scene-tree', panes: ['scene-tree'], activePane: 'scene-tree', weight: 1 },
        {
          id: 'right-properties',
          panes: [
            'inspector',
            'modifiers',
            'brand-kit',
            'data',
            'rules',
            'export',
            'playout-controls',
          ],
          activePane: 'inspector',
          weight: 1,
        },
      ],
      top: [],
      bottom: [
        {
          id: 'bottom-timeline',
          panes: ['timeline', 'plugins', 'transitions'],
          activePane: 'timeline',
          weight: 1,
        },
      ],
    },
    floating: [],
    closed: ['functions', 'history', 'board', 'review'],
  };
}

function emptyZones(): Record<DockZone, DockGroupState[]> {
  return { left: [], right: [], top: [], bottom: [] };
}

function cloneZones(zones: Record<DockZone, DockGroupState[]>): Record<DockZone, DockGroupState[]> {
  return Object.fromEntries(
    ZONES.map((zone) => [
      zone,
      (zones[zone] ?? []).map((group) => ({ ...group, panes: [...group.panes] })),
    ]),
  ) as Record<DockZone, DockGroupState[]>;
}

function allGroups(layout: DockLayoutState): DockGroupState[] {
  return ZONES.flatMap((zone) => [...layout.zones[zone], ...(layout.outerZones?.[zone] ?? [])]);
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
    ...(layout.outerZones ? { outerZones: cloneZones(layout.outerZones) } : {}),
    ...(layout.outerBottomFullWidth !== undefined
      ? { outerBottomFullWidth: layout.outerBottomFullWidth }
      : {}),
    floating: layout.floating.map((pane) => ({ ...pane })),
    closed: [...layout.closed],
  };
}

export function findDockGroup(layout: DockLayoutState, pane: DockPaneId): string | null {
  for (const zone of ZONES) {
    const group = [...layout.zones[zone], ...(layout.outerZones?.[zone] ?? [])].find((candidate) =>
      candidate.panes.includes(pane),
    );
    if (group) return group.id;
  }
  return null;
}

function withoutPane(layout: DockLayoutState, pane: DockPaneId): DockLayoutState {
  const next = cloneLayout(layout);
  for (const zone of ZONES) {
    for (const zones of [next.zones, next.outerZones].filter(
      (item): item is Record<DockZone, DockGroupState[]> => !!item,
    )) {
      zones[zone] = zones[zone]
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
  }
  next.floating = next.floating.filter((candidate) => candidate.pane !== pane);
  next.closed = next.closed.filter((candidate) => candidate !== pane);
  return next;
}

function uniqueGroupId(layout: DockLayoutState, pane: DockPaneId, zone: DockZone): string {
  const ids = new Set(allGroups(layout).map((group) => group.id));
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
  if (zone === 'bottom' || (zone === 'right' && pane === 'scene-tree'))
    next.zones[zone].unshift(group);
  else next.zones[zone].push(group);
  return next;
}

/** Dock a pane at the outer workspace edge, beyond the standard dock regions. */
export function dockPaneToOuterZone(
  layout: DockLayoutState,
  pane: DockPaneId,
  zone: DockZone,
): DockLayoutState {
  const next = withoutPane(layout, pane);
  if (zone === 'bottom') next.outerBottomFullWidth = true;
  else if (zone === 'left' || zone === 'right') next.outerBottomFullWidth = false;
  next.outerZones ??= emptyZones();
  const groups = next.outerZones[zone];
  const weight = groups.length
    ? groups.reduce((sum, group) => sum + group.weight, 0) / groups.length
    : 1;
  groups.push({
    id: uniqueGroupId(next, pane, zone),
    panes: [pane],
    activePane: pane,
    weight,
  });
  return next;
}

/** Insert a separate group immediately before or after a group in its region. */
export function dockPaneAdjacentToGroup(
  layout: DockLayoutState,
  pane: DockPaneId,
  targetGroupId: string,
  side: DockTabInsertSide,
): DockLayoutState {
  const target = allGroups(layout).find((group) => group.id === targetGroupId);
  if (!target || (target.panes.length === 1 && target.panes[0] === pane)) return layout;
  const next = withoutPane(layout, pane);
  for (const zone of ZONES) {
    for (const zones of [next.zones, next.outerZones]) {
      if (!zones) continue;
      const index = zones[zone].findIndex((group) => group.id === targetGroupId);
      if (index < 0) continue;
      // Preserve the surrounding groups' proportions while sharing the target's space.
      const targetGroup = zones[zone][index]!;
      const splitWeight = targetGroup.weight / 2;
      targetGroup.weight = splitWeight;
      zones[zone].splice(index + (side === 'after' ? 1 : 0), 0, {
        id: uniqueGroupId(next, pane, zone),
        panes: [pane],
        activePane: pane,
        weight: splitWeight,
      });
      return next;
    }
  }
  return layout;
}

export function dockPaneToGroup(
  layout: DockLayoutState,
  pane: DockPaneId,
  targetGroupId: string,
): DockLayoutState {
  if (findDockGroup(layout, pane) === targetGroupId) return layout;
  const next = withoutPane(layout, pane);
  for (const zone of ZONES) {
    const group = [...next.zones[zone], ...(next.outerZones?.[zone] ?? [])].find(
      (candidate) => candidate.id === targetGroupId,
    );
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
    const group = [...next.zones[zone], ...(next.outerZones?.[zone] ?? [])].find(
      (candidate) => candidate.id === targetGroupId,
    );
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
    width:
      position.width ??
      (isTransitionPane(pane)
        ? DEFAULT_TRANSITION_LOGIC_FLOATING_WIDTH
        : pane === 'plugins'
          ? DEFAULT_PLUGINS_UNDOCKED_WIDTH
          : 360),
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
    const group = [...next.zones[zone], ...(next.outerZones?.[zone] ?? [])].find(
      (candidate) => candidate.id === groupId,
    );
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

export function resizeOuterDockGroups(
  layout: DockLayoutState,
  zone: DockZone,
  weights: Record<string, number>,
): DockLayoutState {
  const next = cloneLayout(layout);
  for (const group of next.outerZones?.[zone] ?? []) {
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

export function reopenDockPane(
  layout: DockLayoutState,
  pane: DockPaneId,
  position: Partial<Omit<FloatingPaneState, 'pane'>> = {},
): DockLayoutState {
  if (!layout.closed.includes(pane)) return layout;
  if (
    pane === 'plugins' ||
    pane === 'modifiers' ||
    pane === 'functions' ||
    pane === 'playout-controls' ||
    pane === 'history' ||
    isTransitionPane(pane)
  )
    return revealDockPane(layout, pane);
  return floatDockPane(layout, pane, position);
}

/** Reveal a review pane without creating a floating window. */
export function revealDockPane(layout: DockLayoutState, pane: DockPaneId): DockLayoutState {
  const groupId = findDockGroup(layout, pane);
  if (groupId) return activateDockPane(layout, groupId, pane);
  if (layout.floating.some((item) => item.pane === pane)) return layout;
  if (pane === 'modifiers') {
    const propertiesGroup = findDockGroup(layout, 'inspector');
    return propertiesGroup
      ? dockPaneAdjacentToTab(layout, pane, propertiesGroup, 'inspector', 'after')
      : dockPaneToZone(layout, pane, 'right');
  }
  if (pane === 'scene-tree') return dockPaneToZone(layout, pane, 'right');
  if (pane === 'functions') {
    const rulesGroup = findDockGroup(layout, 'rules');
    return rulesGroup
      ? dockPaneAdjacentToTab(layout, pane, rulesGroup, 'rules', 'after')
      : dockPaneToZone(layout, pane, 'right');
  }
  if (pane === 'playout-controls') {
    const previewGroup = findDockGroup(layout, 'export');
    return previewGroup
      ? dockPaneAdjacentToTab(layout, pane, previewGroup, 'export', 'after')
      : dockPaneToZone(layout, pane, 'right');
  }
  if (pane === 'history') {
    const timelineGroup = findDockGroup(layout, 'timeline');
    return timelineGroup
      ? dockPaneAdjacentToTab(layout, pane, timelineGroup, 'timeline', 'after')
      : dockPaneToZone(layout, pane, 'bottom');
  }
  if (pane === 'plugins' || isTransitionPane(pane)) {
    const timelineGroup = findDockGroup(layout, 'timeline');
    if (timelineGroup) {
      const neighbors: DockPaneId[] = pane === 'transitions' ? ['plugins'] : [];
      const afterPane =
        neighbors.find((neighbor) => findDockGroup(layout, neighbor) === timelineGroup) ??
        'timeline';
      return dockPaneAdjacentToTab(layout, pane, timelineGroup, afterPane, 'after');
    }
    const pluginsGroup = isTransitionPane(pane) ? findDockGroup(layout, 'plugins') : null;
    return pluginsGroup
      ? dockPaneAdjacentToTab(layout, pane, pluginsGroup, 'plugins', 'after')
      : dockPaneToZone(layout, pane, 'bottom');
  }
  const targetGroup = layout.zones.left[0];
  return targetGroup
    ? dockPaneToGroup(layout, pane, targetGroup.id)
    : dockPaneToZone(layout, pane, 'left');
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
  const outerZones = candidate.outerZones ? emptyZones() : undefined;
  for (const [source, destination, prefix] of [
    [candidate.zones, zones, ''],
    ...(outerZones ? [[candidate.outerZones, outerZones, 'outer-'] as const] : []),
  ] as const) {
    for (const zone of ZONES) {
      const rawGroups = source?.[zone];
      if (!Array.isArray(rawGroups)) {
        if (!prefix) return createDefaultDockLayout();
        continue;
      }
      for (const [index, rawGroup] of rawGroups.entries()) {
        if (!rawGroup || typeof rawGroup !== 'object') continue;
        const panes = Array.isArray(rawGroup.panes)
          ? rawGroup.panes.map(migratePane).filter((pane): pane is DockPaneId => {
              if (!isDockPaneId(pane) || seen.has(pane)) return false;
              seen.add(pane);
              return true;
            })
          : [];
        if (panes.length === 0) continue;
        destination[zone].push({
          id:
            typeof rawGroup.id === 'string' && rawGroup.id
              ? rawGroup.id
              : `${prefix}${zone}-restored-${index}`,
          panes,
          activePane: (() => {
            const active = migratePane(rawGroup.activePane);
            return isDockPaneId(active) && panes.includes(active) ? active : panes[0]!;
          })(),
          weight:
            Number.isFinite(rawGroup.weight) && Number(rawGroup.weight) > 0
              ? Number(rawGroup.weight)
              : 1,
        });
      }
    }
  }

  const floating: FloatingPaneState[] = [];
  for (const rawEntry of candidate.floating) {
    const rawPane =
      rawEntry && typeof rawEntry === 'object'
        ? { ...rawEntry, pane: migratePane(rawEntry.pane) }
        : rawEntry;
    if (!rawPane || typeof rawPane !== 'object' || !isDockPaneId(rawPane.pane)) continue;
    if (seen.has(rawPane.pane)) continue;
    seen.add(rawPane.pane);
    floating.push({
      pane: rawPane.pane,
      x: Number.isFinite(rawPane.x) ? Math.max(0, Number(rawPane.x)) : 160,
      y: Number.isFinite(rawPane.y) ? Math.max(0, Number(rawPane.y)) : 100,
      width: Number.isFinite(rawPane.width)
        ? Math.max(240, Number(rawPane.width))
        : isTransitionPane(rawPane.pane)
          ? DEFAULT_TRANSITION_LOGIC_FLOATING_WIDTH
          : rawPane.pane === 'plugins'
            ? DEFAULT_PLUGINS_UNDOCKED_WIDTH
            : rawPane.pane === 'functions'
              ? DEFAULT_RULES_UNDOCKED_WIDTH
              : 360,
      height: Number.isFinite(rawPane.height) ? Math.max(160, Number(rawPane.height)) : 440,
    });
  }

  const closed: DockPaneId[] = [];
  if (Array.isArray(candidate.closed)) {
    for (const rawClosed of candidate.closed) {
      const pane = migratePane(rawClosed);
      if (!isDockPaneId(pane) || seen.has(pane)) continue;
      seen.add(pane);
      closed.push(pane);
    }
  }

  const defaults = createDefaultDockLayout();
  for (const pane of DOCK_PANE_IDS) {
    if (seen.has(pane)) continue;
    if (
      pane === 'playout-controls' ||
      pane === 'functions' ||
      pane === 'history' ||
      pane === 'board' ||
      pane === 'review'
    ) {
      // Keep existing workspace arrangements intact until the operator opens the new pane.
      closed.push(pane);
      seen.add(pane);
      continue;
    }
    if (pane === 'modifiers') {
      const propertiesGroup = ZONES.flatMap((zone) => [
        ...zones[zone],
        ...(outerZones?.[zone] ?? []),
      ]).find((group) => group.panes.includes('inspector'));
      if (propertiesGroup) {
        propertiesGroup.panes.splice(propertiesGroup.panes.indexOf('inspector') + 1, 0, pane);
        seen.add(pane);
        continue;
      }
    }
    if (pane === 'scene-tree') {
      const id = uniqueGroupId(
        { version: 1, zones, ...(outerZones ? { outerZones } : {}), floating, closed },
        pane,
        'right',
      );
      zones.right.unshift({ id, panes: [pane], activePane: pane, weight: 1 });
      seen.add(pane);
      continue;
    }
    if (pane === 'plugins') {
      // Add the new pane beside the user's actual Timeline, not the original default group.
      // Its tab remains inactive; existing tab selection, weights, floating/closed panes survive.
      const timelineGroup = ZONES.flatMap((zone) => [
        ...zones[zone],
        ...(outerZones?.[zone] ?? []),
      ]).find((group) => group.panes.includes('timeline'));
      if (timelineGroup) {
        timelineGroup.panes.splice(timelineGroup.panes.indexOf('timeline') + 1, 0, 'plugins');
        seen.add(pane);
        continue;
      }
      // Floating/closed Timeline stays where it is; never auto-open another floating window.
    }
    if (isTransitionPane(pane)) {
      // Extend the user's existing playback group without activating it or moving other panes.
      const groups = ZONES.flatMap((zone) => [...zones[zone], ...(outerZones?.[zone] ?? [])]);
      const target =
        groups.find((group) => group.panes.includes('timeline')) ??
        groups.find((group) => group.panes.includes('plugins'));
      if (target) {
        const afterPane = target.panes.includes('plugins') ? 'plugins' : 'timeline';
        target.panes.splice(target.panes.indexOf(afterPane) + 1, 0, pane);
        seen.add(pane);
        continue;
      }
    }
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

  return {
    version: 1,
    zones,
    ...(outerZones ? { outerZones } : {}),
    ...(typeof candidate.outerBottomFullWidth === 'boolean'
      ? { outerBottomFullWidth: candidate.outerBottomFullWidth }
      : {}),
    floating,
    closed,
  };
}
