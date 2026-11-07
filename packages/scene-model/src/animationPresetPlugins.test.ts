import { describe, expect, it } from 'vitest';
import {
  applyAnimationPreset,
  animationPresetPluginDigest,
  createAnimationPresetPluginSnapshot,
  isAnimationPresetPluginSnapshot,
  isRendererPluginSnapshot,
  studioPluginReference,
  validateAnimationPresetPluginSnapshot,
  validateStudioPluginSnapshot,
} from './animationPresetPlugins';
import { applyLayerMotion, layerMotionState } from './layerMotion';
import { computeKeyframeFrames } from './keyframeTiming';
import {
  createComposition,
  createLayerKeyframe,
  createLayerLoopClip,
  createRectangleLayer,
  createTextLayer,
} from './factory';
import { getLayerPropertyValueAtFrame } from './layerAnimation';
import { migrateProject } from './migrations';
import { createProject } from './factory';
import type { AnimationPluginPreset, AnimationPresetApplyOptions } from './types';
import { ANIMATION_PRESET_TRACK_PROPERTIES } from './animationPresetPlugins';

function definition(): AnimationPluginPreset {
  return {
    id: 'shift',
    name: 'Shift',
    targetKinds: ['rectangle'],
    parameters: [{ id: 'distance', label: 'Distance', default: 80, min: 0, max: 200, step: 1 }],
    tracks: {
      in: [
        {
          property: 'x',
          mode: 'offset',
          keys: [
            { at: 0, value: { parameter: 'distance', multiplier: -1 } },
            { at: 0.5, value: { parameter: 'distance', multiplier: -0.5 } },
            { at: 1, value: 'on-air', easing: 'cubic-out' },
          ],
        },
      ],
      out: [
        {
          property: 'x',
          mode: 'offset',
          keys: [
            { at: 0, value: 'on-air' },
            { at: 1, value: { parameter: 'distance' }, easing: 'cubic-in' },
          ],
        },
      ],
    },
  };
}
function snapshot(preset = definition(), version = '1.0.0') {
  return createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.motion',
      version,
      name: 'Motion data',
      license: 'MIT',
    },
    presets: [preset],
    licenseText: 'MIT data license',
  });
}
function fixture() {
  const composition = createComposition();
  const layer = createRectangleLayer();
  layer.keyframes = computeKeyframeFrames(composition).map((entry) =>
    createLayerKeyframe(entry.frame, {
      x: 200,
      y: 300,
      width: 400,
      height: 100,
      rotation: 0,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    }),
  );
  composition.layers = [layer];
  return { composition, layer };
}
const valueAt = (
  layer: ReturnType<typeof createRectangleLayer>,
  property: 'x' | 'scale' | 'clipLeft' | 'clipRight' | 'rotation',
  frame: number,
) => getLayerPropertyValueAtFrame(layer, property, frame);

