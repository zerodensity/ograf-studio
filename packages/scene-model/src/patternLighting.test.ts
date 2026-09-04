import { describe, expect, it } from 'vitest';
import { createProject, createLayerOfKind, createLayerLoopClip } from './factory';
import { setTilingPattern, removeTilingPattern, patternRows, patternRowOffset } from './tiling';
import {
  createPatternLighting,
  setLayerLighting,
  layerLightingErrors,
  patternLightLoopFrame,
} from './patternLighting';
import { migrateProject } from './migrations';

describe('shared pattern lighting authoring', () => {
  it('merges partial controls without changing geometry, colors or source animation', () => {
    const c = createProject().compositions[0]!;
    const p = setTilingPattern(c, { lighting: { cycleFrames: 1200, intensity: 0.7 } });
    const layer = createLayerOfKind('rectangle');
    layer.loop = createLayerLoopClip({ durationFrames: 100 });
    c.layers.push(layer);
    setLayerLighting(c, layer.id, {
      patternId: p.id,
      role: 'light',
      phaseOffset: 0,
      gain: 1,
      cyclesPerLoop: 2,
    });
    const before = structuredClone(layer);
    const rowBefore = patternRows(p).map((row) => patternRowOffset(p, row, 123));
    const updated = setTilingPattern(c, { lighting: { phase: 0.25 } }, p.id);
    expect(updated.lighting).toEqual({
      ...createPatternLighting(1200),
      intensity: 0.7,
      phase: 0.25,
    });
    expect(layer).toEqual(before);
    expect(patternRows(updated).map((row) => patternRowOffset(updated, row, 123))).toEqual(
      rowBefore,
    );
  });
  it('preserves different existing sweep speeds under a common cycle', () => {
    for (const durationFrames of [600, 800, 1200, 1600]) {
      const loop = createLayerLoopClip({ durationFrames, phaseOffsetFrames: 27 });
      const link = {
        patternId: 'p',
        role: 'light' as const,
        phaseOffset: 0,
        gain: 1,
        cyclesPerLoop: 4800 / durationFrames,
      };
      for (const frame of [0, 3, 500, 1111, 4800, 9127]) {
        expect(patternLightLoopFrame(loop, createPatternLighting(4800), link, frame)).toBeCloseTo(
          (frame + 27) % durationFrames,
          8,
        );
      }
    }
  });
  it('rejects invalid timing, finite or step loops, and deleting referenced controllers', () => {
    const c = createProject().compositions[0]!;
    const p = setTilingPattern(c, { lighting: {} });
    const layer = createLayerOfKind('rectangle');
    c.layers.push(layer);
    const link = {
      patternId: p.id,
      role: 'glow' as const,
      phaseOffset: 0,
      gain: 1,
      cyclesPerLoop: 1,
    };
    expect(() => setTilingPattern(c, { lighting: { cycleFrames: 0 } }, p.id)).toThrow();
    layer.loop = createLayerLoopClip({ repeatCount: 3 });
    expect(() => setLayerLighting(c, layer.id, link)).toThrow('infinite lifecycle');
    layer.loop = null;
    setLayerLighting(c, layer.id, link);
    expect(() => removeTilingPattern(c, p.id)).toThrow('relink');
    expect(() => setTilingPattern(c, { lighting: null }, p.id)).toThrow(
      'missing pattern controller',
    );
    expect(
      layerLightingErrors({ ...layer, lighting: { ...link, cyclesPerLoop: 1.2 } }, c.patterns),
    ).not.toHaveLength(0);
    setLayerLighting(c, layer.id, null);
    removeTilingPattern(c, p.id);
    expect(c.patterns).toHaveLength(0);
  });
  it('migrates old graphics without adding active lighting and retains explicit new links', () => {
    const old = createProject();
    old.documentVersion = 28;
    const p = setTilingPattern(old.compositions[0]!, {});
    const migrated = migrateProject(old);
    expect(migrated.documentVersion).toBe(31);
    expect(migrated.compositions[0]!.patterns[0]).toEqual(p);
    expect(migrated.compositions[0]!.patterns[0]!.lighting).toBeUndefined();
    setTilingPattern(old.compositions[0]!, { lighting: {} }, p.id);
    const layer = createLayerOfKind('rectangle');
    old.compositions[0]!.layers.push(layer);
    setLayerLighting(old.compositions[0]!, layer.id, {
      patternId: p.id,
      role: 'light',
      phaseOffset: 0.2,
      gain: 1,
      cyclesPerLoop: 2,
    });
    expect(migrateProject(old).compositions[0]!.layers[0]!.lighting).toEqual(layer.lighting);
  });
});
