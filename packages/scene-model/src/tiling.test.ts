import { describe, expect, it } from 'vitest';
import { createProject, createLayerOfKind } from './factory';
import {
  createTilingPattern,
  patternRows,
  patternRowOffset,
  setTilingPattern,
  addTilingPatternLayer,
  removeTilingPattern,
  tilingPatternErrors,
} from './tiling';
import { tilingSvgContent } from './tilingSvg';

describe('procedural tiling', () => {
  it('repeats seeded spacing exactly and changes it deliberately with the seed', () => {
    const p = createTilingPattern();
    expect(patternRows(p)).toEqual(patternRows(structuredClone(p)));
    expect(patternRows({ ...p, seed: 9 })).not.toEqual(patternRows(p));
    expect(patternRows({ ...p, phase: 0.4 }).map((r) => r.entries)).toEqual(
      patternRows(p).map((r) => r.entries),
    );
  });
  it('returns every row to its starting offset at the common loop boundary', () => {
    const p = createTilingPattern({
      rowOverrides: [
        { row: 0, cycles: 7, phase: 0.123, widthScale: 1.07 },
        { row: 2, cycles: 0 },
      ],
    });
    for (const row of patternRows(p))
      expect(patternRowOffset(p, row, p.cycleFrames)).toBeCloseTo(patternRowOffset(p, row, 0), 8);
    const fixed = patternRows(p)[2]!;
    expect(patternRowOffset(p, fixed, 200)).toBe(patternRowOffset(p, fixed, 1000));
    const row = patternRows(p)[0]!;
    const fast = { ...p, cycleFrames: p.cycleFrames / 2 };
    expect(patternRowOffset(fast, row, 50) - patternRowOffset(fast, row, 0)).toBeCloseTo(
      2 * (patternRowOffset(p, row, 50) - patternRowOffset(p, row, 0)),
    );
  });
  it('applies master phase even to explicitly phased rows', () => {
    const p = createTilingPattern({ phase: 0.1, rowOverrides: [{ row: 0, phase: 0.2 }] });
    expect(patternRows(p)[0]!.phase).toBeCloseTo(0.3);
  });
  it('keeps instances small and shared while edits leave authored tracks untouched', () => {
    const c = createProject().compositions[0]!,
      p = setTilingPattern(c, {});
    addTilingPatternLayer(c, p.id);
    addTilingPatternLayer(c, p.id);
    const before = structuredClone(c.layers);
    setTilingPattern(c, { rows: 20, gap: 80, cycleFrames: 2400 }, p.id);
    expect(c.layers).toEqual(before);
    expect(c.layers).toHaveLength(2);
    expect(c.patterns).toHaveLength(1);
    expect(() => removeTilingPattern(c, p.id)).toThrow('Remove or relink');
    c.layers = [];
    removeTilingPattern(c, p.id);
    expect(c.patterns).toEqual([]);
  });
  it('rejects unknown symbols, duplicate source keys and invalid row overrides atomically', () => {
    const c = createProject().compositions[0]!,
      p = setTilingPattern(c, {}),
      before = structuredClone(c.patterns);
    expect(() =>
      setTilingPattern(c, { sequence: [{ symbolKey: 'missing', gapScale: 1 }] }, p.id),
    ).toThrow('Unknown sequence');
    expect(c.patterns).toEqual(before);
    expect(
      tilingPatternErrors({ ...p, symbols: [p.symbols[0]!, p.symbols[0]!] }).join(' '),
    ).toContain('unique');
    expect(tilingPatternErrors({ ...p, rowOverrides: [{ row: 99 }] }).join(' ')).toContain(
      'active row',
    );
  });
  it('shrinks row overrides with row count and retains the editable symbol sources', () => {
    const c = createProject().compositions[0]!,
      p = setTilingPattern(c, {
        rowOverrides: [
          { row: 1, cycles: 5 },
          { row: 6, phase: 0.9 },
        ],
      });
    const updated = setTilingPattern(c, { rows: 2 }, p.id);
    expect(updated.rowOverrides).toEqual([{ row: 1, cycles: 5 }]);
    expect(updated.symbols).toEqual(p.symbols);
  });
  it('renders bounded SVG pattern rows rather than materializing tile copies', () => {
    const layer = createLayerOfKind('pattern');
    if (layer.element.type !== 'pattern') throw Error();
    const p = createTilingPattern({ rows: 3 });
    const markup = tilingSvgContent({ ...layer.element, definition: p }, 'test', 300);
    expect(markup.match(/<pattern /g) ?? []).toHaveLength(3);
    expect(markup).toContain('patternUnits="userSpaceOnUse"');
    expect(markup).toContain('fill-rule="evenodd"');
    expect(markup).not.toContain('foreignObject');
  });
});
