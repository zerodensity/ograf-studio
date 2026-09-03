import { useEffect, useState } from 'react';
import {
  patternRows,
  type TilingPattern,
  type PatternRowOverride,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';

export function TilingPatternEditor({
  pattern,
  frameRate,
}: {
  pattern: TilingPattern;
  frameRate: number;
}) {
  const setPattern = useProjectStore((s) => s.setTilingPattern);
  const [error, setError] = useState('');
  const sequenceText = pattern.sequence.map((entry) => entry.symbolKey).join(', ');
  const [sequence, setSequence] = useState(sequenceText);
  useEffect(() => setSequence(sequenceText), [sequenceText]);
  const update = (patch: Partial<TilingPattern>) => {
    try {
      setPattern(patch, pattern.id);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const number = (label: string, key: keyof TilingPattern, min: number, max: number, step = 1) => (
    <label className="inspector-row" key={key}>
      <span>{label}</span>
      <input
        aria-label={`Pattern ${label}`}
        type="number"
        min={min}
        max={max}
        step={step}
        value={
          key === 'rowHeight' && pattern.fitRows
            ? Number(rows[0]!.height.toFixed(2))
            : (pattern[key] as number)
        }
        disabled={key === 'rowHeight' && pattern.fitRows}
        onChange={(e) => update({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  const rows = patternRows(pattern);
  const override = (row: number, patch: Partial<PatternRowOverride>) => {
    const current = pattern.rowOverrides.find((o) => o.row === row) ?? { row };
    update({
      rowOverrides: [
        ...pattern.rowOverrides.filter((o) => o.row !== row),
        { ...current, ...patch },
      ],
    });
  };
  return (
    <div>
      <p className="inspector-hint">
        Shared source and motion. Changes update every linked pattern layer, including outlines and
        masks.
      </p>
      <label className="inspector-row">
        <span>Pattern name</span>
        <input value={pattern.name} onChange={(e) => update({ name: e.target.value })} />
      </label>
      <label className="inspector-row">
        <span>Fit rows to height</span>
        <input
          aria-label="Pattern fit rows"
          type="checkbox"
          checked={pattern.fitRows}
          onChange={(e) => update({ fitRows: e.target.checked })}
        />
      </label>
      {number('Rows', 'rows', 1, 32)}
      {number('Canvas width', 'width', 1, 16384)}
      {number('Canvas height', 'height', 1, 16384)}
      {number('Row height', 'rowHeight', 1, 4096)}
      {number('Row gap', 'rowGap', 0, 4096)}
      {number('Spacing', 'gap', 0, 4096)}
      {number('Spacing variation', 'spacingVariation', 0, 1, 0.05)}
      {number('Seed', 'seed', 0, 2147483647)}
      <label className="inspector-row">
        <span>Row direction</span>
        <select
          aria-label="Pattern direction"
          value={pattern.direction}
          onChange={(e) => update({ direction: e.target.value as TilingPattern['direction'] })}
        >
          <option value="alternate">Alternate right / left</option>
          <option value="right">All right</option>
          <option value="left">All left</option>
        </select>
      </label>
      {number('Cycle frames', 'cycleFrames', 1, 1000000)}
      <p className="inspector-hint">
        {(pattern.cycleFrames / frameRate).toFixed(3)} seconds per complete loop. Shorter cycles
        move faster.
      </p>
      <div className="resources-tree-toolbar">
        <button
          disabled={pattern.cycleFrames * 2 > 1000000}
          onClick={() => update({ cycleFrames: pattern.cycleFrames * 2 })}
        >
          ½ speed
        </button>
        <button
          disabled={pattern.cycleFrames < 2 || pattern.cycleFrames % 2 !== 0}
          onClick={() => update({ cycleFrames: pattern.cycleFrames / 2 })}
        >
          2× speed
        </button>
      </div>
      {number('Cycles per row', 'cyclesPerLoop', 0, 32)}
      {number('Speed variation', 'speedVariation', 0, 1, 0.05)}
      {number('Phase', 'phase', -16384, 16384, 0.01)}
      {number('Row phase step', 'rowPhaseStep', -16384, 16384, 0.01)}
      {number('Offset X', 'offsetX', -16384, 16384)}
      {number('Offset Y', 'offsetY', -16384, 16384)}
      <details>
        <summary>Source symbols and sequence</summary>
        <label className="inspector-row inspector-row-stacked">
          <span>Sequence (symbol keys)</span>
          <input
            aria-label="Pattern sequence"
            value={sequence}
            onChange={(e) => setSequence(e.target.value)}
            onBlur={() =>
              update({
                sequence: sequence.split(',').map((key, index) => ({
                  symbolKey: key.trim(),
                  gapScale: pattern.sequence[index]?.gapScale ?? 1,
                })),
              })
            }
          />
        </label>
        {pattern.sequence.map((entry, index) => (
          <label className="inspector-row" key={index}>
            <span>
              {index + 1}. {entry.symbolKey} gap scale
            </span>
            <input
              type="number"
              aria-label={`Pattern gap scale ${index + 1}`}
              min={0}
              max={100}
              step={0.1}
              value={entry.gapScale}
              onChange={(e) =>
                update({
                  sequence: pattern.sequence.map((v, i) =>
                    i === index ? { ...v, gapScale: Number(e.target.value) } : v,
                  ),
                })
              }
            />
          </label>
        ))}
        {pattern.symbols.map((symbol, index) => (
          <details key={symbol.key}>
            <summary>{symbol.key}</summary>
            <label className="inspector-row inspector-row-stacked">
              <span>SVG path</span>
              <textarea
                aria-label={`Pattern symbol ${symbol.key} path`}
                rows={3}
                value={symbol.d}
                onChange={(e) =>
                  update({
                    symbols: pattern.symbols.map((v, i) =>
                      i === index ? { ...v, d: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            {(['width', 'height', 'viewBoxWidth', 'viewBoxHeight'] as const).map((key) => (
              <label className="inspector-row" key={key}>
                <span>{key}</span>
                <input
                  type="number"
                  min={1}
                  value={symbol[key]}
                  onChange={(e) =>
                    update({
                      symbols: pattern.symbols.map((v, i) =>
                        i === index ? { ...v, [key]: Number(e.target.value) } : v,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <label className="inspector-row">
              <span>Fill rule</span>
              <select
                value={symbol.fillRule}
                onChange={(e) =>
                  update({
                    symbols: pattern.symbols.map((v, i) =>
                      i === index ? { ...v, fillRule: e.target.value as 'evenodd' | 'nonzero' } : v,
                    ),
                  })
                }
              >
                <option value="evenodd">Even-odd</option>
                <option value="nonzero">Nonzero</option>
              </select>
            </label>
            <button
              disabled={pattern.sequence.some((e) => e.symbolKey === symbol.key)}
              onClick={() => update({ symbols: pattern.symbols.filter((_, i) => i !== index) })}
            >
              Remove symbol
            </button>
          </details>
        ))}
        <button
          disabled={pattern.symbols.length >= 32}
          onClick={() => {
            let n = 1;
            while (pattern.symbols.some((s) => s.key === `Shape${n}`)) n++;
            update({
              symbols: [
                ...pattern.symbols,
                {
                  key: `Shape${n}`,
                  d: 'M0 0 H100 V100 H0 Z',
                  viewBoxWidth: 100,
                  viewBoxHeight: 100,
                  width: 100,
                  height: 100,
                  fillRule: 'nonzero',
                },
              ],
            });
          }}
        >
          Add symbol
        </button>
      </details>
      <details>
        <summary>Per-row controls</summary>
        {rows.map((row) => {
          const local = pattern.rowOverrides.find((o) => o.row === row.row);
          return (
            <details key={row.row}>
              <summary>
                Row {row.row + 1} · {row.direction > 0 ? '→' : '←'}{' '}
                {((row.period * row.cycles * frameRate) / pattern.cycleFrames).toFixed(2)} px/s
              </summary>
              <label className="inspector-row">
                <span>Direction</span>
                <select
                  value={local?.direction ?? ''}
                  onChange={(e) =>
                    override(row.row, {
                      direction: (e.target.value || undefined) as PatternRowOverride['direction'],
                    })
                  }
                >
                  <option value="">Shared direction</option>
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                </select>
              </label>
              <label className="inspector-row">
                <span>Cycles</span>
                <input
                  type="number"
                  min={0}
                  max={64}
                  value={row.cycles}
                  onChange={(e) => override(row.row, { cycles: Number(e.target.value) })}
                />
              </label>
              <label className="inspector-row">
                <span>Phase</span>
                <input
                  type="number"
                  step={0.01}
                  value={local?.phase ?? row.row * pattern.rowPhaseStep}
                  onChange={(e) => override(row.row, { phase: Number(e.target.value) })}
                />
              </label>
              <label className="inspector-row">
                <span>Width scale</span>
                <input
                  type="number"
                  min={0.05}
                  max={20}
                  step={0.01}
                  value={local?.widthScale ?? 1}
                  onChange={(e) => override(row.row, { widthScale: Number(e.target.value) })}
                />
              </label>
              <label className="inspector-row">
                <span>Soft focus</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={row.blur}
                  onChange={(e) => override(row.row, { blur: Number(e.target.value) })}
                />
              </label>
              <button
                onClick={() =>
                  update({ rowOverrides: pattern.rowOverrides.filter((o) => o.row !== row.row) })
                }
              >
                Reset row to shared controls
              </button>
            </details>
          );
        })}
      </details>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
