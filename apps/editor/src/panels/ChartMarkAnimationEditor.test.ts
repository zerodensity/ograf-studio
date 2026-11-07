import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  createChartElement,
  createComposition,
  studioPluginReference,
  type ChartElement,
} from '@ograf-editor/scene-model';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { chartMarkAnimationPacks } from '../state/chartMarkAnimationEditing';
import { ChartMarkAnimationControls, ChartMarkAnimationEditor } from './ChartMarkAnimationEditor';

const effects = vi.hoisted(() => ({ capture: false, callbacks: [] as Array<() => unknown> }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: ((effect, dependencies) => {
      if (effects.capture) effects.callbacks.push(effect);
      else actual.useEffect(effect, dependencies);
    }) as typeof actual.useEffect,
  };
});

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

const fade = [
  {
    property: 'opacity' as const,
    mode: 'absolute' as const,
    keys: [
      { at: 0, value: 0 },
      { at: 1, value: 'on-air' as const },
    ],
  },
];
const pack = createAnimationPresetPluginSnapshot({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    kind: 'animation-presets',
    id: 'test.mark-ui',
    version: '1.0.0',
    name: 'Mark motion',
    license: 'MIT',
  },
  licenseText: 'MIT',
  presets: [
    {
      id: 'fade',
      name: 'Mark fade',
      tracks: { in: fade },
      parameters: [{ id: 'amount', label: 'Amount', default: 25, min: 0, max: 100, step: 1 }],
    },
  ],
});
const composition = createComposition({ animationPresetPlugins: [pack] });
const phase = {
  reference: studioPluginReference(pack),
  presetId: 'fade',
  durationFrames: 12,
  delayFrames: 1,
  staggerFrames: 2,
  parameters: { amount: 50 },
};
const originalSettings = useRendererPluginSettingsStore.getState();
vi.stubGlobal('window', { document: {} });
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  useRendererPluginSettingsStore.setState(originalSettings);
  effects.capture = false;
  effects.callbacks = [];
});

function controls(element: ChartElement, side: 'in' | 'out' = 'in', disabled = false) {
  const onApply = vi.fn();
  const onClear = vi.fn();
  const html = renderToStaticMarkup(
    createElement(ChartMarkAnimationControls, {
      element,
      side,
      disabled,
      canClear: true,
      availableFrames: 24,
      frameRate: composition.frameRate,
      packs: chartMarkAnimationPacks(composition, element, [], side),
      onApply,
      onClear,
    }),
  );
  return { html, onApply, onClear };
}

describe('chart mark plugin animation controls', () => {
  it('reads the existing catalog on mount even before the Plugins pane has been opened', async () => {
    const initialize = vi.fn(async () => {
      useRendererPluginSettingsStore.setState({
        initialized: true,
        installed: [{ snapshot: pack, installedAt: '', enabled: true, trusted: true }],
      });
    });
    useRendererPluginSettingsStore.setState({
      initialized: false,
      loading: false,
      installed: [],
      initialize,
    });
    effects.capture = true;
    const props = {
      composition: createComposition(),
      element: createChartElement(),
      supported: true,
    };
    const before = renderToStaticMarkup(createElement(ChartMarkAnimationEditor, props));
    expect(before).toContain('Loading animation plugins');
    expect(before).not.toContain('Mark fade');
    expect(initialize).not.toHaveBeenCalled();
    effects.callbacks[0]!();
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledOnce();
    effects.capture = false;
    const after = renderToStaticMarkup(createElement(ChartMarkAnimationEditor, props));
    expect(after).toContain('Mark fade');
    expect(after).not.toContain('Loading animation plugins');
  });

  it('shows a compact independent selector for each side, not another whole-layer motion editor', () => {
    const element = createChartElement();
    const incoming = controls(element);
    const outgoing = controls(element, 'out');
    expect(incoming.html).toContain('Bars / slices In animation');
    expect(incoming.html).toContain('Use chart animation');
    expect(incoming.html).toContain('Mark motion 1.0.0 · saved pack');
    expect(incoming.html).toContain('Mark fade');
    expect(outgoing.html).toContain('Bars / slices Out animation');
    expect(outgoing.html).toContain('None');
    expect(outgoing.html).not.toContain('Mark fade');
    expect(incoming.onApply).not.toHaveBeenCalled();
    expect(incoming.onClear).not.toHaveBeenCalled();
  });

  it('shows saved timing and numeric parameters with Apply and Clear; rendering never publishes', () => {
    const { html, onApply } = controls(createChartElement({ markAnimations: { in: phase } }));
    expect(html).toContain('Bars / slices In duration');
    expect(html).toContain('Bars / slices In delay duration');
    expect(html).toContain('Bars / slices In stagger duration');
    expect(html).toContain('Bars / slices In: Amount');
    expect(html).toContain('value="50"');
    expect(html).toContain('value="0.48s"');
    expect(html).toContain('24 f available');
    expect(html).toContain('>Apply</button>');
    expect(html).toContain('Clear bars / slices In animation');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps Clear usable when an old renderer or incompatible chart prevents new applications', () => {
    const { html } = controls(createChartElement({ markAnimations: { in: phase } }), 'in', true);
    expect(html).toContain('disabled="">Apply');
    expect(html).toMatch(/aria-label="Clear bars \/ slices In animation">Clear/);
  });

  it('reports a missing exact pin instead of silently selecting another preset', () => {
    const { html } = controls(createChartElement({ markAnimations: { out: phase } }), 'out');
    expect(html).toContain('Unavailable saved preset');
    expect(html).toContain('no animation is substituted');
    expect(html).toContain('role="alert"');
  });

  it('provides provider and chart-kind gates, storage error recovery and the update behavior explanation', () => {
    useRendererPluginSettingsStore.setState({ error: 'Storage unavailable', initialized: true });
    const html = renderToStaticMarkup(
      createElement(ChartMarkAnimationEditor, {
        composition,
        element: createChartElement({ preset: 'line' }),
        supported: false,
      }),
    );
    expect(html).toContain('Bars / slices animation');
    expect(html).toContain('renderer 1.3.0');
    expect(html).toContain('mark-animation-v1');
    expect(html).toContain('Line, area and radar are not supported');
    expect(html).toContain('Storage unavailable');
    expect(html).toContain('Retry');
    expect(html).toContain('In replaces the built-in chart entrance');
    expect(html).toContain('Animate In / Out still controls the whole chart');
  });
});
