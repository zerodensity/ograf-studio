import { describe, expect, it } from 'vitest';
import {
  activateDockPane,
  closeDockPane,
  createDefaultDockLayout,
  dockPaneAdjacentToTab,
  dockPaneToGroup,
  dockPaneToZone,
  dockZoneNearFloatingRect,
  dockZoneNearPointer,
  findDockGroup,
  floatDockPane,
  moveFloatingDockPane,
  parseDockLayout,
  reopenDockPane,
  resizeDockGroups,
} from './dockModel';

describe('dock layout model', () => {
  it('starts with the existing editor arrangement', () => {
    const layout = createDefaultDockLayout();
    expect(layout.zones.left.map((group) => group.panes)).toEqual([
      ['layers', 'chat'],
      ['resources'],
    ]);
    expect(layout.zones.right[0]?.panes).toEqual(['inspector', 'data', 'export']);
    expect(layout.zones.bottom[0]?.panes).toEqual(['timeline']);
  });

  it('moves panes between edge zones without duplicating them', () => {
    const moved = dockPaneToZone(createDefaultDockLayout(), 'resources', 'right');
    expect(findDockGroup(moved, 'resources')).toBe('right-resources');
    expect(moved.zones.left.flatMap((group) => group.panes)).not.toContain('resources');
  });

  it('stacks a newly bottom-docked pane above the existing bottom pane', () => {
    const moved = dockPaneToZone(createDefaultDockLayout(), 'resources', 'bottom');
    expect(moved.zones.bottom.map((group) => group.panes)).toEqual([['resources'], ['timeline']]);
  });

  it('merges panes into a tab group and activates the dropped pane', () => {
    const moved = dockPaneToGroup(createDefaultDockLayout(), 'timeline', 'right-properties');
    expect(moved.zones.right[0]?.panes).toEqual(['inspector', 'data', 'export', 'timeline']);
    expect(moved.zones.right[0]?.activePane).toBe('timeline');
    expect(moved.zones.bottom).toEqual([]);
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
    expect(before.zones.right[0]?.panes).toEqual(['export', 'inspector', 'data']);
    expect(before.zones.right[0]?.activePane).toBe('export');

    const after = dockPaneAdjacentToTab(before, 'export', 'right-properties', 'data', 'after');
    expect(after.zones.right[0]?.panes).toEqual(['inspector', 'data', 'export']);
  });

  it('inserts a pane from another dock group at the requested tab position', () => {
    const moved = dockPaneAdjacentToTab(
      createDefaultDockLayout(),
      'timeline',
      'right-properties',
      'data',
      'before',
    );
    expect(moved.zones.right[0]?.panes).toEqual(['inspector', 'timeline', 'data', 'export']);
    expect(moved.zones.bottom).toEqual([]);
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
    expect(activated.zones.right[0]?.activePane).toBe('data');
  });

  it('persists proportional weights for adjacent dock groups', () => {
    const resized = resizeDockGroups(createDefaultDockLayout(), 'left', {
      'left-authoring': 320,
      'left-resources': 120,
    });
    expect(resized.zones.left.map((group) => group.weight)).toEqual([320, 120]);
    expect(parseDockLayout(resized).zones.left.map((group) => group.weight)).toEqual([320, 120]);
  });

  it('closes panes without repair reopening them and reopens them in their default region', () => {
    const closed = closeDockPane(createDefaultDockLayout(), 'inspector');
    expect(closed.closed).toEqual(['inspector']);
    expect(findDockGroup(closed, 'inspector')).toBeNull();

    const restored = parseDockLayout(closed);
    expect(restored.closed).toEqual(['inspector']);
    expect(findDockGroup(restored, 'inspector')).toBeNull();

    const reopened = reopenDockPane(restored, 'inspector');
    expect(reopened.closed).toEqual([]);
    expect(reopened.zones.right[0]?.panes).toEqual(['inspector', 'data', 'export']);
    expect(reopened.zones.right[0]?.activePane).toBe('inspector');
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
    ];
    expect(new Set(panes).size).toBe(7);
    expect(panes).toHaveLength(7);
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
