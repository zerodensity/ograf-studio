import { describe, expect, it } from 'vitest';
import {
  activateDockPane,
  closeDockPane,
  createDefaultDockLayout,
  DEFAULT_RULES_UNDOCKED_WIDTH,
  DEFAULT_PLUGINS_UNDOCKED_WIDTH,
  DOCK_PANE_IDS,
  detachedWindowWidth,
  DOCK_PANE_LABELS,
  dockPaneAdjacentToTab,
  dockPaneToGroup,
  dockPaneToZone,
  dockZoneNearFloatingRect,
  dockZoneNearPointer,
  findDockGroup,
  floatDockPane,
  initialFloatingWidth,
  moveFloatingDockPane,
  parseDockLayout,
  reopenDockPane,
  revealDockPane,
  resizeDockGroups,
} from './dockModel';

describe('dock layout model', () => {
  it('starts undocked Rules at 800px when space allows without replacing saved widths', () => {
    expect(DEFAULT_RULES_UNDOCKED_WIDTH).toBe(800);
    expect(detachedWindowWidth('rules')).toBe(800);
    expect(detachedWindowWidth('layers')).toBe(480);
    expect(initialFloatingWidth('rules', 1600, 360)).toBe(800);
    expect(initialFloatingWidth('rules', 700, 360)).toBe(676);
    expect(initialFloatingWidth('layers', 1600, 360)).toBe(360);

    const saved = floatDockPane(createDefaultDockLayout(), 'rules', { width: 700 });
    expect(parseDockLayout(saved).floating[0]?.width).toBe(700);
  });
  it('reveals AI review in its dock group and reopens a closed pane without floating it', () => {
    const initial = createDefaultDockLayout();
    const revealed = revealDockPane(initial, 'chat');
    expect(revealed.zones.left[0]?.activePane).toBe('chat');
    expect(revealed.floating).toHaveLength(0);
    const reopened = revealDockPane(closeDockPane(initial, 'chat'), 'chat');
    expect(reopened.closed).not.toContain('chat');
    expect(reopened.zones.left[0]?.activePane).toBe('chat');
    expect(reopened.floating).toHaveLength(0);
  });
  it('starts with the existing editor arrangement', () => {
    const layout = createDefaultDockLayout();
    expect(layout.zones.left.map((group) => group.panes)).toEqual([
      ['templates', 'layers', 'chat'],
      ['resources'],
    ]);
    expect(layout.zones.right[1]?.panes).toEqual([
      'inspector',
      'modifiers',
      'brand-kit',
      'data',
      'rules',
      'export',
      'playout-controls',
    ]);
    expect(layout.zones.right[0]?.panes).toEqual(['scene-tree']);
    expect(DOCK_PANE_LABELS.templates).toBe('Templates');
    expect(DOCK_PANE_LABELS['scene-tree']).toBe('Scene Outliner');
    expect(layout.zones.bottom[0]?.panes).toEqual(['timeline', 'plugins', 'transitions']);
    expect(DOCK_PANE_LABELS.plugins).toBe('Plugins');
    expect(DOCK_PANE_LABELS.inspector).toBe('Properties');
  });

  it('keeps History closed in new and legacy workspaces, then docks it beside Timeline', () => {
    const initial = createDefaultDockLayout();
    expect(initial.closed).toContain('history');
    const legacy = { ...initial, closed: initial.closed.filter((pane) => pane !== 'history') };
    const restored = parseDockLayout(legacy);
    expect(restored.closed).toContain('history');
    const opened = reopenDockPane(restored, 'history');
    expect(findDockGroup(opened, 'history')).toBe(findDockGroup(opened, 'timeline'));
    expect(opened.closed).not.toContain('history');
    expect(opened.floating).toHaveLength(0);
  });

  it('moves panes between edge zones without duplicating them', () => {
    const moved = dockPaneToZone(createDefaultDockLayout(), 'resources', 'right');
    expect(findDockGroup(moved, 'resources')).toBe('right-resources');
    expect(moved.zones.left.flatMap((group) => group.panes)).not.toContain('resources');
  });

  it('adds Scene Outliner as its own pane when migrating a saved layout and respects saved pane visibility', () => {
    const legacy = createDefaultDockLayout();
    legacy.zones.right.shift();
    legacy.zones.right[0]!.activePane = 'data';
    legacy.zones.right[0]!.weight = 3;
    const restored = parseDockLayout(legacy);
    expect(restored.zones.right[0]).toMatchObject({
      panes: ['scene-tree'],
      activePane: 'scene-tree',
    });
    expect(restored.zones.right[1]).toMatchObject({ activePane: 'data', weight: 3 });
    const closed = closeDockPane(restored, 'scene-tree');
    expect(parseDockLayout(closed).closed).toContain('scene-tree');
    const floating = floatDockPane(restored, 'scene-tree', { width: 420 });
    expect(parseDockLayout(floating).floating).toContainEqual(
      expect.objectContaining({ pane: 'scene-tree', width: 420 }),
    );
    expect(findDockGroup(revealDockPane(closed, 'scene-tree'), 'scene-tree')).toBe(
      'right-scene-tree',
    );
    expect(revealDockPane(closed, 'scene-tree').zones.right[0]?.panes).toEqual(['scene-tree']);
  });

  it('stacks a newly bottom-docked pane above the existing bottom pane', () => {
    const moved = dockPaneToZone(createDefaultDockLayout(), 'resources', 'bottom');
    expect(moved.zones.bottom.map((group) => group.panes)).toEqual([
      ['resources'],
      ['timeline', 'plugins', 'transitions'],
    ]);
  });

  it('merges panes into a tab group and activates the dropped pane', () => {
    const moved = dockPaneToGroup(createDefaultDockLayout(), 'timeline', 'right-properties');
    expect(moved.zones.right[1]?.panes).toEqual([
      'inspector',
      'modifiers',
      'brand-kit',
      'data',
      'rules',
      'export',
      'playout-controls',
      'timeline',
    ]);
    expect(moved.zones.right[1]?.activePane).toBe('timeline');
    expect(moved.zones.bottom.map((group) => group.panes)).toEqual([['plugins', 'transitions']]);
  });

  it('reorders tabs before or after a hovered tab in the same group', () => {
    const layout = createDefaultDockLayout();
    const before = dockPaneAdjacentToTab(
      layout,
      'export',
      'right-properties',
      'inspector',
      'before',
    );
    expect(before.zones.right[1]?.panes).toEqual([
      'export',
      'inspector',
      'modifiers',
      'brand-kit',
      'data',
      'rules',
      'playout-controls',
    ]);
    expect(before.zones.right[1]?.activePane).toBe('export');

    const after = dockPaneAdjacentToTab(before, 'export', 'right-properties', 'data', 'after');
    expect(after.zones.right[1]?.panes).toEqual([
      'inspector',
      'modifiers',
      'brand-kit',
      'data',
      'export',
      'rules',
      'playout-controls',
    ]);
  });

  it('inserts a pane from another dock group at the requested tab position', () => {
    const moved = dockPaneAdjacentToTab(
      createDefaultDockLayout(),
      'timeline',
      'right-properties',
      'data',
      'before',
    );
    expect(moved.zones.right[1]?.panes).toEqual([
      'inspector',
      'modifiers',
      'brand-kit',
      'timeline',
      'data',
      'rules',
      'export',
      'playout-controls',
    ]);
    expect(moved.zones.bottom.map((group) => group.panes)).toEqual([['plugins', 'transitions']]);
  });

  it('floats and repositions a pane', () => {
    const floated = floatDockPane(createDefaultDockLayout(), 'inspector', { x: 40, y: 60 });
    expect(findDockGroup(floated, 'inspector')).toBeNull();
    expect(floated.floating[0]).toMatchObject({ pane: 'inspector', x: 40, y: 60 });
    expect(moveFloatingDockPane(floated, 'inspector', 90.4, 120.6).floating[0]).toMatchObject({
      x: 90,
      y: 121,
    });
  });

  it('activates tabs without moving panes', () => {
    const activated = activateDockPane(createDefaultDockLayout(), 'right-properties', 'data');
    expect(activated.zones.right[1]?.activePane).toBe('data');
  });

  it('persists proportional weights for adjacent dock groups', () => {
    const resized = resizeDockGroups(createDefaultDockLayout(), 'left', {
      'left-authoring': 320,
      'left-resources': 120,
    });
    expect(resized.zones.left.map((group) => group.weight)).toEqual([320, 120]);
    expect(parseDockLayout(resized).zones.left.map((group) => group.weight)).toEqual([320, 120]);
  });

  it('closes panes without repair reopening them and reopens them as floating windows', () => {
    const closed = closeDockPane(createDefaultDockLayout(), 'inspector');
    expect(closed.closed).toEqual([...createDefaultDockLayout().closed, 'inspector']);
    expect(findDockGroup(closed, 'inspector')).toBeNull();

    const restored = parseDockLayout(closed);
    expect(restored.closed).toEqual([...createDefaultDockLayout().closed, 'inspector']);
    expect(findDockGroup(restored, 'inspector')).toBeNull();

    const reopened = reopenDockPane(restored, 'inspector', {
      x: 220,
      y: 140,
      width: 420,
      height: 360,
    });
    expect(reopened.closed).toEqual(createDefaultDockLayout().closed);
    expect(findDockGroup(reopened, 'inspector')).toBeNull();
    expect(reopened.floating).toContainEqual({
      pane: 'inspector',
      x: 220,
      y: 140,
      width: 420,
      height: 360,
    });
  });

  it('repairs incomplete persisted layouts with every missing pane exactly once', () => {
    const restored = parseDockLayout({
      version: 1,
      zones: {
        left: [{ id: 'custom', panes: ['layers', 'layers', 'unknown'], activePane: 'unknown' }],
        right: [],
        top: [],
        bottom: [],
      },
      floating: [],
    });
    const panes = [
      ...Object.values(restored.zones).flatMap((groups) => groups.flatMap((group) => group.panes)),
      ...restored.floating.map((pane) => pane.pane),
      ...restored.closed,
    ];
    expect(new Set(panes).size).toBe(DOCK_PANE_IDS.length);
    expect(panes).toHaveLength(DOCK_PANE_IDS.length);
    expect(restored.zones.left[0]?.activePane).toBe('layers');
  });

  it('detects Visual Studio-style edge proximity without claiming the workspace centre', () => {
    const bounds = { left: 100, top: 50, right: 1100, bottom: 750 };
    expect(dockZoneNearPointer(120, 400, bounds)).toBe('left');
    expect(dockZoneNearPointer(1080, 400, bounds)).toBe('right');
    expect(dockZoneNearPointer(600, 70, bounds)).toBe('top');
    expect(dockZoneNearPointer(600, 730, bounds)).toBe('bottom');
    expect(dockZoneNearPointer(600, 400, bounds)).toBeNull();
  });

  it('uses the nearest edge at corners and respects the docking threshold', () => {
    const bounds = { left: 0, top: 0, right: 1000, bottom: 700 };
    expect(dockZoneNearPointer(18, 30, bounds)).toBe('left');
    expect(dockZoneNearPointer(35, 12, bounds)).toBe('top');
    expect(dockZoneNearPointer(120, 350, bounds)).toBe('left');
    expect(dockZoneNearPointer(140, 350, bounds)).toBeNull();
    expect(dockZoneNearPointer(-20, 350, bounds)).toBe('left');
    expect(dockZoneNearPointer(-140, 350, bounds)).toBeNull();
  });

  it('shows docking proximity when the floating window edge approaches the workspace', () => {
    const bounds = { left: 100, top: 50, right: 1100, bottom: 750 };
    expect(dockZoneNearFloatingRect({ left: 115, top: 200, right: 475, bottom: 600 }, bounds)).toBe(
      'left',
    );
    expect(
      dockZoneNearFloatingRect({ left: 700, top: 300, right: 1082, bottom: 700 }, bounds),
    ).toBe('right');
    expect(dockZoneNearFloatingRect({ left: 300, top: 240, right: 700, bottom: 720 }, bounds)).toBe(
      'bottom',
    );
    expect(
      dockZoneNearFloatingRect({ left: 300, top: 200, right: 700, bottom: 600 }, bounds),
    ).toBeNull();
  });
});

