import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createProject, type Composition, type DesignToken } from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from '../state/projectSet';
import { BrandKitPanel } from './BrandKitPanel';

const state = vi.hoisted(() => ({
  composition: null as unknown,
  projectSet: null as unknown,
  origins: {} as Record<
    string,
    { origin: 'local' | 'inherited' | 'overridden'; sourceName?: string }
  >,
  actions: {
    setDesignSystemName: vi.fn(),
    applyStylePack: vi.fn(),
    removeStylePack: vi.fn(),
    addDesignToken: vi.fn(),
    updateDesignToken: vi.fn(),
    removeDesignToken: vi.fn(),
  },
}));

vi.mock('../state/projectStore', () => ({
  useActiveComposition: () => state.composition as Composition,
  useProjectStore: (select: (actions: typeof state.actions) => unknown) => select(state.actions),
}));
vi.mock('../state/projectSetStore', () => ({
  useProjectSetStore: (select: (session: { projectSet: ProjectSetDocument | null }) => unknown) =>
    select({ projectSet: state.projectSet as ProjectSetDocument | null }),
}));
vi.mock('../state/templateSetBrandKit', () => ({
  initializeSharedBrandKit: vi.fn(),
  updateSharedBrandKit: vi.fn(),
  updateSharedBrandToken: vi.fn(),
  addSharedBrandToken: vi.fn(),
  removeSharedBrandToken: vi.fn(),
  setBrandTokenOverride: vi.fn(),
  updateSharedBrandBackground: vi.fn(),
  getBrandTokenOrigin: (tokenId: string) => state.origins[tokenId] ?? { origin: 'local' },
}));
vi.mock('../state/brandKitStyles', () => ({
  addTypographyPreset: vi.fn(),
  updateTypographyPreset: vi.fn(),
  removeTypographyPreset: vi.fn(),
  applyTypographyToLayers: vi.fn(),
  getTypographyOrigin: () => ({ origin: 'local' }),
  setTypographyOverride: vi.fn(),
  addBackgroundStyle: vi.fn(),
  updateBackgroundStyle: vi.fn(),
  removeBackgroundStyle: vi.fn(),
  applyBackgroundStyle: vi.fn(),
  getBackgroundStyleOrigin: () => ({ origin: 'local' }),
  setBackgroundStyleOverride: vi.fn(),
  setDefaultBackgroundStyle: vi.fn(),
}));
vi.mock('../state/historyStore', () => ({
  runDiscreteHistoryStep: (operation: () => unknown) => operation(),
}));

function token(id = 'accent'): DesignToken {
  return { id, key: id, name: 'Accent', type: 'color', value: '#33aaff', description: '' };
}

function setDocument(brandKit = false): ProjectSetDocument {
  return {
    id: 'set-id',
    name: 'Broadcast Kit',
    templates: [],
    controls: [],
    assetSlots: [],
    assets: [],
    ...(brandKit ? { brandKit: { name: 'Master brand', tokens: [token()] } } : {}),
  };
}

beforeEach(() => {
  state.composition = createProject().compositions[0]!;
  state.projectSet = null;
  state.origins = {};
});

describe('Brand Kit inheritance controls', () => {
  it('keeps standalone templates local without showing unavailable master actions', () => {
    const html = renderToStaticMarkup(createElement(BrandKitPanel));
    expect(html).toContain('Design tokens');
    expect(html).not.toContain('Brand Kit scope');
    expect(html).not.toContain('Use this Brand Kit for set');
  });

  it('offers explicit promotion of a template Brand Kit, not implicit name matching', () => {
    state.projectSet = setDocument();
    const html = renderToStaticMarkup(createElement(BrandKitPanel));
    expect(html).toContain('aria-label="Brand Kit scope"');
    expect(html).toContain('This template');
    expect(html).toContain('Template Set · Broadcast Kit');
    expect(html).toContain('Use this Brand Kit for set');
  });

  it('shows inherited provenance and an Override action without disabling the editable control', () => {
    (state.composition as Composition).designSystem.tokens = [token()];
    state.projectSet = setDocument(true);
    state.origins.accent = { origin: 'inherited', sourceName: 'Broadcast Kit' };
    const html = renderToStaticMarkup(createElement(BrandKitPanel));
    expect(html).toContain('Inherited · Broadcast Kit');
    expect(html).toContain('is-inherited');
    expect(html).toContain('>Override</button>');
    // The hex field lives in the picker's popover, so the closed control is the picker button.
    expect(html).toMatch(
      /aria-label="Choose Palette Accent"[^>]*><span style="background:#33aaff"/,
    );
    expect(html).not.toMatch(/aria-label="Choose Palette Accent"[^>]*disabled/);
    expect(html).not.toContain('Use this Brand Kit for set');
    expect(html).not.toContain('>Delete</button>');
  });

  it('distinguishes a template token override and offers reset to the master', () => {
    (state.composition as Composition).designSystem.tokens = [token()];
    state.projectSet = setDocument(true);
    state.origins.accent = { origin: 'overridden', sourceName: 'Broadcast Kit' };
    const html = renderToStaticMarkup(createElement(BrandKitPanel));
    expect(html).toContain('Template override');
    expect(html).toContain('is-overridden');
    expect(html).toContain('Reset to inherited');
    expect(html).not.toContain('>Delete</button>');
  });

  it('escapes kit names instead of treating them as HTML or CSS', () => {
    state.projectSet = { ...setDocument(), name: '<script>bad()</script>' };
    const html = renderToStaticMarkup(createElement(BrandKitPanel));
    expect(html).not.toContain('<script>bad()');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  });
});
