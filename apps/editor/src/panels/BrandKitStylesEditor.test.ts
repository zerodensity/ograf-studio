import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createComposition,
  createDefaultGradient,
  createTextLayer,
  type Composition,
  type DesignSystem,
} from '@ograf-editor/scene-model';
import { BrandKitStylesEditor } from './BrandKitStylesEditor';

const state = vi.hoisted(() => ({
  composition: null as unknown,
  selected: [] as string[],
  origin: 'local' as 'local' | 'inherited' | 'overridden',
}));
vi.mock('../layout/EditorWindow', () => ({
  useEditorWindow: () => ({ document: { body: {} } }),
  isSelectElement: () => false,
}));
vi.mock('../state/projectStore', () => ({
  useActiveComposition: () => state.composition as Composition,
  useProjectStore: Object.assign(() => null, {
    getState: () => ({
      project: { compositions: [state.composition as Composition] },
      activeCompositionId: (state.composition as Composition).id,
    }),
  }),
}));
vi.mock('../state/selectionStore', () => ({
  useSelectionStore: (select: (selection: { selectedLayerIds: string[] }) => unknown) =>
    select({ selectedLayerIds: state.selected }),
}));
vi.mock('../state/brandKitStyles', () => ({
  addTypographyPreset: vi.fn(),
  updateTypographyPreset: vi.fn(),
  removeTypographyPreset: vi.fn(),
  applyTypographyToLayers: vi.fn(),
  setTypographyOverride: vi.fn(),
  addBackgroundStyle: vi.fn(),
  updateBackgroundStyle: vi.fn(),
  removeBackgroundStyle: vi.fn(),
  applyBackgroundStyle: vi.fn(),
  setBackgroundStyleOverride: vi.fn(),
  setDefaultBackgroundStyle: vi.fn(),
  getTypographyOrigin: () => ({ origin: state.origin, sourceName: 'Broadcast Master' }),
  getBackgroundStyleOrigin: () => ({ origin: state.origin, sourceName: 'Broadcast Master' }),
}));
vi.mock('../state/historyStore', () => ({
  runDiscreteHistoryStep: (operation: () => unknown) => operation(),
}));

function kit(): DesignSystem {
  return {
    name: 'Broadcast Master',
    tokens: [],
    typography: [
      {
        id: 'heading',
        name: 'Headline',
        properties: {
          fontFamily: 'Arial',
          fontSize: 48,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: 0,
          textAlign: 'left',
          textTransform: 'none',
        },
      },
    ],
    backgrounds: [{ id: 'night', name: 'Night gradient', paint: createDefaultGradient('linear') }],
  };
}
beforeEach(() => {
  state.composition = createComposition({ layers: [createTextLayer()] });
  state.selected = [];
  state.origin = 'local';
});

describe('Brand Kit composite style controls', () => {
  it('offers named typography starters and all seven editable text properties', () => {
    const html = renderToStaticMarkup(
      createElement(BrandKitStylesEditor, { designSystem: kit(), scope: 'template' }),
    );
    expect(html).toContain('Add headline typography preset');
    expect(html).toContain('Add body typography preset');
    expect(html).toContain('Add caption typography preset');
    for (const property of [
      'font family',
      'size',
      'weight',
      'line height',
      'tracking',
      'alignment',
      'text case',
    ])
      expect(html).toContain(`aria-label="Headline ${property}"`);
    expect(html).toMatch(/disabled=""[^>]*>Apply to selected text/);
    expect(html).toContain('Night gradient');
    expect(html).toContain('Linear gradient');
    expect(html).toContain('Shader');
    expect(html).toContain('Media');
  });

  it('enables applying a typography preset only when unlocked text is selected', () => {
    const composition = state.composition as Composition;
    state.selected = [composition.layers[0]!.id];
    const html = renderToStaticMarkup(
      createElement(BrandKitStylesEditor, { designSystem: kit(), scope: 'template' }),
    );
    expect(html).not.toMatch(/disabled=""[^>]*>Apply to selected text/);
    composition.layers[0]!.isLocked = true;
    const locked = renderToStaticMarkup(
      createElement(BrandKitStylesEditor, { designSystem: kit(), scope: 'template' }),
    );
    expect(locked).toMatch(/disabled=""[^>]*>Apply to selected text/);
  });

  it('shows inherited identities as master-owned while properties remain editable', () => {
    state.origin = 'inherited';
    const html = renderToStaticMarkup(
      createElement(BrandKitStylesEditor, { designSystem: kit(), scope: 'template' }),
    );
    expect(html.match(/title="inherited: Broadcast Master"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="inherited typography style"');
    expect(html).toContain('aria-label="inherited background style"');
    expect(html).toMatch(/aria-label="Headline style name"[^>]*readOnly=""/);
    expect(html).toMatch(/aria-label="Night gradient background style name"[^>]*readOnly=""/);
    expect(html).not.toMatch(/aria-label="Headline font family"[^>]*(?:readOnly|disabled)/);
    expect(html).toContain('aria-label="Keep typography style as a local override"');
    expect(html).toContain('aria-label="Keep background style as a local override"');
    expect(html).not.toMatch(
      /<button[^>]*aria-label="Keep (?:typography|background) style as a local override"[^>]*disabled/,
    );
    expect(html).not.toContain('>Delete</button>');
  });

  it('distinguishes the master default background from template-local application', () => {
    const designSystem = { ...kit(), defaultBackgroundStyleId: 'night' };
    const master = renderToStaticMarkup(
      createElement(BrandKitStylesEditor, { designSystem, scope: 'set' }),
    );
    expect(master).toContain('Master default background style');
    expect(master).toContain('Default background');
    expect(master).not.toContain('Apply to this template');
    const template = renderToStaticMarkup(
      createElement(BrandKitStylesEditor, { designSystem, scope: 'template' }),
    );
    expect(template).toContain('Apply to this template');
    expect(template).not.toContain('Master default background style');
  });

  it('offers reset for explicitly overridden typography and background styles', () => {
    state.origin = 'overridden';
    const html = renderToStaticMarkup(
      createElement(BrandKitStylesEditor, { designSystem: kit(), scope: 'template' }),
    );
    expect(
      html.match(
        /<button[^>]*aria-label="Reset to inherited (?:typography|background) style"[^>]*>/g,
      ),
    ).toHaveLength(2);
    expect(html).toContain('aria-label="overridden typography style"');
    expect(html).toContain('aria-label="overridden background style"');
    expect(html.match(/title="overridden: Broadcast Master"/g)).toHaveLength(2);
    expect(html).not.toMatch(
      /<button[^>]*aria-label="Reset to inherited (?:typography|background) style"[^>]*disabled/,
    );
  });
});
