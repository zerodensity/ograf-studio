import { describe, expect, it } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  studioPluginReference,
} from './animationPresetPlugins';
import { getLayerPropertyValueAtFrame } from './layerAnimation';
import { LAYER_MOTION_STYLES } from './layerMotion';
import {
  createTransitionContentAnimationComposition,
  transitionAnimationCatalogErrors,
  transitionContentAnimationErrors,
} from './transitionContentAnimation';
import { transitionLogicErrors, type TransitionLogicDefinition } from './transitionLogic';
import type { AnimationPluginPreset, AnimationPresetTrack, Transition } from './types';

export function transitionMotionPlugin(
  targetKinds: AnimationPluginPreset['targetKinds'] = ['rectangle'],
) {
  return createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.transition-motion',
      version: '1.0.0',
      name: 'Transition motion',
      license: 'MIT',
    },
    licenseText: 'MIT test license',
    presets: [
      {
        id: 'travel',
        name: 'Travel',
        ...(targetKinds ? { targetKinds } : {}),
        parameters: [
          { id: 'distance', label: 'Distance', default: 80, min: 0, max: 1000, step: 1 },
        ],
        tracks: {
          in: [
            {
              property: 'x',
              mode: 'offset',
              keys: [
                { at: 0, value: { parameter: 'distance', multiplier: -1 } },
                { at: 0.5, value: { parameter: 'distance', multiplier: -0.5 } },
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
          ],
        },
      },
    ],
  });
}

