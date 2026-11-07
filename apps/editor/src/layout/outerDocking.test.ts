import { describe, expect, it } from 'vitest';
import {
  activateDockPane,
  closeDockPane,
  createDefaultDockLayout,
  DOCK_PANE_IDS,
  dockPaneAdjacentToGroup,
  dockPaneAdjacentToTab,
  dockPaneToGroup,
  dockPaneToOuterZone,
  dockPaneToZone,
  findDockGroup,
  floatDockPane,
  parseDockLayout,
  resizeOuterDockGroups,
} from './dockModel';
import {
  DEFAULT_WORKSPACE_SIZES,
  parseWorkspaceSnapshot,
} from '@ograf-editor/ui-kit/workspace-model';

describe('workspace-edge docking', () => {
  it('persists which outer edge most recently claimed the bottom corners', () => {
    let layout = dockPaneToOuterZone(createDefaultDockLayout(), 'resources', 'right');
    expect(layout.outerBottomFullWidth).toBe(false);
    layout = dockPaneToOuterZone(layout, 'plugins', 'bottom');
    expect(layout.outerBottomFullWidth).toBe(true);
    expect(layout.outerZones?.right.flatMap((group) => group.panes)).toContain('resources');
    expect(layout.outerZones?.bottom.flatMap((group) => group.panes)).toContain('plugins');

    const snapshot = { version: 1, layout, sizes: DEFAULT_WORKSPACE_SIZES, detached: {} };
    const restored = parseWorkspaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored?.layout.outerBottomFullWidth).toBe(true);
    expect(parseDockLayout(JSON.parse(JSON.stringify(layout))).outerBottomFullWidth).toBe(true);

    layout = dockPaneToOuterZone(restored!.layout, 'rules', 'right');
    expect(layout.outerBottomFullWidth).toBe(false);
    expect(layout.outerZones?.bottom.flatMap((group) => group.panes)).toContain('plugins');
    expect(parseDockLayout(JSON.parse(JSON.stringify(layout))).outerBottomFullWidth).toBe(false);
  });

  it('retains legacy side-priority when saved workspaces lack the new field', () => {
    const layout = dockPaneToOuterZone(createDefaultDockLayout(), 'plugins', 'bottom');
    delete layout.outerBottomFullWidth;
    expect(parseDockLayout(layout).outerBottomFullWidth).toBeUndefined();
    expect(
      parseDockLayout({ ...layout, outerBottomFullWidth: 'invalid' }).outerBottomFullWidth,
    ).toBeUndefined();
  });

  it('keeps legacy zone layouts unchanged when no outer areas were saved', () => {
    const original = createDefaultDockLayout();
    const legacy = JSON.parse(JSON.stringify(original));
    delete legacy.outerZones;
    const restored = parseDockLayout(legacy);

    expect(restored.zones).toEqual(original.zones);
    expect(restored.floating).toEqual(original.floating);
    expect(restored.closed).toEqual(original.closed);
    expect(Object.values(restored.outerZones ?? {}).flat()).toEqual([]);
  });

  it('moves a pane into the full-height outer edge without moving the existing inner edge', () => {
    const original = createDefaultDockLayout();
    const moved = dockPaneToOuterZone(original, 'resources', 'right');
    expect(moved.outerZones?.right.flatMap((group) => group.panes)).toEqual(['resources']);
    expect(moved.zones.right).toEqual(original.zones.right);
    expect(moved.zones.left.flatMap((group) => group.panes)).not.toContain('resources');
    expect(findDockGroup(moved, 'resources')).toBe(moved.outerZones?.right[0]?.id);

    const inner = dockPaneToZone(moved, 'resources', 'right');
    expect(inner.outerZones?.right.flatMap((group) => group.panes)).not.toContain('resources');
    expect(inner.zones.right.flatMap((group) => group.panes)).toContain('resources');
  });

  it('supports tabs in an outer group and removes panes when floating or closing', () => {
    let layout = dockPaneToOuterZone(createDefaultDockLayout(), 'resources', 'right');
    const groupId = layout.outerZones!.right[0]!.id;
    layout = dockPaneToGroup(layout, 'data', groupId);
    expect(layout.outerZones!.right[0]).toMatchObject({
      panes: ['resources', 'data'],
      activePane: 'data',
    });
    layout = activateDockPane(layout, groupId, 'resources');
    expect(layout.outerZones!.right[0]?.activePane).toBe('resources');
    layout = dockPaneAdjacentToTab(layout, 'data', groupId, 'resources', 'before');
    expect(layout.outerZones!.right[0]?.panes).toEqual(['data', 'resources']);
    layout = floatDockPane(layout, 'resources', { x: 30, y: 40 });
    expect(layout.outerZones!.right[0]?.panes).toEqual(['data']);
    expect(layout.floating).toContainEqual(expect.objectContaining({ pane: 'resources' }));
    layout = closeDockPane(layout, 'data');
    expect(layout.outerZones!.right).toEqual([]);
    expect(layout.closed).toContain('data');
  });

  it('places a new group next to the chosen group in both inner and outer areas', () => {
    let layout = dockPaneAdjacentToGroup(
      createDefaultDockLayout(),
      'resources',
      'right-properties',
      'before',
    );
    expect(layout.zones.right.map((group) => group.panes)).toEqual([
      ['scene-tree'],
      ['resources'],
      ['inspector', 'modifiers', 'brand-kit', 'data', 'rules', 'export', 'playout-controls'],
    ]);
    layout = dockPaneToOuterZone(layout, 'data', 'right');
    const outerId = layout.outerZones!.right[0]!.id;
    layout = dockPaneAdjacentToGroup(layout, 'resources', outerId, 'after');
    expect(layout.outerZones!.right.map((group) => group.panes)).toEqual([['data'], ['resources']]);
    expect(layout.zones.right.flatMap((group) => group.panes)).not.toContain('resources');
  });

  it('preserves outer groups and proportions through workspace save and load', () => {
    let layout = dockPaneToOuterZone(createDefaultDockLayout(), 'resources', 'right');
    layout = dockPaneToOuterZone(layout, 'data', 'right');
    const [first, second] = layout.outerZones!.right;
    layout = resizeOuterDockGroups(layout, 'right', { [first!.id]: 320, [second!.id]: 180 });
    const sizes = {
      ...DEFAULT_WORKSPACE_SIZES,
      outerLeft: 260,
      outerRight: 440,
      outerTop: 160,
      outerBottom: 350,
    };
    const snapshot = { version: 1, layout, sizes, detached: {} };
    const restored = parseWorkspaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored).not.toBeNull();
    expect(restored!.layout.outerZones?.right.map((group) => group.weight)).toEqual([320, 180]);
    expect(restored!.layout.outerZones?.right.map((group) => group.panes)).toEqual(
      layout.outerZones?.right.map((group) => group.panes),
    );
    expect(restored!.layout.zones).toEqual(layout.zones);
    expect(restored!.sizes).toEqual(sizes);
  });

  it('sanitizes outer group IDs and weights together with the existing workspace groups', () => {
    const layout = dockPaneToOuterZone(createDefaultDockLayout(), 'resources', 'right');
    layout.outerZones!.right[0]!.id = layout.zones.right[0]!.id;
    layout.outerZones!.right[0]!.weight = 1_000_000;
    const restored = parseWorkspaceSnapshot({
      version: 1,
      layout,
      sizes: DEFAULT_WORKSPACE_SIZES,
      detached: {},
    });
    expect(restored).not.toBeNull();
    const inner = restored!.layout.zones.right[0]!;
    const outer = restored!.layout.outerZones!.right[0]!;
    expect(outer.id).not.toBe(inner.id);
    expect(outer.id.length).toBeLessThanOrEqual(100);
    expect(outer.weight).toBe(100_000);
  });

  it('rejects workspace imports with an oversized outer group list', () => {
    const layout = dockPaneToOuterZone(createDefaultDockLayout(), 'resources', 'right');
    layout.outerZones!.right = Array.from({ length: DOCK_PANE_IDS.length + 1 }, () => ({
      id: 'excess',
      panes: ['resources'],
      activePane: 'resources',
      weight: 1,
    }));
    expect(
      parseWorkspaceSnapshot({ version: 1, layout, sizes: DEFAULT_WORKSPACE_SIZES, detached: {} }),
    ).toBeNull();
  });
});
