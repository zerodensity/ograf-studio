import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createProject,
  createRectangleLayer,
  createTextLayer,
  type AnimationPluginPreset,
  createAnimationPresetPluginSnapshot,
  studioPluginReference,
} from '@ograf-editor/scene-model';
// Reuse local draft slots across SSR passes to exercise controlled search updates without a DOM.
// Other tests keep React's real state hooks; effects/refs and rendering always remain real React.
const draftRenders = vi.hoisted(() => ({ active: false, cursor: 0, slots: [] as unknown[] }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: ((initial: unknown) => {
      if (!draftRenders.active) return actual.useState(initial);
      const index = draftRenders.cursor++;
      if (index === draftRenders.slots.length)
        draftRenders.slots.push(typeof initial === 'function' ? initial() : initial);
      return [
        draftRenders.slots[index],
        (value: unknown) => {
          draftRenders.slots[index] =
            typeof value === 'function' ? value(draftRenders.slots[index]) : value;
        },
      ];
    }) as typeof actual.useState,
  };
});
// SSR normally reads Zustand's startup snapshot, not the installed-pack test fixture.
vi.mock('../state/pluginSettingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/pluginSettingsStore')>();
  const store = actual.useRendererPluginSettingsStore;
  return {
    ...actual,
    useRendererPluginSettingsStore: Object.assign(
      <T>(selector?: (state: ReturnType<typeof store.getState>) => T) =>
        selector ? selector(store.getState()) : store.getState(),
      store,
    ),
  };
});
import { AnimationPresetTiles, AnimationPresetGallery } from './AnimationPresetGallery';
import { EditorWindowContext } from '../layout/EditorWindow';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { useProjectStore } from '../state/projectStore';
import {
  animationPresetParameters,
  animationPresetTargetReason,
  animationSelectionKey,
  parseAnimationPresetOptions,
} from './animationPresetGalleryHelpers';

const preset: AnimationPluginPreset = {
  id: 'fade',
  name: 'Fade',
  parameters: [{ id: 'amount', label: 'Amount', default: 0.5, min: 0, max: 1, step: 0.1 }],
  tracks: {
    in: [
      {
        property: 'opacity',
        mode: 'absolute',
        keys: [
          { at: 0, value: { parameter: 'amount' } },
          { at: 1, value: 'on-air' },
        ],
      },
    ],
  },
};
describe('animation preset gallery drafts', () => {
  it('keeps defaults and validated numeric values local without writing scene state', () => {
    const composition = createProject().compositions[0]!;
    const before = structuredClone(composition);
    expect(animationPresetParameters(preset)).toEqual({ amount: '0.5' });
    expect(parseAnimationPresetOptions(preset, 'in', composition, '6', { amount: '0.8' })).toEqual({
      durationFrames: 6,
      parameters: { amount: 0.8 },
    });
    expect(() =>
      parseAnimationPresetOptions(preset, 'in', composition, '6', { amount: '-' }),
    ).toThrow(/Amount/);
    expect(() =>
      parseAnimationPresetOptions(preset, 'in', composition, '100', { amount: '0.8' }),
    ).toThrow(/Duration/);
    expect(composition).toEqual(before);
  });
  it('validates explicit finish offsets together with duration without hiding timing changes', () => {
    const composition = createProject().compositions[0]!;
    expect(parseAnimationPresetOptions(preset, 'in', composition, '6', {}, '3')).toEqual({
      durationFrames: 6,
      offsetFrames: 3,
      parameters: { amount: 0.5 },
    });
    expect(() => parseAnimationPresetOptions(preset, 'out', composition, '10', {}, '5')).toThrow(
      /plus finish offset/,
    );
    expect(() => parseAnimationPresetOptions(preset, 'in', composition, '6', {}, '-')).toThrow(
      /Finish offset/,
    );
  });
  it('rejects durations that collapse distinct normalized keys onto one frame', () => {
    const packed: AnimationPluginPreset = {
      ...preset,
      tracks: {
        in: [
          {
            property: 'opacity',
            mode: 'absolute',
            keys: [
              { at: 0, value: 0 },
              { at: 0.1, value: 0.2 },
              { at: 1, value: 'on-air' },
            ],
          },
        ],
      },
    };
    expect(() =>
      parseAnimationPresetOptions(packed, 'in', createProject().compositions[0]!, '2', {}),
    ).toThrow(/overlap/);
  });
  it('filters missing sides and shows incompatible object reasons without changing selection', () => {
    const rectangleOnly = {
      ...preset,
      targetKinds: ['rectangle'] as const,
    } as unknown as AnimationPluginPreset;
    const text = createTextLayer();
    expect(animationPresetTargetReason(rectangleOnly, 'in', [text])).toContain(text.name);
    expect(animationPresetTargetReason(preset, 'out', [createRectangleLayer()])).toContain(
      'no Out',
    );
    const markup = renderToStaticMarkup(
      createElement(AnimationPresetTiles, {
        presets: [rectangleOnly],
        side: 'in',
        targets: [text],
        onSelect: () => {},
      }),
    );
    expect(markup).toContain('disabled');
    expect(markup).toContain('Animation preset gallery');
    expect(markup).toContain('<svg');
    expect(
      renderToStaticMarkup(
        createElement(AnimationPresetTiles, {
          presets: [preset],
          side: 'out',
          targets: [],
          onSelect: () => {},
        }),
      ),
    ).not.toContain('aria-pressed');
    expect(animationSelectionKey(['b', 'a', 'a'])).toBe(animationSelectionKey(['a', 'b']));
  });
  it('uses the shared cards while preserving side filters, selected state, illustrations and compatibility', () => {
    const text = createTextLayer();
    const rectangleOnly: AnimationPluginPreset = {
      ...preset,
      id: 'rectangle-fade',
      name: 'Rectangle fade',
      targetKinds: ['rectangle'],
    };
    const markup = renderToStaticMarkup(
      createElement(AnimationPresetTiles, {
        presets: [rectangleOnly, preset],
        side: 'in',
        targets: [text],
        selected: preset.id,
        shared: true,
        onSelect: () => {},
      }),
    );
    expect(markup).toContain('Animation preset gallery');
    expect(markup).toContain('Rectangle fade');
    expect(markup).toContain(text.name);
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup.match(/<svg/g)).toHaveLength(2);
    expect(markup).not.toContain('animation-preset-tiles');
    expect(
      renderToStaticMarkup(
        createElement(AnimationPresetTiles, {
          presets: [preset],
          side: 'out',
          targets: [text],
          shared: true,
          onSelect: () => {},
        }),
      ),
    ).not.toContain('<button');
  });
});