describe('declarative animation preset definitions', () => {
  it('enables only the plugin-authored channels on an independent static layer', () => {
    const { composition, layer } = fixture();
    layer.animationTrackMode = 'independent';
    layer.keyframes = [layer.keyframes[0]!];
    layer.animationTracks = {};
    applyAnimationPreset(composition, layer, snapshot(), 'shift', 'in', { durationFrames: 6 });
    expect(Object.keys(layer.animationTracks)).toEqual(['x']);
    expect(valueAt(layer, 'x', 24)).toBe(200);
  });

  it('pins definition bytes and dispatches union guards without treating data as executable source', () => {
    const plugin = snapshot();
    expect(plugin.sha256).toBe(animationPresetPluginDigest(plugin));
    expect(isAnimationPresetPluginSnapshot(plugin)).toBe(true);
    expect(isRendererPluginSnapshot(plugin)).toBe(false);
    expect(validateStudioPluginSnapshot(plugin)).toEqual([]);
    expect(studioPluginReference(plugin)).toEqual({
      id: 'test.motion',
      version: '1.0.0',
      sha256: plugin.sha256,
    });
    plugin.presets[0]!.name = 'Changed';
    expect(validateAnimationPresetPluginSnapshot(plugin).join(' ')).toContain('integrity');
  });

  it.each([
    (p: AnimationPluginPreset) => {
      Object.assign(p, { script: 'alert(1)' });
    },
    (p: AnimationPluginPreset) => {
      p.parameters![0]!.id = '__proto__';
    },
    (p: AnimationPluginPreset) => {
      p.parameters![0]!.default = 201;
    },
    (p: AnimationPluginPreset) => {
      p.parameters![0]!.step = 0;
    },
    (p: AnimationPluginPreset) => {
      p.tracks.in![0]!.keys[1]!.at = 0;
    },
    (p: AnimationPluginPreset) => {
      p.tracks.in![0]!.keys[0]!.at = 0.1;
    },
    (p: AnimationPluginPreset) => {
      p.tracks.in![0]!.keys.at(-1)!.value = 0;
    },
    (p: AnimationPluginPreset) => {
      p.tracks.out![0]!.keys[0]!.value = 0;
    },
    (p: AnimationPluginPreset) => {
      p.tracks.in!.push(structuredClone(p.tracks.in![0]!));
    },
    (p: AnimationPluginPreset) => {
      p.tracks.in![0]!.keys[0]!.value = { parameter: 'missing' };
    },
    (p: AnimationPluginPreset) => {
      p.targetKinds = ['unknown'] as never;
    },
    (p: AnimationPluginPreset) => {
      Object.assign(p.tracks.in![0]!, { css: 'color:red' });
    },
  ])('rejects unsafe or malformed declarations %s', (change) => {
    const preset = definition();
    change(preset);
    expect(() => snapshot(preset)).toThrow();
  });

  it('rejects executable-source fields and excessive preset/key counts', () => {
    const plugin = snapshot();
    expect(
      validateAnimationPresetPluginSnapshot({ ...plugin, source: 'export default {};' }).join(' '),
    ).toContain('unknown field source');
    expect(
      validateAnimationPresetPluginSnapshot({
        ...plugin,
        presets: Array(65).fill(plugin.presets[0]),
      }).join(' '),
    ).toContain('1..64');
    const preset = definition();
    preset.tracks.in![0]!.keys = Array.from({ length: 65 }, (_, index) => ({
      at: index / 64,
      value: index === 64 ? 'on-air' : 0,
    }));
    expect(() => snapshot(preset)).toThrow('2..64');
  });

  it('bounds valid JSON definition bytes independently of key/preset count limits', () => {
    const presets: AnimationPluginPreset[] = Array.from({ length: 64 }, (_, index) => ({
      id: `preset${index}`,
      name: 'Many keys',
      tracks: {
        in: ANIMATION_PRESET_TRACK_PROPERTIES.map((property) => ({
          property,
          mode: 'absolute' as const,
          keys: Array.from({ length: 64 }, (_, key) => ({
            at: key / 63,
            value: key === 63 ? ('on-air' as const) : 0,
            easing: 'elastic-in-out' as const,
          })),
        })),
      },
    }));
    expect(() =>
      createAnimationPresetPluginSnapshot({
        manifest: {
          schemaVersion: 1,
          apiVersion: 1,
          kind: 'animation-presets',
          id: 'test.large',
          version: '1.0.0',
          name: 'Large',
          license: 'MIT',
        },
        presets,
        licenseText: 'MIT',
      }),
    ).toThrow('2 MiB');
  });
});

