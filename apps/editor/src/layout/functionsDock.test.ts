import { describe, expect, it } from 'vitest';
import {
  closeDockPane,
  createDefaultDockLayout,
  detachedWindowWidth,
  dockPaneToGroup,
  DOCK_PANE_IDS,
  DOCK_PANE_LABELS,
  findDockGroup,
  floatDockPane,
  parseDockLayout,
  reopenDockPane,
} from './dockModel';

describe('Functions pane registration and docking', () => {
  it('is available to the Window menu without opening or rearranging existing panes', () => {
    const layout = createDefaultDockLayout();
    expect(DOCK_PANE_IDS).toContain('functions');
    expect(DOCK_PANE_LABELS.functions).toBe('Functions');
    expect(layout.closed).toContain('functions');
    expect(findDockGroup(layout, 'functions')).toBeNull();
    const legacy = structuredClone(layout);
    legacy.closed = legacy.closed.filter((pane) => pane !== 'functions');
    const restored = parseDockLayout(legacy);
    expect(restored.zones).toEqual(legacy.zones);
    expect(restored.floating).toEqual(legacy.floating);
    expect(restored.closed).toContain('functions');
  });

  it('opens beside the actual Rules tab and preserves floating/closed positions', () => {
    const moved = dockPaneToGroup(createDefaultDockLayout(), 'rules', 'left-authoring');
    const opened = reopenDockPane(moved, 'functions');
    const group = opened.zones.left.find((item) => item.panes.includes('rules'))!;
    expect(group.panes[group.panes.indexOf('rules') + 1]).toBe('functions');
    expect(group.activePane).toBe('functions');
    expect(opened.zones.right).toEqual(moved.zones.right);
    const floating = floatDockPane(opened, 'functions', { x: 120, y: 60, width: 860, height: 620 });
    expect(parseDockLayout(floating).floating).toContainEqual(
      expect.objectContaining({ pane: 'functions', width: 860, height: 620 }),
    );
    expect(parseDockLayout(closeDockPane(floating, 'functions')).closed).toContain('functions');
    expect(detachedWindowWidth('functions')).toBeGreaterThanOrEqual(800);
  });
});