describe('embedded animation gallery presentation', () => {
  afterEach(() => {
    draftRenders.active = false;
    draftRenders.cursor = 0;
    draftRenders.slots = [];
    useRendererPluginSettingsStore.setState({ installed: [], defaultProvider: null });
  });
  it('keeps the center gallery inert and all editing controls in the right settings without popup chrome', () => {
    const pack = createAnimationPresetPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'animation-presets',
        id: 'test.embedded-motion',
        version: '1.0.0',
        name: 'Motion',
        license: 'MIT',
      },
      presets: [{ ...preset, description: 'Fade from the chosen starting alpha.' }],
      licenseText: 'MIT fixture',
    });
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: pack, enabled: true, trusted: true, installedAt: '' }],
    });
    const composition = useProjectStore.getState().project.compositions[0]!;
    const markup = renderToStaticMarkup(
      createElement(
        EditorWindowContext.Provider,
        { value: { document: {} } as unknown as Window & typeof globalThis },
        createElement(AnimationPresetGallery, {
          composition,
          layerIds: [],
          embedded: true,
          onClose: () => {
            throw new Error('Docked gallery must not close');
          },
        }),
      ),
    );
    expect(markup).toContain('animation-preset-picker is-embedded');
    expect(markup).toContain('role="region"');
    expect(markup).not.toContain('Animation pack version');
    const details = markup.match(/<aside\b[\s\S]*?<\/aside>/)?.[0] ?? '';
    const browserStart = markup.indexOf('plugin-template-browser');
    expect(browserStart).toBeGreaterThan(-1);
    const browser = markup.slice(browserStart, markup.indexOf('<aside'));
    expect(browser).toContain('Animation preset gallery');
    expect(browser).toContain('Fade');
    expect(browser).toContain('<svg');
    expect(browser).not.toContain('<input');
    expect(browser).not.toContain('<select');
    expect(browser).not.toContain('Apply In');
    expect(details).toContain('Animation Settings');
    expect(details).toContain('Animation side');
    expect(details).toContain('aria-label="Preset duration"');
    expect(details).toContain('aria-label="Finish offset duration"');
    expect(details).toContain('value="0.48s"');
    expect(details).toContain('Amount');
    expect(details).toContain('Fade from the chosen starting alpha.');
    expect(details).toContain('Replaces keys on this preset');
    expect(details).toContain('Select an object to apply a preset.');
    expect(details).toContain('Apply In');
    expect(markup).not.toContain('Close animation gallery');
    expect(markup).not.toContain('Manage plugins');
    expect(markup).not.toContain('top:80px');
  });
  it('filters names, IDs and descriptions, reselects visible presets and never leaks another preset’s draft parameters', () => {
    const pulse: AnimationPluginPreset = {
      id: 'pulse-pop',
      name: 'Pulse Pop',
      description: 'Energetic scale burst',
      parameters: [
        { id: 'amount', label: 'Pulse amount', default: 1.25, min: 0.5, max: 2, step: 0.05 },
      ],
      tracks: {
        in: [
          {
            property: 'scale',
            mode: 'absolute',
            keys: [
              { at: 0, value: { parameter: 'amount' } },
              { at: 1, value: 'on-air' },
            ],
          },
        ],
      },
    };
    const pack = createAnimationPresetPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'animation-presets',
        id: 'test.search-motion',
        version: '1.0.0',
        name: 'Motion',
        license: 'MIT',
      },
      presets: [preset, pulse],
      licenseText: 'MIT fixture',
    });
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: pack, enabled: true, trusted: true, installedAt: '' }],
    });
    const composition = useProjectStore.getState().project.compositions[0]!;
    const projectBefore = useProjectStore.getState().project;
    const settingsBefore = useRendererPluginSettingsStore.getState();
    draftRenders.active = true;
    const renderSearch = (searchQuery?: string) => {
      draftRenders.cursor = 0;
      return renderToStaticMarkup(
        createElement(
          EditorWindowContext.Provider,
          { value: { document: {} } as unknown as Window & typeof globalThis },
          createElement(AnimationPresetGallery, {
            composition,
            layerIds: [],
            embedded: true,
            searchQuery,
            initialReference: studioPluginReference(pack),
            initialApplication: {
              reference: studioPluginReference(pack),
              presetId: preset.id,
              durationFrames: 6,
              parameters: { amount: 0.8 },
            },
            onClose: () => {
              throw new Error('Search must not dismiss the docked gallery');
            },
          }),
        ),
      );
    };
    expect(renderSearch()).toMatch(/aria-label="Amount"[^>]*value="0\.8"/);
    const matching = renderSearch('  BURST\tPULSE-POP ');
    const browser = matching.slice(
      matching.indexOf('plugin-template-browser'),
      matching.indexOf('<aside'),
    );
    const details = matching.match(/<aside\b[\s\S]*?<\/aside>/)?.[0] ?? '';
    expect(browser).toContain('Pulse Pop');
    expect(browser).not.toContain('>Fade<');
    expect(browser.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(details).toContain('Energetic scale burst');
    expect(details).toMatch(/aria-label="Pulse amount"[^>]*value="1\.25"/);
    expect(renderSearch('fade')).toMatch(/aria-label="Amount"[^>]*value="0\.8"/);
    const empty = renderSearch('absent');
    const emptyBrowser = empty.slice(
      empty.indexOf('plugin-template-browser'),
      empty.indexOf('<aside'),
    );
    const emptyDetails = empty.match(/<aside\b[\s\S]*?<\/aside>/)?.[0] ?? '';
    expect(emptyBrowser).toContain('No matching animation templates.');
    expect(emptyBrowser).not.toContain('<button');
    expect(emptyDetails).not.toContain('aria-label="Amount"');
    expect(emptyDetails).not.toContain('aria-label="Pulse amount"');
    expect(emptyDetails).toContain('No matching animation templates.');
    expect(emptyDetails).toMatch(/<button[^>]*disabled=""[^>]*>Apply In/);
    expect(renderSearch('')).toMatch(/aria-label="Amount"[^>]*value="0\.8"/);
    expect(useProjectStore.getState().project).toBe(projectBefore);
    expect(useRendererPluginSettingsStore.getState()).toBe(settingsBefore);
  });
});
