import { describe, expect, it } from 'vitest';
import { centerFloatingPane } from './centerFloatingPane';
import { closeDockPane, createDefaultDockLayout, findDockGroup, floatDockPane } from './dockModel';

describe('centering a pane from the Window menu', () => {
  const bounds = { width: 1200, height: 800 };

  it('undocks a visible pane and centers it without disturbing the other panes', () => {
    const layout = createDefaultDockLayout();
    const result = centerFloatingPane(layout, 'rules', bounds);
    const floating = result.floating.find((item) => item.pane === 'rules')!;
    expect(findDockGroup(result, 'rules')).toBeNull();
    expect(result.closed).not.toContain('rules');
    expect(floating.x * 2 + floating.width).toBe(bounds.width);
    expect(floating.y * 2 + floating.height).toBe(bounds.height);
    expect(findDockGroup(result, 'data')).toBe(findDockGroup(layout, 'data'));
  });

  it('opens a closed pane as a centered floating window, including panes usually reopened in a dock', () => {
    const layout = closeDockPane(createDefaultDockLayout(), 'transitions');
    const result = centerFloatingPane(layout, 'transitions', bounds);
    expect(result.closed).not.toContain('transitions');
    expect(findDockGroup(result, 'transitions')).toBeNull();
    expect(result.floating.filter((item) => item.pane === 'transitions')).toHaveLength(1);
    const floating = result.floating.find((item) => item.pane === 'transitions')!;
    expect(floating.x * 2 + floating.width).toBe(bounds.width);
    expect(floating.y * 2 + floating.height).toBe(bounds.height);
  });

  it('recenters and brings an already floating pane forward while preserving its size', () => {
    let layout = floatDockPane(createDefaultDockLayout(), 'rules', {
      x: 20,
      y: 30,
      width: 700,
      height: 380,
    });
    layout = floatDockPane(layout, 'data', { x: 0, y: 0 });
    const result = centerFloatingPane(layout, 'rules', bounds);
    expect(result.floating.at(-1)).toEqual({
      pane: 'rules',
      x: 250,
      y: 210,
      width: 700,
      height: 380,
    });
    expect(result.floating.filter((item) => item.pane === 'rules')).toHaveLength(1);
  });

  it('fits a pane into a smaller workspace', () => {
    const result = centerFloatingPane(createDefaultDockLayout(), 'transitions', {
      width: 400,
      height: 250,
    });
    expect(result.floating.at(-1)).toEqual({
      pane: 'transitions',
      x: 6,
      y: 6,
      width: 388,
      height: 238,
    });
  });
});
