import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createAnimationPresetPluginSnapshot,
  studioPluginReference,
  TRANSITION_LOGIC_VERSION,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { TransitionContentAnimationEditor } from './TransitionContentAnimationEditor';

const effectRenders = vi.hoisted(() => ({ capture: false, effects: [] as Array<() => unknown> }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: ((effect, dependencies) => {
      if (effectRenders.capture) effectRenders.effects.push(effect);
      else actual.useEffect(effect, dependencies);
    }) as typeof actual.useEffect,
  };
});
// SSR normally reads Zustand's startup snapshot rather than the fixture's current catalog.
vi.mock('../state/pluginSettingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/pluginSettingsStore')>();
  const store = actual.useRendererPluginSettingsStore;
  return {
    ...actual,
    useRendererPluginSettingsStore: Object.assign(
      <T>(selector: (state: ReturnType<typeof store.getState>) => T) => selector(store.getState()),
      store,
    ),
  };
});

const pack = createAnimationPresetPluginSnapshot({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    kind: 'animation-presets',
    id: 'test.content',
    version: '1.0.0',
    name: 'Motion pack',
    license: 'MIT',
  },
  licenseText: 'MIT',
  presets: [
    {
      id: 'entrance',
      name: 'Entrance only',
      parameters: [{ id: 'amount', label: 'Amount', default: 40, min: 0, max: 100, step: 1 }],
      tracks: {
        in: [
          {
            property: 'opacity',
            mode: 'absolute',
            keys: [
              { at: 0, value: 0 },
              { at: 1, value: 'on-air' },
            ],
          },
        ],
      },
    },
  ],
});
const definition: TransitionLogicDefinition = {
  version: TRANSITION_LOGIC_VERSION,
  id: 'logic',
  name: 'Test',
  defaultTransitionId: 'fade',
  slots: [],
  states: [],
  routes: [],
  transitions: [],
  sharedInstances: [],
  initialSharedValues: [],
  animationPresetPlugins: [pack],
};
const originalSettings = useRendererPluginSettingsStore.getState();
afterEach(() => {
  effectRenders.capture = false;
  effectRenders.effects = [];
  useRendererPluginSettingsStore.setState(originalSettings);
});

describe('transition content animation selectors', () => {
  it('loads the existing catalog on mount before Plugins has been opened', async () => {
    const initialize = vi.fn(async () => {
      useRendererPluginSettingsStore.setState({
        initialized: true,
        installed: [{ snapshot: pack, installedAt: '', enabled: true, trusted: true }],
      });
    });
    useRendererPluginSettingsStore.setState({
      installed: [],
      initialized: false,
      loading: false,
      initialize,
    });
    const props = {
      definition: { ...definition, animationPresetPlugins: [] },
      side: 'in' as const,
      frames: 20,
      frameRate: 50,
      onChange: () => {},
    };
    effectRenders.capture = true;
    const before = renderToStaticMarkup(createElement(TransitionContentAnimationEditor, props));
    expect(before).toContain('Loading animation plugins');
    expect(before).not.toContain('Entrance only');
    expect(initialize).not.toHaveBeenCalled();
    expect(effectRenders.effects).toHaveLength(1);
    for (const effect of effectRenders.effects) effect();
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledOnce();
    effectRenders.capture = false;
    const after = renderToStaticMarkup(createElement(TransitionContentAnimationEditor, props));
    expect(after).toContain('Entrance only');
    expect(after).not.toContain('Loading animation plugins');
    expect(after).not.toContain('saved pack');
  });

  it('keeps defaults and saved packs available while reporting a catalog loading error', () => {
    useRendererPluginSettingsStore.setState({
      initialized: true,
      loading: false,
      error: 'Storage unavailable',
    });
    const html = renderToStaticMarkup(
      createElement(TransitionContentAnimationEditor, {
        definition,
        side: 'in',
        frames: 20,
        frameRate: 50,
        onChange: () => {},
      }),
    );
    expect(html).toContain('Could not load animation plugins: Storage unavailable');
    expect(html).toContain('Retry');
    expect(html).toContain('Entrance only');
    expect(html).toContain('Transition style (default)');
    expect(html).toContain('Template animation');
    expect(html).toContain('builtin:fade');
  });

  it('shows defaults, native animations and retained plugin controls without duplicate duration inputs', () => {
    const html = renderToStaticMarkup(
      createElement(TransitionContentAnimationEditor, {
        definition,
        side: 'in',
        value: {
          type: 'plugin',
          reference: studioPluginReference(pack),
          presetId: 'entrance',
          parameters: { amount: 60 },
        },
        frames: 32,
        frameRate: 50,
        onChange: () => {},
      }),
    );
    expect(html).toContain('Incoming animation');
    expect(html).toContain('Transition style (default)');
    expect(html).toContain('Template animation');
    expect(html).toContain('Built-in animations');
    expect(html).toContain('builtin:slide');
    expect(html).toContain('Motion pack 1.0.0 · saved pack');
    expect(html).toContain('Entrance only');
    expect(html).toContain('Incoming animation: Amount');
    expect(html).toContain('value="60"');
    expect(html).toContain('32 f · 0.64 s');
    expect(html).not.toContain('duration in frames');
  });

  it('offers native direction, distance and feel controls, and filters plugins for the side', () => {
    const html = renderToStaticMarkup(
      createElement(TransitionContentAnimationEditor, {
        definition,
        side: 'out',
        value: { type: 'builtin', motion: { style: 'slide', direction: 'right', distance: 120 } },
        frames: 12,
        frameRate: 50,
        onChange: () => {},
      }),
    );
    expect(html).toContain('Outgoing animation direction');
    expect(html).toContain('Outgoing animation distance');
    expect(html).toContain('Outgoing animation feel');
    expect(html).not.toContain('Entrance only');
    expect(html).not.toContain('Motion pack');
  });

  it('keeps a missing or incompatible saved selection visible instead of silently falling back', () => {
    const html = renderToStaticMarkup(
      createElement(TransitionContentAnimationEditor, {
        definition,
        side: 'out',
        value: { type: 'plugin', reference: studioPluginReference(pack), presetId: 'entrance' },
        frames: 12,
        frameRate: 50,
        onChange: () => {},
      }),
    );
    expect(html).toContain('Unavailable saved animation');
    expect(html).toContain('role="alert"');
    expect(html).toContain('not replaced automatically');
  });
});
