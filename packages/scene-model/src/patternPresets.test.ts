import { describe, expect, it } from 'vitest';
import { createTilingPattern, patternRows, patternRowOffset, tilingPatternErrors } from './tiling';
import { tilingSvgContent } from './tilingSvg';
import { createLayerOfKind } from './factory';
import { parseEditablePath } from './pathEditing';
import {
  DEFAULT_PATTERN_PRESET_ID,
  PATTERN_PRESETS,
  getPatternPresetLayout,
  getPatternPresetPatch,
} from './patternPresets';

describe('neutral pattern presets', () => {
  it('offers a dots default and distinct editable motifs without changing legacy defaults', () => {
    const legacy = createTilingPattern();
    const before = structuredClone(legacy);
    expect(DEFAULT_PATTERN_PRESET_ID).toBe('dots');
    expect(PATTERN_PRESETS.map((preset) => preset.id)).toEqual([
      'dots',
      'stripes',
      'chevrons',
      'diamonds',
      'checkerboard',
      'monogram',
    ]);
    const geometry = PATTERN_PRESETS.map((preset) =>
      getPatternPresetPatch(preset.id, 1920, 1080, 25)
        .symbols!.map((source) => source.d)
        .join(' '),
    );
    expect(new Set(geometry).size).toBe(PATTERN_PRESETS.length);
    expect(legacy).toEqual(before);
    expect(legacy.symbols.map((source) => source.key)).toEqual(['O', 'D']);
    expect(legacy.cyclesPerLoop).toBe(3);
  });

  it.each(PATTERN_PRESETS)(
    'builds valid, still, bounded SVG rows for $name and loops seamlessly when enabled',
    (preset) => {
      const patch = getPatternPresetPatch(preset.id, 1920, 1080, 25);
      expect(patch).not.toHaveProperty('id');
      expect(patch).not.toHaveProperty('lighting');
      const pattern = createTilingPattern(patch);
      expect(tilingPatternErrors(pattern)).toEqual([]);
      expect(pattern.cyclesPerLoop).toBe(0);
      expect(pattern.cycleFrames).toBe(200);
      for (const source of pattern.symbols)
        expect(parseEditablePath(source.d).length).toBeGreaterThan(0);
      for (const row of patternRows(pattern)) {
        expect(patternRowOffset(pattern, row, 0)).toBe(patternRowOffset(pattern, row, 500));
        expect(row.period).toBeGreaterThan(0);
      }
      const moving = { ...pattern, cyclesPerLoop: 1 };
      for (const row of patternRows(moving)) {
        expect(patternRowOffset(moving, row, moving.cycleFrames / 4)).not.toBe(
          patternRowOffset(moving, row, 0),
        );
        expect(patternRowOffset(moving, row, moving.cycleFrames)).toBeCloseTo(
          patternRowOffset(moving, row, 0),
          8,
        );
      }
      const layer = createLayerOfKind('pattern');
      if (layer.element.type !== 'pattern') throw new Error('Expected pattern.');
      const svg = tilingSvgContent(
        { ...layer.element, definition: pattern },
        `preset-${preset.id}`,
      );
      expect(svg.match(/<pattern /g)).toHaveLength(pattern.rows);
      expect(svg).not.toContain('undefined');
      expect(svg).not.toContain('NaN');
    },
  );

  it('keeps transparent checker cells and monogram holes in editable compound paths', () => {
    const checker = getPatternPresetPatch('checkerboard', 1080, 1080, 30).symbols![0]!;
    expect(parseEditablePath(checker.d)).toHaveLength(2);
    const legacy = createTilingPattern();
    const monogram = getPatternPresetPatch('monogram', 1920, 1080, 25);
    expect(monogram.symbols).toEqual(legacy.symbols);
    expect(monogram.symbols![0]!.fillRule).toBe('evenodd');
    expect(parseEditablePath(monogram.symbols![0]!.d)).toHaveLength(2);
  });

  it.each([
    [1, 1],
    [1920, 1080],
    [1080, 1920],
    [3840, 2160],
    [16384, 1],
    [1, 16384],
    [16384, 16384],
  ])('fits valid rows into %ix%i canvases', (width, height) => {
    const layout = getPatternPresetLayout(width, height, 29.97);
    expect(layout.rows).toBeGreaterThanOrEqual(1);
    expect(layout.rows).toBeLessThanOrEqual(32);
    expect(
      tilingPatternErrors(createTilingPattern(getPatternPresetPatch('dots', width, height, 29.97))),
    ).toEqual([]);
    const rows = patternRows(
      createTilingPattern(getPatternPresetPatch('dots', width, height, 29.97)),
    );
    expect(rows.at(-1)!.y + rows.at(-1)!.height).toBeCloseTo(height);
    expect(layout).not.toHaveProperty('symbols');
  });

  it('returns independent patches and leaves resource identity/lighting intact when applied', () => {
    const first = getPatternPresetPatch('dots', 1920, 1080, 25);
    first.symbols![0]!.d = 'M0 0';
    first.sequence![0]!.gapScale = 99;
    first.rowOverrides!.push({ row: 0, phase: 0.5 });
    const next = getPatternPresetPatch('dots', 1920, 1080, 25);
    expect(next.symbols![0]!.d).not.toBe(first.symbols![0]!.d);
    expect(next.sequence![0]!.gapScale).toBe(1);
    expect(next.rowOverrides).toEqual([]);
    const lighting = {
      enabled: true,
      cycleFrames: 100,
      phase: 0,
      intensity: 1,
      glow: 1,
      softness: 1,
    };
    const existing = createTilingPattern({ lighting });
    const updated = { ...existing, ...next };
    expect(updated.id).toBe(existing.id);
    expect(updated.lighting).toBe(lighting);
  });

  it('rejects unknown presets and invalid canvas/timing inputs clearly', () => {
    expect(() => getPatternPresetPatch('missing', 1920, 1080, 25)).toThrow(
      /Unknown pattern preset/,
    );
    expect(() => getPatternPresetLayout(0, 1080, 25)).toThrow(/width/);
    expect(() => getPatternPresetLayout(1920, Number.NaN, 25)).toThrow(/height/);
    expect(() => getPatternPresetLayout(1920, 1080, 0)).toThrow(/frame rate/);
    expect(() => getPatternPresetLayout(1920, 1080, Number.POSITIVE_INFINITY)).toThrow(
      /frame rate/,
    );
  });
});
