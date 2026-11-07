import { describe, expect, it } from 'vitest';
import {
  closeDockPane,
  createDefaultDockLayout,
  dockPaneToGroup,
  floatDockPane,
  parseDockLayout,
  revealDockPane,
  DOCK_PANE_LABELS,
} from './dockModel';

describe('Modifiers docking', () => {
  it('starts directly beside Properties without taking focus', () => {
    const layout = createDefaultDockLayout();
    expect(DOCK_PANE_LABELS.modifiers).toBe('Smart layout');
    const group = layout.zones.right.find((item) => item.panes.includes('inspector'))!;
    expect(group.panes[group.panes.indexOf('inspector') + 1]).toBe('modifiers');
    expect(group.activePane).toBe('inspector');
  });

  it('adds its tab beside the actual Properties group when restoring an older layout', () => {
    const original = createDefaultDockLayout();
    const moved = dockPaneToGroup(original, 'inspector', 'left-authoring');
    for (const groups of Object.values(moved.zones))
      for (const group of groups) group.panes = group.panes.filter((pane) => pane !== 'modifiers');
    const restored = parseDockLayout(moved);
    const group = restored.zones.left.find((item) => item.panes.includes('inspector'))!;
    expect(group.panes[group.panes.indexOf('inspector') + 1]).toBe('modifiers');
    expect(group.activePane).toBe('inspector');
  });

  it('retains closed/floating state and reveals next to Properties', () => {
    const initial = createDefaultDockLayout();
    expect(parseDockLayout(closeDockPane(initial, 'modifiers')).closed).toContain('modifiers');
    const floated = floatDockPane(initial, 'modifiers', { width: 544, height: 620 });
    expect(parseDockLayout(floated).floating).toContainEqual(
      expect.objectContaining({ pane: 'modifiers', width: 544, height: 620 }),
    );
    const revealed = revealDockPane(closeDockPane(initial, 'modifiers'), 'modifiers');
    expect(revealed.floating).toEqual([]);
    expect(
      revealed.zones.right.find((group) => group.panes.includes('inspector'))?.activePane,
    ).toBe('modifiers');
  });
});
