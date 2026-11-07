import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDefaultGradient, createProject, type Project } from '@ograf-editor/scene-model';
import { CompositionSettings } from './CompositionSettings';

const state = vi.hoisted(() => ({
  project: null as unknown,
  origin: 'local' as 'local' | 'inherited' | 'overridden',
}));
vi.mock('../layout/EditorWindow', () => ({
  useEditorWindow: () => ({ document: { body: {} } }),
  isSelectElement: () => false,
}));
vi.mock('../state/projectStore', () => ({
  useActiveComposition: () => (state.project as Project).compositions[0],
  useProjectStore: Object.assign(
    (select: (value: unknown) => unknown) =>
      select({
        project: state.project,
        activeCompositionId: (state.project as Project).mainCompositionId,
        setProjectMeta: vi.fn(),
        updateCompositionSettings: vi.fn(),
        updateCompositionLayout: vi.fn(),
        addCanvasGuide: vi.fn(),
        updateCanvasGuide: vi.fn(),
        removeCanvasGuide: vi.fn(),
      }),
    {
      getState: () => ({
        project: state.project,
        activeCompositionId: (state.project as Project).mainCompositionId,
      }),
    },
  ),
}));
vi.mock('../state/projectSetStore', () => ({
  useProjectSetStore: (select: (session: unknown) => unknown) =>
    select({ projectSet: null, activeTemplateId: null }),
}));
vi.mock('../state/historyStore', () => ({
  runDiscreteHistoryStep: (operation: () => unknown) => operation(),
}));
vi.mock('../state/brandKitStyles', () => ({
  applyBackgroundStyle: vi.fn(),
  updateCompositionBackgroundPaint: vi.fn(),
  resetCompositionBackground: vi.fn(),
  getBackgroundOrigin: () => ({ origin: state.origin, sourceName: 'Broadcast Master' }),
  addTypographyPreset: vi.fn(),
  updateTypographyPreset: vi.fn(),
  removeTypographyPreset: vi.fn(),
  applyTypographyToLayers: vi.fn(),
  getTypographyOrigin: () => ({ origin: 'local' }),
  setTypographyOverride: vi.fn(),
  addBackgroundStyle: vi.fn(),
  updateBackgroundStyle: vi.fn(),
  removeBackgroundStyle: vi.fn(),
  getBackgroundStyleOrigin: () => ({ origin: 'local' }),
  setBackgroundStyleOverride: vi.fn(),
  setDefaultBackgroundStyle: vi.fn(),
}));

beforeEach(() => {
  state.project = createProject();
  state.origin = 'local';
});
const render = (section?: 'output' | 'background' | 'canvas' | 'guides') =>
  renderToStaticMarkup(
    createElement(CompositionSettings, {
      filter: '',
      onFilterChange: () => {},
      ...(section ? { mode: 'settings', section } : {}),
    }),
  );

describe('Canvas Brand Kit backgrounds', () => {
  it('preserves simple color/transparent controls until rich paint is requested', () => {
    const html = render();
    expect(html).toContain('inspector-background-color');
    expect(html).toContain('Transparent output');
    expect(html).toContain('Use gradient, shader or media paint');
  });

  it('hides primitive color controls when a rich inherited background is active', () => {
    const composition = (state.project as Project).compositions[0]!;
    composition.backgroundPaint = createDefaultGradient('linear');
    composition.backgroundStyleId = 'night';
    composition.designSystem.backgrounds = [
      { id: 'night', name: 'Night gradient', paint: composition.backgroundPaint },
    ];
    state.origin = 'inherited';
    const html = render();
    expect(html).toContain('Canvas background style');
    expect(html).toContain('Night gradient');
    expect(html).toContain('Background paint');
    expect(html).toContain('aria-label="inherited background style"');
    expect(html).toContain('title="inherited: Broadcast Master"');
    expect(html).not.toContain('inspector-background-color');
    expect(html).not.toContain('Use gradient, shader or media paint');
    expect(html).toContain('This is the exported canvas background');
  });

  it('offers a compact reset for an explicit composition background override', () => {
    (state.project as Project).compositions[0]!.backgroundPaint = createDefaultGradient('radial');
    state.origin = 'overridden';
    const html = render();
    expect(html).toContain('aria-label="Reset background to inherited style"');
    expect(html).toContain('aria-label="overridden background style"');
    expect(html).toContain('title="overridden: Broadcast Master"');
    expect(html).not.toMatch(
      /<button[^>]*aria-label="Reset background to inherited style"[^>]*disabled/,
    );
  });

  it('reuses output controls in the Template scope without inspector-only chrome', () => {
    const html = render('output');
    expect(html).toContain('Frame rate');
    expect(html).toContain('Update animation');
    expect(html).toContain('Render modes');
    expect(html).not.toContain('Nothing selected');
    expect(html).not.toContain('Filter properties');
    expect(html).not.toContain('Canvas background style');
    expect(html).not.toContain('Presentation background');
  });

  it('keeps the full background editor in its Template settings category', () => {
    const html = render('background');
    expect(html).toContain('Transparent output');
    expect(html).toContain('Use gradient, shader or media paint');
    expect(html).not.toContain('Frame rate');
    expect(html).not.toContain('Presentation background');
  });

  it('keeps canvas display and snapping while routing preview backgrounds to Playout Controls', () => {
    const html = render('canvas');
    expect(html).toContain('Snap to grid');
    expect(html).toContain('Open Playout Controls');
    expect(html).not.toContain('Presentation background');
    expect(html).not.toContain('Start webcam');
    expect(html).not.toContain('Transparent output');
    expect(html).not.toContain('Frame rate');
  });

  it('keeps per-composition guide editing available in its own category', () => {
    const html = render('guides');
    expect(html).toContain('+ Vertical');
    expect(html).toContain('+ Horizontal');
    expect(html).not.toContain('Frame rate');
    expect(html).not.toContain('Presentation background');
  });
});