describe('Plugins dock pane placement', () => {
  function legacyWithoutPlugins(layout = createDefaultDockLayout()) {
    const legacy = structuredClone(layout);
    for (const groups of Object.values(legacy.zones))
      for (const group of groups) {
        group.panes = group.panes.filter((pane) => pane !== 'plugins');
        if (!group.panes.includes(group.activePane)) group.activePane = group.panes[0]!;
      }
    for (const zone of ['left', 'right', 'top', 'bottom'] as const)
      legacy.zones[zone] = legacy.zones[zone].filter((group) => group.panes.length > 0);
    legacy.floating = legacy.floating.filter((pane) => pane.pane !== 'plugins');
    legacy.closed = legacy.closed.filter((pane) => pane !== 'plugins');
    return legacy;
  }

  it('repairs a legacy saved layout next to the actual moved Timeline, without resetting selection or weights', () => {
    const moved = dockPaneAdjacentToTab(
      createDefaultDockLayout(),
      'timeline',
      'right-properties',
      'data',
      'before',
    );
    moved.zones.right[1]!.activePane = 'rules';
    moved.zones.right[1]!.id = 'custom-authoring';
    moved.zones.right[1]!.weight = 3.75;
    const legacy = legacyWithoutPlugins(moved);
    const before = structuredClone(legacy);
    const restored = parseDockLayout(legacy);
    expect(restored.zones.right[1]).toMatchObject({
      id: 'custom-authoring',
      activePane: 'rules',
      weight: 3.75,
      panes: [
        'inspector',
        'modifiers',
        'brand-kit',
        'timeline',
        'plugins',
        'data',
        'rules',
        'export',
        'playout-controls',
      ],
    });
    expect(restored.zones.left).toEqual(before.zones.left);
    expect(restored.zones.bottom).toEqual(before.zones.bottom);
    expect(legacy).toEqual(before);
  });

  it('leaves explicitly closed and separately floating Plugins placements unchanged on load', () => {
    const closed = closeDockPane(createDefaultDockLayout(), 'plugins');
    expect(parseDockLayout(closed)).toEqual(closed);
    const floating = floatDockPane(createDefaultDockLayout(), 'plugins', {
      x: 61,
      y: 93,
      width: 740,
      height: 330,
    });
    expect(parseDockLayout(floating)).toEqual(floating);
    expect(revealDockPane(floating, 'plugins')).toBe(floating);
  });

  it('restores closed Plugins immediately after Timeline when revealed or reopened from Window', () => {
    const moved = dockPaneAdjacentToTab(
      createDefaultDockLayout(),
      'timeline',
      'right-properties',
      'brand-kit',
      'before',
    );
    const closed = closeDockPane(moved, 'plugins');
    const before = structuredClone(closed);
    for (const restored of [revealDockPane(closed, 'plugins'), reopenDockPane(closed, 'plugins')]) {
      expect(restored.zones.right[1]?.panes).toEqual([
        'inspector',
        'modifiers',
        'timeline',
        'plugins',
        'brand-kit',
        'data',
        'rules',
        'export',
        'playout-controls',
      ]);
      expect(restored.zones.right[1]?.activePane).toBe('plugins');
      expect(restored.closed).not.toContain('plugins');
      expect(restored.floating).toEqual([]);
      expect(restored.zones.left).toEqual(before.zones.left);
    }
    expect(closed).toEqual(before);
  });

  it('uses bottom dock fallback without reopening a closed Timeline or moving a floating Timeline', () => {
    for (const layout of [
      closeDockPane(createDefaultDockLayout(), 'timeline'),
      floatDockPane(createDefaultDockLayout(), 'timeline', {
        x: 70,
        y: 50,
        width: 1050,
        height: 400,
      }),
    ]) {
      const legacy = legacyWithoutPlugins(layout);
      const restored = parseDockLayout(legacy);
      expect(restored.zones.bottom.flatMap((group) => group.panes)).toEqual([
        'transitions',
        'plugins',
      ]);
      expect(restored.floating).toEqual(legacy.floating);
      expect(restored.closed).toEqual(legacy.closed);
      const revealed = revealDockPane(closeDockPane(restored, 'plugins'), 'plugins');
      expect(revealed.zones.bottom.flatMap((group) => group.panes)).toEqual([
        'plugins',
        'transitions',
      ]);
      expect(revealed.floating).toEqual(legacy.floating);
      expect(revealed.closed).toEqual(legacy.closed);
    }
  });

  it('activates an existing moved Plugins group without relocating it beside Timeline', () => {
    const moved = dockPaneToGroup(createDefaultDockLayout(), 'plugins', 'left-authoring');
    const inactive = activateDockPane(moved, 'left-authoring', 'layers');
    const revealed = revealDockPane(inactive, 'plugins');
    expect(revealed.zones.left[0]?.activePane).toBe('plugins');
    expect(findDockGroup(revealed, 'plugins')).toBe('left-authoring');
    expect(revealed.zones.bottom[0]?.panes).toEqual(['timeline', 'transitions']);
  });

  it('starts explicitly floated/detached Plugins at 900px, preserving saved sizes', () => {
    expect(DEFAULT_PLUGINS_UNDOCKED_WIDTH).toBe(900);
    expect(detachedWindowWidth('plugins')).toBe(900);
    expect(initialFloatingWidth('plugins', 1600, 360)).toBe(900);
    expect(initialFloatingWidth('plugins', 700, 360)).toBe(676);
    expect(floatDockPane(createDefaultDockLayout(), 'plugins').floating[0]?.width).toBe(900);
    const custom = floatDockPane(createDefaultDockLayout(), 'plugins', { width: 720 });
    expect(parseDockLayout(custom).floating[0]?.width).toBe(720);
    expect(parseDockLayout({ ...custom, floating: [{ pane: 'plugins' }] }).floating[0]?.width).toBe(
      900,
    );
  });
});

describe('Transitions replaces Transition Logic', () => {
  it('moves a saved Transition Logic tab, floating window or closed pane to Transitions', () => {
    const legacy = createDefaultDockLayout() as unknown as {
      zones: { bottom: Array<{ panes: string[]; activePane: string }> };
    };
    legacy.zones.bottom[0]!.panes = ['timeline', 'plugins', 'transition-logic'];
    legacy.zones.bottom[0]!.activePane = 'transition-logic';
    const restored = parseDockLayout(legacy);
    expect(restored.zones.bottom[0]?.panes).toEqual(['timeline', 'plugins', 'transitions']);
    expect(restored.zones.bottom[0]?.activePane).toBe('transitions');
    const closed = parseDockLayout({
      ...createDefaultDockLayout(),
      zones: { ...createDefaultDockLayout().zones, bottom: [] },
      closed: ['transition-logic'],
    });
    expect(closed.closed).toContain('transitions');
  });
});