describe('atomic animation preset baking', () => {
  it('preserves anchors, outside keys and loops while recording a portable copied pin', () => {
    const { composition, layer } = fixture();
    layer.animationTracks.x = [
      { id: 'anchor', frame: 12, value: 200, easing: 'linear' },
      { id: 'later', frame: 20, value: 500, easing: 'linear' },
    ];
    layer.loop = createLayerLoopClip({ durationFrames: 12, repeatCount: 1 });
    layer.loop.tracks.rotation = [{ id: 'loop', frame: 0, value: 5, easing: 'linear' }];
    const loop = structuredClone(layer.loop);
    const plugin = snapshot();
    applyAnimationPreset(composition, layer, plugin, 'shift', 'in', {
      durationFrames: 6,
      offsetFrames: 2,
      parameters: { distance: 100 },
    });
    expect(valueAt(layer, 'x', 0)).toBe(100);
    expect(valueAt(layer, 'x', 4)).toBe(100);
    expect(valueAt(layer, 'x', 10)).toBe(200);
    expect(valueAt(layer, 'x', 12)).toBe(200);
    expect(layer.animationTracks.x?.find((key) => key.frame === 20)).toMatchObject({
      id: 'later',
      value: 500,
    });
    expect(layer.loop).toEqual(loop);
    expect(layer.animationPresets?.in).toMatchObject({
      presetId: 'shift',
      durationFrames: 6,
      offsetFrames: 2,
      parameters: { distance: 100 },
    });
    expect(composition.animationPresetPlugins).toEqual([plugin]);
    expect(composition.animationPresetPlugins![0]).not.toBe(plugin);
    const project = createProject({
      mainCompositionId: composition.id,
      compositions: [composition],
    });
    expect(
      migrateProject(JSON.parse(JSON.stringify(project))).compositions[0]!.animationPresetPlugins,
    ).toEqual([plugin]);
  });

  it('finishes OUT earlier and holds its off-air value through End', () => {
    const { composition, layer } = fixture();
    applyAnimationPreset(composition, layer, snapshot(), 'shift', 'out', {
      durationFrames: 6,
      offsetFrames: 2,
    });
    expect(valueAt(layer, 'x', 12)).toBe(200);
    expect(valueAt(layer, 'x', 16)).toBe(200);
    expect(valueAt(layer, 'x', 22)).toBe(280);
    expect(valueAt(layer, 'x', 24)).toBe(280);
    expect(layer.animationPresets?.out?.parameters).toEqual({ distance: 80 });
  });

  it('applies factors and parameter expression offsets while preserving the exact on-air anchor', () => {
    const { composition, layer } = fixture();
    const preset = definition();
    delete preset.tracks.out;
    preset.parameters = [
      { id: 'fraction', label: 'Fraction', default: 0.5, min: 0, max: 1, step: 0.1 },
    ];
    preset.tracks.in = [
      {
        property: 'scale',
        mode: 'factor',
        keys: [
          { at: 0, value: { parameter: 'fraction', multiplier: 0.5, offset: 0.25 } },
          { at: 1, value: 'on-air' },
        ],
      },
    ];
    applyAnimationPreset(composition, layer, snapshot(preset), 'shift', 'in', {
      durationFrames: 12,
    });
    expect(valueAt(layer, 'scale', 0)).toBe(0.5);
    expect(valueAt(layer, 'scale', 12)).toBe(1);
  });

  it.each<AnimationPresetApplyOptions>([
    { durationFrames: 1 },
    { durationFrames: 13 },
    { durationFrames: 6, offsetFrames: 7 },
    { durationFrames: 6, parameters: { distance: 201 } },
    { durationFrames: 6, parameters: { constructor: 1 } },
  ])('leaves all state intact on invalid timing or parameters %j', (options) => {
    const { composition, layer } = fixture();
    const before = structuredClone(composition);
    expect(() =>
      applyAnimationPreset(composition, layer, snapshot(), 'shift', 'in', options),
    ).toThrow();
    expect(composition).toEqual(before);
  });

  it('preflights locks, applicability, target kinds and resolved ranges before any mutation', () => {
    const { composition, layer } = fixture();
    const before = structuredClone(composition);
    layer.isLocked = true;
    expect(() =>
      applyAnimationPreset(composition, layer, snapshot(), 'shift', 'in', { durationFrames: 6 }),
    ).toThrow('locked');
    layer.isLocked = false;
    const text = createTextLayer();
    expect(() =>
      applyAnimationPreset(composition, text, snapshot(), 'shift', 'in', { durationFrames: 6 }),
    ).toThrow('element kind');
    const bad = definition();
    bad.tracks.in = [
      {
        property: 'opacity',
        mode: 'offset',
        keys: [
          { at: 0, value: 1 },
          { at: 1, value: 'on-air' },
        ],
      },
    ];
    expect(() =>
      applyAnimationPreset(composition, layer, snapshot(bad), 'shift', 'in', { durationFrames: 6 }),
    ).toThrow('supported range');
    layer.effects.stack = [];
    const blur = definition();
    blur.tracks.in = [
      {
        property: 'blur',
        mode: 'absolute',
        keys: [
          { at: 0, value: 12 },
          { at: 1, value: 'on-air' },
        ],
      },
    ];
    const withoutBlur = structuredClone(composition);
    expect(() =>
      applyAnimationPreset(composition, layer, snapshot(blur), 'shift', 'in', {
        durationFrames: 6,
      }),
    ).toThrow('unavailable');
    expect(composition).toEqual(withoutBlur);
    expect(before.animationPresetPlugins).toBeUndefined();
  });

  it.each(['clipRight', 'scale', 'rotation'] as const)(
    'native reset cleans prior plugin-owned %s only in its window',
    (property) => {
      const { composition, layer } = fixture();
      const preset = definition();
      preset.tracks.in = [
        {
          property,
          mode: 'absolute',
          keys: [
            { at: 0, value: property === 'clipRight' ? 1 : property === 'scale' ? 0 : 90 },
            { at: 1, value: 'on-air' },
          ],
        },
      ];
      applyAnimationPreset(composition, layer, snapshot(preset), 'shift', 'in', {
        durationFrames: 12,
      });
      expect(layerMotionState(composition, layer, 'in')).toBe('custom');
      layer.animationTracks[property] = layer.animationTracks[property]!.filter(
        (key) => key.frame !== 24,
      );
      layer.animationTracks[property]!.push({
        id: 'outside',
        frame: 24,
        value: property === 'clipRight' ? 0.5 : property === 'scale' ? 0.8 : 30,
        easing: 'linear',
      });
      applyLayerMotion(
        composition,
        layer,
        'in',
        property === 'scale' ? { style: 'fade', durationFrames: 12 } : null,
      );
      expect(valueAt(layer, property, 0)).toBe(property === 'scale' ? 1 : 0);
      expect(layer.animationTracks[property]?.find((key) => key.frame === 24)).toMatchObject({
        id: 'outside',
      });
      expect(layer.animationPresets?.in).toBeUndefined();
    },
  );

  it('rejects catalog limits before mutating the target layer', () => {
    const { composition, layer } = fixture();
    composition.animationPresetPlugins = Array.from({ length: 16 }, (_, index) =>
      snapshot(definition(), `1.0.${index}`),
    );
    const before = structuredClone(composition);
    expect(() =>
      applyAnimationPreset(composition, layer, snapshot(definition(), '2.0.0'), 'shift', 'in', {
        durationFrames: 6,
      }),
    ).toThrow('catalog exceeds');
    expect(composition).toEqual(before);
  });

  it('rejects the aggregate catalog byte budget even when every individual definition fits', () => {
    const { composition, layer } = fixture();
    const presets: AnimationPluginPreset[] = Array.from({ length: 32 }, (_, index) => ({
      id: `many${index}`,
      name: 'Many',
      tracks: {
        in: ANIMATION_PRESET_TRACK_PROPERTIES.map((property) => ({
          property,
          mode: 'absolute' as const,
          keys: Array.from({ length: 64 }, (_, key) => ({
            at: key / 63,
            value: key === 63 ? ('on-air' as const) : 0,
            easing: 'elastic-in-out' as const,
          })),
        })),
      },
    }));
    composition.animationPresetPlugins = Array.from({ length: 8 }, (_, index) =>
      createAnimationPresetPluginSnapshot({
        manifest: {
          schemaVersion: 1,
          apiVersion: 1,
          kind: 'animation-presets',
          id: 'test.large',
          version: `1.0.${index}`,
          name: 'Large',
          license: 'MIT',
        },
        presets,
        licenseText: 'MIT',
      }),
    );
    const before = structuredClone(layer);
    expect(() =>
      applyAnimationPreset(composition, layer, snapshot(), 'shift', 'in', { durationFrames: 6 }),
    ).toThrow('8 MiB');
    expect(layer).toEqual(before);
    expect(composition.animationPresetPlugins).toHaveLength(8);
  });

  it('preserves the other side provenance and loop data when native None replaces a plugin entrance', () => {
    const { composition, layer } = fixture();
    const plugin = snapshot();
    applyAnimationPreset(composition, layer, plugin, 'shift', 'in', { durationFrames: 6 });
    applyAnimationPreset(composition, layer, plugin, 'shift', 'out', { durationFrames: 6 });
    const out = structuredClone(layer.animationPresets!.out);
    const outside = structuredClone(layer.animationTracks.x!.filter((key) => key.frame > 12));
    applyLayerMotion(composition, layer, 'in', null);
    expect(layer.animationPresets?.in).toBeUndefined();
    expect(layer.animationPresets?.out).toEqual(out);
    expect(layer.animationTracks.x!.filter((key) => key.frame > 12)).toEqual(outside);
  });
});
