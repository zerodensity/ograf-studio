import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import {
  createAnimationPresetPluginSnapshot,
  studioPluginReference,
} from './animationPresetPlugins';
import {
  applyChartMarkAnimationPreset,
  bakeChartMarkAnimations,
  chartMarkAnimationCount,
  chartMarkAnimationErrors,
  chartMarkAnimationKind,
  chartMarkAnimationPresetCompatible,
  sampleChartMarkAnimations,
} from './chartMarkAnimation';
import { createChartLayer, createComposition, createLayerKeyframe, createProject } from './factory';
import { layerMotionWindows } from './layerMotion';
import { migrateProject } from './migrations';
import { buildComponentDefinition, instantiateComponentDefinition } from './components';
import { refreshComponentDependencies } from './componentDependencies';
import { retimeAnimationPhase } from './animationRetime';
import type { AnimationPluginPreset, ChartElement, ChartMarkAnimationPhase } from './types';

const preset = (overrides: Partial<AnimationPluginPreset> = {}): AnimationPluginPreset => ({
  id: 'bounce',
  name: 'Bounce',
  parameters: [{ id: 'distance', label: 'Distance', default: 80, min: 0, max: 200, step: 1 }],
  tracks: {
    in: [
      {
        property: 'y',
        mode: 'offset',
        keys: [
          { at: 0, value: { parameter: 'distance' } },
          { at: 1, value: 'on-air' },
        ],
      },
      {
        property: 'opacity',
        mode: 'absolute',
        keys: [
          { at: 0, value: 0 },
          { at: 1, value: 'on-air' },
        ],
      },
      {
        property: 'scale',
        mode: 'factor',
        keys: [
          { at: 0, value: 0.5 },
          { at: 1, value: 'on-air' },
        ],
      },
    ],
    out: [
      {
        property: 'x',
        mode: 'offset',
        keys: [
          { at: 0, value: 'on-air' },
          { at: 1, value: { parameter: 'distance' } },
        ],
      },
      {
        property: 'opacity',
        mode: 'absolute',
        keys: [
          { at: 0, value: 'on-air' },
          { at: 1, value: 0 },
        ],
      },
    ],
  },
  ...overrides,
});
function fixture(definition = preset()) {
  const plugin = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.mark-motion',
      version: '1.0.0',
      name: 'Mark motion',
      license: 'MIT',
    },
    presets: [definition],
    licenseText: 'MIT test data',
  });
  const composition = createComposition();
  composition.transitions.forEach((transition) => {
    transition.durationFrames = 40;
  });
  const layer = createChartLayer();
  layer.keyframes = [
    createLayerKeyframe(0, {
      x: 100,
      y: 200,
      width: 640,
      height: 360,
      rotation: 0,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    }),
  ];
  if (layer.element.type !== 'chart') throw Error('Expected chart');
  composition.layers = [layer];
  const element = layer.element;
  const options = {
    durationFrames: 10,
    delayFrames: 2,
    staggerFrames: 3,
    parameters: { distance: 100 },
  };
  const choice: ChartMarkAnimationPhase = {
    reference: studioPluginReference(plugin),
    presetId: definition.id,
    ...options,
  };
  return { plugin, composition, layer, element, options, choice };
}