function definition(): TransitionLogicDefinition {
  return {
    version: 5,
    id: 'motion',
    name: 'Motion',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: [{ id: 'title', name: 'Title', slotId: 'main', templateId: 'title' }],
    transitions: [
      {
        id: 'move',
        name: 'Move',
        durationFrames: 12,
        outgoingFrames: 12,
        incomingStartFrame: 0,
        incomingFrames: 12,
        sharedFrames: 12,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
    defaultTransitionId: 'move',
  };
}

describe('transition-specific content animations', () => {
  it('keeps legacy v1-v4 documents valid and gates new choices to v5', () => {
    const graph = definition();
    for (const version of [1, 2, 3, 4] as const)
      expect(transitionLogicErrors({ ...graph, version })).toEqual([]);
    graph.transitions[0]!.incomingAnimation = { type: 'template' };
    expect(transitionLogicErrors(graph)).toEqual([]);
    expect(transitionLogicErrors({ ...graph, version: 4 })).toContain(
      'Transition move incomingAnimation requires Transition Logic version 5.',
    );
    expect(
      transitionLogicErrors({ ...definition(), version: 4, animationPresetPlugins: [] }),
    ).toContain('Transition animation catalogs require Transition Logic version 5.');
  });

  it.each(LAYER_MOTION_STYLES)('bakes native %s with the ordinary motion baker', (style) => {
    for (const side of ['in', 'out'] as const) {
      const composition = createTransitionContentAnimationComposition(
        { type: 'builtin', motion: { style } },
        side,
        12,
        1920,
        1080,
        50,
      )!;
      const layer = composition.layers[0]!;
      expect(layer.element.type).toBe('rectangle');
      expect(getLayerPropertyValueAtFrame(layer, 'x', 12)).toBe(0);
      expect(getLayerPropertyValueAtFrame(layer, 'width', 12)).toBe(1920);
      expect(getLayerPropertyValueAtFrame(layer, 'opacity', 12)).toBe(1);
      expect(composition.transitions.map((entry: Transition) => entry.durationFrames)).toEqual([
        12, 12,
      ]);
      expect(
        createTransitionContentAnimationComposition(
          { type: 'builtin', motion: { style } },
          side,
          12,
          1920,
          1080,
          50,
        ),
      ).toEqual(composition);
    }
  });

  it('bakes pinned numeric plugin tracks without mutating the catalog', () => {
    const plugin = transitionMotionPlugin();
    const before = structuredClone(plugin);
    const choice = {
      type: 'plugin' as const,
      reference: studioPluginReference(plugin),
      presetId: 'travel',
      parameters: { distance: 240 },
    };
    const incoming = createTransitionContentAnimationComposition(choice, 'in', 12, 1920, 1080, 50, [
      plugin,
    ])!;
    const outgoing = createTransitionContentAnimationComposition(
      choice,
      'out',
      12,
      1920,
      1080,
      50,
      [plugin],
    )!;
    expect(getLayerPropertyValueAtFrame(incoming.layers[0]!, 'x', 0)).toBe(-240);
    expect(getLayerPropertyValueAtFrame(incoming.layers[0]!, 'x', 12)).toBe(0);
    expect(getLayerPropertyValueAtFrame(outgoing.layers[0]!, 'x', 12)).toBe(0);
    expect(getLayerPropertyValueAtFrame(outgoing.layers[0]!, 'x', 24)).toBe(240);
    expect(plugin).toEqual(before);
    expect(
      createTransitionContentAnimationComposition(choice, 'in', 12, 1920, 1080, 50, [plugin]),
    ).toEqual(incoming);
  });

  it('rejects mismatched identities, corruption, wrong targets, sides, parameters, and key collisions', () => {
    const plugin = transitionMotionPlugin();
    const choice = {
      type: 'plugin' as const,
      reference: studioPluginReference(plugin),
      presetId: 'travel',
    };
    expect(transitionAnimationCatalogErrors([plugin])).toEqual([]);
    expect(transitionAnimationCatalogErrors([plugin, plugin])).toContain(
      'Transition animation catalog repeats a pinned pack.',
    );
    expect(
      transitionAnimationCatalogErrors([{ ...plugin, sha256: '0'.repeat(64) }]).join(' '),
    ).toMatch(/integrity/);
    expect(transitionAnimationCatalogErrors(Array(17).fill(plugin)).join(' ')).toMatch(/16/);
    expect(
      transitionContentAnimationErrors(
        { ...choice, reference: { ...choice.reference, sha256: '0'.repeat(64) } },
        'in',
        12,
        [plugin],
      ).join(' '),
    ).toMatch(/exact pinned/);
    expect(
      transitionContentAnimationErrors({ ...choice, parameters: { distance: 1001 } }, 'in', 12, [
        plugin,
      ]).join(' '),
    ).toMatch(/outside/);
    expect(transitionContentAnimationErrors(choice, 'in', 1, [plugin]).join(' ')).toMatch(
      /collide/,
    );
    const textOnly = transitionMotionPlugin(['text']);
    expect(
      transitionContentAnimationErrors(
        { ...choice, reference: studioPluginReference(textOnly) },
        'in',
        12,
        [textOnly],
      ).join(' '),
    ).toMatch(/rectangle/);
    const oneSide = createAnimationPresetPluginSnapshot({
      ...plugin,
      presets: plugin.presets.map((preset) => ({ ...preset, tracks: { in: preset.tracks.in! } })),
    });
    expect(
      transitionContentAnimationErrors(
        { ...choice, reference: studioPluginReference(oneSide) },
        'out',
        12,
        [oneSide],
      ).join(' '),
    ).toMatch(/no out/);
  });

  it('treats explicit template and zero-duration overrides as unwrapped cuts', () => {
    expect(
      createTransitionContentAnimationComposition({ type: 'template' }, 'in', 12, 1920, 1080, 50),
    ).toBeNull();
    expect(
      createTransitionContentAnimationComposition(
        { type: 'builtin', motion: { style: 'pop' } },
        'out',
        0,
        1920,
        1080,
        50,
      ),
    ).toBeNull();
    const plugin = transitionMotionPlugin();
    expect(
      createTransitionContentAnimationComposition(
        { type: 'plugin', reference: studioPluginReference(plugin), presetId: 'travel' },
        'in',
        0,
        1920,
        1080,
        50,
        [plugin],
      ),
    ).toBeNull();
  });

  it.each([
    ['opacity', 'absolute', 2, 1],
    ['opacity', 'factor', 2, 1],
    ['scale', 'offset', -2, 1],
    ['blur', 'absolute', -1, 1],
    ['clipLeft', 'offset', -0.5, 1],
    ['x', 'absolute', 2, 1e308],
  ] as const)(
    'preflights resolved %s %s values without baking a scene',
    (property, mode, amount, multiplier) => {
      const plugin = transitionMotionPlugin();
      const unsafe = createAnimationPresetPluginSnapshot({
        manifest: plugin.manifest,
        licenseText: plugin.licenseText,
        presets: [
          {
            id: 'unsafe',
            name: 'Unsafe resolved range',
            parameters: [
              { id: 'amount', label: 'Amount', default: amount, min: -2, max: 2, step: 0.1 },
            ],
            tracks: {
              in: [
                {
                  property,
                  mode,
                  keys: [
                    { at: 0, value: { parameter: 'amount', multiplier } },
                    { at: 1, value: 'on-air' },
                  ],
                } satisfies AnimationPresetTrack,
              ],
            },
          },
        ],
      });
      const graph = definition();
      graph.animationPresetPlugins = [unsafe];
      const choice = {
        type: 'plugin' as const,
        reference: studioPluginReference(unsafe),
        presetId: 'unsafe',
      };
      graph.transitions[0]!.incomingAnimation = choice;
      expect(transitionLogicErrors(graph).join(' ')).toMatch(
        /resolves outside its supported range/,
      );
      expect(transitionContentAnimationErrors(choice, 'in', 12, [unsafe]).join(' ')).toMatch(
        /resolves outside its supported range/,
      );
      expect(() =>
        createTransitionContentAnimationComposition(choice, 'in', 12, 1920, 1080, 50, [unsafe]),
      ).toThrow(/resolves outside its supported range/);
      // An intentional cut does not evaluate unused motion values.
      expect(transitionContentAnimationErrors(choice, 'in', 0, [unsafe])).toEqual([]);
    },
  );

  it('checks overridden parameters as well as defaults using the shared key resolver', () => {
    const plugin = transitionMotionPlugin();
    const alpha = createAnimationPresetPluginSnapshot({
      manifest: plugin.manifest,
      licenseText: plugin.licenseText,
      presets: [
        {
          id: 'alpha',
          name: 'Alpha',
          parameters: [{ id: 'alpha', label: 'Alpha', default: 1, min: 0, max: 2, step: 0.1 }],
          tracks: {
            in: [
              {
                property: 'opacity',
                mode: 'absolute',
                keys: [
                  { at: 0, value: { parameter: 'alpha' } },
                  { at: 1, value: 'on-air' },
                ],
              },
            ],
          },
        },
      ],
    });
    const choice = {
      type: 'plugin' as const,
      reference: studioPluginReference(alpha),
      presetId: 'alpha',
    };
    expect(transitionContentAnimationErrors(choice, 'in', 12, [alpha])).toEqual([]);
    expect(
      transitionContentAnimationErrors({ ...choice, parameters: { alpha: 2 } }, 'in', 12, [
        alpha,
      ]).join(' '),
    ).toMatch(/opacity resolves outside/);
    expect(
      transitionContentAnimationErrors({ ...choice, parameters: { alpha: 0.5 } }, 'in', 12, [
        alpha,
      ]),
    ).toEqual([]);
  });
});