describe('per-mark animation plugin model', () => {
  it('accepts editor Immer drafts without trying to structuredClone their proxies', () => {
    const { composition, plugin, options } = fixture();
    composition.animationPresetPlugins = [plugin];
    const next = produce(composition, (draft) => {
      applyChartMarkAnimationPreset(draft, draft.layers[0]!, plugin, 'bounce', 'in', options);
    });
    expect((next.layers[0]!.element as ChartElement).markAnimations?.in?.presetId).toBe('bounce');
    expect((composition.layers[0]!.element as ChartElement).markAnimations).toBeUndefined();
  });

  it('pins one exact pack and applies In/Out without rewriting native layer or chart animation', () => {
    const { plugin, composition, layer, options } = fixture();
    const before = structuredClone(layer);
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'in', options);
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'out', options);
    expect(composition.animationPresetPlugins).toHaveLength(1);
    expect(layer.keyframes).toEqual(before.keyframes);
    expect(layer.animationTracks).toEqual(before.animationTracks);
    expect(layer.motion).toEqual(before.motion);
    expect((layer.element as ChartElement).animation).toEqual(
      (before.element as ChartElement).animation,
    );
    expect((layer.element as ChartElement).markAnimations).toMatchObject({
      in: { presetId: 'bounce' },
      out: { presetId: 'bounce' },
    });
    plugin.presets[0]!.name = 'Changed outside document';
    expect(composition.animationPresetPlugins![0]!.presets[0]!.name).toBe('Bounce');
  });

  it('keeps both inputs intact on invalid values, timing, a locked layer or catalog overflow', () => {
    for (const problem of ['timing', 'parameter', 'locked', 'catalog'] as const) {
      const { plugin, composition, layer, options } = fixture();
      if (problem === 'locked') layer.isLocked = true;
      if (problem === 'catalog')
        composition.animationPresetPlugins = Array.from({ length: 16 }, (_, index) =>
          createAnimationPresetPluginSnapshot({
            ...plugin,
            manifest: { ...plugin.manifest, id: `test.pack-${index}` },
          }),
        );
      const before = structuredClone({ composition, layer });
      expect(() =>
        applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'in', {
          ...options,
          ...(problem === 'timing' ? { staggerFrames: 50 } : {}),
          ...(problem === 'parameter' ? { parameters: { distance: 1000 } } : {}),
        }),
      ).toThrow();
      expect({ composition, layer }).toEqual(before);
    }
  });

  it('validates mark kinds and preset sides rather than offering text-only or unsupported plots', () => {
    const { element } = fixture();
    expect(chartMarkAnimationKind('stacked-bar')).toBe('rectangle');
    expect(chartMarkAnimationKind('polar-area')).toBe('ellipse');
    expect(chartMarkAnimationKind('line')).toBeNull();
    expect(
      chartMarkAnimationPresetCompatible(element, preset({ targetKinds: ['chart'] }), 'in'),
    ).toBe(true);
    expect(
      chartMarkAnimationPresetCompatible(element, preset({ targetKinds: ['rectangle'] }), 'in'),
    ).toBe(true);
    expect(
      chartMarkAnimationPresetCompatible(element, preset({ targetKinds: ['text'] }), 'in'),
    ).toBe(false);
    expect(
      chartMarkAnimationPresetCompatible(
        { preset: 'pie' },
        preset({ targetKinds: ['ellipse'] }),
        'in',
      ),
    ).toBe(true);
    expect(
      chartMarkAnimationPresetCompatible(
        { preset: 'pie' },
        preset({ targetKinds: ['rectangle'] }),
        'in',
      ),
    ).toBe(false);
    expect(chartMarkAnimationPresetCompatible({ preset: 'line' }, preset(), 'in')).toBe(false);
    expect(
      chartMarkAnimationPresetCompatible(
        element,
        preset({ tracks: { in: preset().tracks.in! } }),
        'out',
      ),
    ).toBe(false);
  });

  it('bakes compact reproducible unit-anchor curves and samples independent staggered marks', () => {
    const { composition, layer, plugin, options } = fixture();
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'in', options);
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'out', options);
    const element = layer.element as ChartElement;
    const compiled = bakeChartMarkAnimations(
      element,
      composition.animationPresetPlugins!,
      layerMotionWindows(composition),
    )!;
    expect(compiled).toEqual(
      bakeChartMarkAnimations(
        element,
        composition.animationPresetPlugins!,
        layerMotionWindows(composition),
      ),
    );
    expect(compiled.in).toMatchObject({
      startFrame: 2,
      durationFrames: 10,
      staggerFrames: 3,
      staggerSlots: 4,
    });
    expect(compiled.out?.startFrame).toBe(42);
    expect(Object.keys(compiled.in!.tracks)).toHaveLength(3);
    expect(sampleChartMarkAnimations(compiled, 7, 0)).toMatchObject({
      y: 50,
      opacity: 0.5,
      scale: 0.75,
      x: 0,
    });
    expect(sampleChartMarkAnimations(compiled, 7, 1)).toMatchObject({ y: 80, opacity: 0.2 });
    expect(sampleChartMarkAnimations(compiled, 40, 3)).toMatchObject({
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
    });
    expect(sampleChartMarkAnimations(compiled, 47, 0)).toMatchObject({ x: 50, opacity: 0.5 });
    expect(sampleChartMarkAnimations(compiled, 80, 999)).toMatchObject({ x: 100, opacity: 0 });
    expect(sampleChartMarkAnimations(compiled, 7, 0)).toEqual(
      sampleChartMarkAnimations(compiled, 7, 0),
    );
    expect(sampleChartMarkAnimations(undefined, -100, -1)).toMatchObject({
      opacity: 1,
      scale: 1,
      blur: 0,
    });
  });

  it('counts each dataset segment and clamps dynamic additional marks to the final authored slot', () => {
    const { composition, layer, plugin, options } = fixture();
    const element = layer.element as ChartElement;
    element.preset = 'stacked-bar';
    element.data.datasets.push(structuredClone(element.data.datasets[0]!));
    expect(chartMarkAnimationCount(element)).toBe(8);
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'out', options);
    const compiled = bakeChartMarkAnimations(
      layer.element as ChartElement,
      composition.animationPresetPlugins!,
      layerMotionWindows(composition),
    )!;
    expect(compiled.out!.staggerSlots).toBe(8);
    expect(sampleChartMarkAnimations(compiled, 70, 7)).toEqual(
      sampleChartMarkAnimations(compiled, 70, 1200),
    );
    expect(sampleChartMarkAnimations(compiled, 80, 1200).opacity).toBe(0);
  });

  it('samples rotation, clipping and blur in local mark coordinates without mutating curves', () => {
    const definition = preset({
      tracks: {
        in: [
          {
            property: 'rotation',
            mode: 'offset',
            keys: [
              { at: 0, value: 90 },
              { at: 1, value: 'on-air' },
            ],
          },
          {
            property: 'clipLeft',
            mode: 'absolute',
            keys: [
              { at: 0, value: 0.8 },
              { at: 1, value: 'on-air' },
            ],
          },
          {
            property: 'blur',
            mode: 'offset',
            keys: [
              { at: 0, value: 16 },
              { at: 1, value: 'on-air' },
            ],
          },
        ],
      },
    });
    const { composition, layer, plugin, options } = fixture(definition);
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'in', options);
    const compiled = bakeChartMarkAnimations(
      layer.element as ChartElement,
      composition.animationPresetPlugins!,
      layerMotionWindows(composition),
    )!;
    const before = structuredClone(compiled);
    expect(sampleChartMarkAnimations(compiled, 7, 0)).toMatchObject({
      rotation: 45,
      clipLeft: 0.4,
      blur: 8,
      opacity: 1,
      scale: 1,
    });
    expect(sampleChartMarkAnimations(compiled, 7, 0)).not.toBe(
      sampleChartMarkAnimations(compiled, 7, 0),
    );
    expect(compiled).toEqual(before);
  });

  it('preserves pins and choices through source migration without changing original data', () => {
    const { composition, layer, plugin, options } = fixture();
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'in', options);
    const project = createProject({ compositions: [composition] });
    const before = structuredClone(project);
    const migrated = migrateProject(project);
    expect((migrated.compositions[0]!.layers[0]!.element as ChartElement).markAnimations).toEqual(
      (layer.element as ChartElement).markAnimations,
    );
    expect(migrated.compositions[0]!.animationPresetPlugins).toEqual(
      composition.animationPresetPlugins,
    );
    expect(project).toEqual(before);
  });

  it('preserves component pack closure and ports mark phase timings between source and host clocks', () => {
    const { composition, layer, plugin, options } = fixture();
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'in', options);
    applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', 'out', options);
    const definition = buildComponentDefinition(composition, [layer.id], 'Animated chart');
    expect(definition.context!.animationPresetPlugins).toEqual([plugin]);
    definition.context!.animationPresetPlugins = [];
    refreshComponentDependencies(composition, definition);
    expect(definition.context!.animationPresetPlugins).toEqual([plugin]);
    const host = createComposition();
    host.transitions.forEach((transition) => {
      transition.durationFrames = 80;
    });
    host.components.push(definition);
    const instance = instantiateComponentDefinition(host, definition);
    host.layers.push(...instance.layers);
    const markChoices = (instance.layers[0]!.element as ChartElement).markAnimations!;
    expect(host.animationPresetPlugins).toEqual([plugin]);
    expect(markChoices.in).toMatchObject({ durationFrames: 20, delayFrames: 4, staggerFrames: 6 });
    expect(markChoices.out).toMatchObject({ durationFrames: 20, delayFrames: 4, staggerFrames: 6 });
    expect(
      chartMarkAnimationErrors(
        instance.layers[0]!.element as ChartElement,
        host.animationPresetPlugins,
        layerMotionWindows(host),
      ),
    ).toEqual([]);
    const saved = buildComponentDefinition(
      host,
      [instance.layers[0]!.id],
      definition.name,
      definition.id,
    );
    expect((saved.layers[0]!.element as ChartElement).markAnimations).toEqual(
      (layer.element as ChartElement).markAnimations,
    );
    expect(saved.context!.animationPresetPlugins).toEqual([plugin]);
  });

  it('retimes just the requested mark lifecycle phase without replaying or changing pack identity', () => {
    const { composition, layer, plugin, options } = fixture();
    for (const side of ['in', 'out'] as const)
      applyChartMarkAnimationPreset(composition, layer, plugin, 'bounce', side, options);
    const reference = structuredClone(
      (layer.element as ChartElement).markAnimations!.in!.reference,
    );
    retimeAnimationPhase(composition, 'in', 80);
    const choices = (layer.element as ChartElement).markAnimations!;
    expect(choices.in).toMatchObject({ durationFrames: 20, delayFrames: 4, staggerFrames: 6 });
    expect(choices.out).toMatchObject(options);
    expect(choices.in!.reference).toEqual(reference);
    retimeAnimationPhase(composition, 'out', 20);
    expect(choices.in).toMatchObject({ durationFrames: 20, delayFrames: 4, staggerFrames: 6 });
    expect(choices.out).toMatchObject({ durationFrames: 5, delayFrames: 1, staggerFrames: 2 });
    expect(
      chartMarkAnimationErrors(
        layer.element as ChartElement,
        composition.animationPresetPlugins,
        layerMotionWindows(composition),
      ),
    ).toEqual([]);
  });

  it.each([
    [{ durationFrames: 0 }, 'durationFrames'],
    [{ durationFrames: 1501 }, 'durationFrames'],
    [{ delayFrames: -1 }, 'delayFrames'],
    [{ staggerFrames: 101 }, 'staggerFrames'],
    [{ staggerFrames: 0.5 }, 'staggerFrames'],
    [{ parameters: { distance: Infinity } }, 'parameter distance'],
    [{ parameters: { unknown: 1 } }, 'parameter unknown'],
    [{ offsetFrames: 1 }, 'unsupported fields'],
    [{ presetId: 'missing' }, 'preset was not found'],
    [
      { reference: { id: 'test.missing', version: '1.0.0', sha256: 'a'.repeat(64) } },
      'exact pinned',
    ],
  ])('rejects malformed source %j before normalization', (patch, text) => {
    const { element, choice, plugin, composition } = fixture();
    element.markAnimations = { in: { ...choice, ...patch } as ChartMarkAnimationPhase };
    expect(
      chartMarkAnimationErrors(element, [plugin], layerMotionWindows(composition)).join(' '),
    ).toContain(text);
  });

  it('rejects collisions and parameter expressions that resolve outside the property range', () => {
    const input = preset({
      tracks: {
        in: [
          {
            property: 'opacity',
            mode: 'absolute',
            keys: [
              { at: 0, value: { parameter: 'distance' } },
              { at: 0.01, value: 0.5 },
              { at: 1, value: 'on-air' },
            ],
          },
        ],
      },
    });
    const { element, choice, plugin } = fixture(input);
    element.markAnimations = { in: choice };
    expect(chartMarkAnimationErrors(element, [plugin]).join(' ')).toContain('collide at a frame');
    expect(chartMarkAnimationErrors(element, [plugin]).join(' ')).toContain(
      'outside its supported range',
    );
    plugin.presets[0]!.name = 'Tampered';
    expect(chartMarkAnimationErrors(element, [plugin]).join(' ')).toContain('integrity');
  });

  it('rejects missing lifecycle windows and unknown mark animation shapes', () => {
    const { element, choice, plugin } = fixture();
    element.markAnimations = { out: choice };
    expect(chartMarkAnimationErrors(element, [plugin], null).join(' ')).toContain(
      '0-frame lifecycle',
    );
    element.markAnimations = { in: null } as never;
    expect(chartMarkAnimationErrors(element, [plugin])).toContain(
      'Chart mark in animation must be an object.',
    );
    element.markAnimations = [] as never;
    expect(chartMarkAnimationErrors(element, [plugin])).toContain(
      'Chart mark animations must be an object.',
    );
  });
});
