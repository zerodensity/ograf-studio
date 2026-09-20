import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PATTERN_PRESETS,
  createTilingPattern,
  getPatternPresetPatch,
  patternRows,
  type PatternSymbol,
  type TilingPattern,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { importPatternSvg, patternSymbolFromLayer } from '../state/patternSymbols';
import { PatternPreview } from './PatternPreview';
import { TilingPatternAdvancedEditor } from './TilingPatternAdvancedEditor';
import './TilingPatternEditor.css';

function SymbolPreview({ symbol }: { symbol: PatternSymbol }) {
  return (
    <svg
      className="pattern-symbol-preview"
      viewBox={`0 0 ${symbol.viewBoxWidth} ${symbol.viewBoxHeight}`}
      role="img"
      aria-label={`${symbol.key} symbol`}
    >
      <path d={symbol.d} fill="currentColor" fillRule={symbol.fillRule} />
    </svg>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  hint?: string;
}) {
  const formatted = String(Number(value.toFixed(3)));
  const [draft, setDraft] = useState(formatted);
  useEffect(() => setDraft(formatted), [formatted]);
  const commit = () => {
    if (draft === formatted) return;
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number)) {
      const next = Math.max(min, Math.min(max, step === 1 ? Math.round(number) : number));
      if (Math.abs(next - value) > 1e-6) onChange(next);
      // A rejected shared-resource edit must not leave an uncommitted number displayed here.
      // Successful writes deliver the new formatted prop through the effect above.
      setDraft(formatted);
    } else setDraft(formatted);
  };
  return (
    <label className="pattern-control" title={hint}>
      <span>{label}</span>
      <input
        type="number"
        aria-label={`Pattern ${label}`}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="pattern-control pattern-control-range">
      <span>{label}</span>
      <div>
        <input
          type="range"
          aria-label={`Pattern ${label}`}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output>{Math.round(value * 100)}%</output>
      </div>
    </label>
  );
}

/** Visual editing of one shared resource; only deliberate presets/replacements change its source. */
export function TilingPatternEditor({
  pattern,
  frameRate,
}: {
  pattern: TilingPattern;
  frameRate: number;
}) {
  const composition = useActiveComposition();
  const setPattern = useProjectStore((state) => state.setTilingPattern);
  const selectedIds = useSelectionStore((state) => state.selectedLayerIds);
  const selectedId = useSelectionStore((state) => state.selectedLayerId);
  const selected =
    selectedIds.length === 1
      ? composition.layers.find((layer) => layer.id === selectedId)
      : undefined;
  const canUseSelected =
    !!selected && ['rectangle', 'ellipse', 'path'].includes(selected.element.type);
  const selectionHint = canUseSelected
    ? `Copy the shape of ${selected!.name}.`
    : 'Select one rectangle, ellipse, or path on the canvas first.';
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const importTarget = useRef<string | null>(null);
  const version = useRef(0);
  const current = useRef(pattern);
  current.current = pattern;
  useEffect(() => {
    const invalidatePendingImport = () => {
      version.current++;
    };
    invalidatePendingImport();
    setError('');
    setImporting(false);
    return invalidatePendingImport;
  }, [pattern.id, composition.id]);
  const presets = useMemo(
    () =>
      PATTERN_PRESETS.map((preset) => ({
        ...preset,
        pattern: createTilingPattern({
          ...getPatternPresetPatch(preset.id, pattern.width, pattern.height, frameRate),
          id: `preset-${preset.id}`,
        }),
      })),
    [pattern.width, pattern.height, frameRate],
  );
  const geometry = JSON.stringify([pattern.symbols, pattern.sequence]);
  const rows = patternRows(pattern);
  const rowSize = rows[0]?.height ?? pattern.rowHeight;
  const animated = rows.some((row) => row.cycles > 0);
  const update = (patch: Partial<TilingPattern>) => {
    try {
      setPattern(patch, pattern.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const nextKey = () => {
    let index = 1;
    while (current.current.symbols.some((symbol) => symbol.key === `Shape${index}`)) index++;
    return `Shape${index}`;
  };
  const replaceSymbol = (symbol: PatternSymbol, append = false) => {
    const source = current.current;
    if (!append && !source.symbols.some((entry) => entry.key === symbol.key))
      throw new Error('This symbol was removed while editing. Choose another symbol.');
    setPattern(
      {
        symbols: append
          ? [...source.symbols, symbol]
          : source.symbols.map((entry) => (entry.key === symbol.key ? symbol : entry)),
        ...(append && source.sequence.length < 64
          ? { sequence: [...source.sequence, { symbolKey: symbol.key, gapScale: 1 }] }
          : {}),
      },
      source.id,
    );
    version.current++;
    setImporting(false);
  };
  const sizePatch = (size: number, rowGap = pattern.rowGap) => ({
    fitRows: false,
    rowHeight: size,
    rowGap,
    rows: Math.min(
      32,
      Math.max(1, Math.floor((pattern.height - pattern.offsetY * 2 + rowGap) / (size + rowGap))),
    ),
  });
  const builtin = (name: string, key: string): PatternSymbol => {
    const paths: Record<string, string> = {
      circle: 'M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z',
      square: 'M0 0H100V100H0Z',
      diamond: 'M50 0L100 50L50 100L0 50Z',
      triangle: 'M50 0L100 100H0Z',
      chevron: 'M0 0L50 35L100 0V55L50 90L0 55Z',
    };
    return {
      key,
      d: paths[name] ?? paths.square!,
      viewBoxWidth: 100,
      viewBoxHeight: 100,
      width: 100,
      height: 100,
      fillRule: 'nonzero',
    };
  };
  const selectSource = (key: string, append = false) =>
    run(() => {
      if (!selected || !canUseSelected) throw new Error(selectionHint);
      replaceSymbol(
        patternSymbolFromLayer(selected, useTimelineStore.getState().currentFrame, key),
        append,
      );
    });
  const moveEntry = (index: number, delta: number) => {
    const sequence = [...pattern.sequence];
    [sequence[index], sequence[index + delta]] = [sequence[index + delta]!, sequence[index]!];
    update({ sequence });
  };

  return (
    <div className="tiling-pattern-editor">
      <p className="pattern-editor-hint">
        Shared geometry and motion. Edits update every linked pattern; each layer keeps its own Fill
        and Outline.
      </p>
      <label className="pattern-control">
        <span>Name</span>
        <input
          aria-label="Pattern name"
          value={pattern.name}
          onChange={(event) => update({ name: event.target.value })}
        />
      </label>
      <PatternPreview pattern={pattern} frameRate={frameRate} showControls />

      <details className="pattern-preset-picker" aria-label="Pattern presets">
        <summary>Change preset</summary>
        <div className="pattern-presets">
          {presets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className="pattern-preset"
              aria-pressed={
                geometry === JSON.stringify([preset.pattern.symbols, preset.pattern.sequence])
              }
              title={`${preset.description} Replaces the symbols, arrangement, and motion; keeps this resource's name and lighting.`}
              onClick={() => {
                version.current++;
                setImporting(false);
                update({
                  ...getPatternPresetPatch(preset.id, pattern.width, pattern.height, frameRate),
                  name: pattern.name,
                });
              }}
            >
              <PatternPreview pattern={preset.pattern} frameRate={frameRate} />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
        <p className="pattern-editor-hint">
          A preset replaces the arrangement and symbols. The controls below keep your existing
          shapes.
        </p>
      </details>

      <section className="pattern-editor-section" aria-label="Pattern layout">
        <h3>Layout</h3>
        <div className="pattern-controls-grid">
          <NumberControl
            label="Symbol size"
            value={rowSize}
            min={1}
            max={4096}
            onChange={(size) => update(sizePatch(size))}
            hint="Symbol height in pixels. The row count adjusts to fit the canvas."
          />
          <NumberControl
            label="Rows"
            value={pattern.rows}
            min={1}
            max={32}
            onChange={(count) =>
              update({
                rows: count,
                fitRows: true,
                rowGap: Math.min(
                  pattern.rowGap,
                  count > 1
                    ? Math.max(0, (pattern.height - pattern.offsetY * 2 - count) / (count - 1))
                    : pattern.rowGap,
                ),
              })
            }
            hint="Fits this number of rows into the pattern; symbol height adjusts automatically."
          />
          <NumberControl
            label="Horizontal gap"
            value={pattern.gap}
            min={0}
            max={4096}
            onChange={(gap) => update({ gap })}
          />
          <NumberControl
            label="Vertical gap"
            value={pattern.rowGap}
            min={0}
            max={4096}
            onChange={(gap) =>
              update(
                pattern.fitRows
                  ? {
                      rowGap: Math.min(
                        gap,
                        pattern.rows > 1
                          ? Math.max(
                              0,
                              (pattern.height - pattern.offsetY * 2 - pattern.rows) /
                                (pattern.rows - 1),
                            )
                          : gap,
                      ),
                    }
                  : sizePatch(pattern.rowHeight, gap),
              )
            }
          />
        </div>
        <RangeControl
          label="Stagger"
          value={Math.max(0, Math.min(0.5, pattern.rowPhaseStep))}
          min={0}
          max={0.5}
          onChange={(rowPhaseStep) => update({ rowPhaseStep })}
        />
        {pattern.rowPhaseStep < 0 || pattern.rowPhaseStep > 0.5 ? (
          <p className="pattern-editor-hint">
            Custom stagger: {pattern.rowPhaseStep} turns. Advanced preserves the full range.
          </p>
        ) : null}
        <div className="pattern-variation">
          <RangeControl
            label="Variation"
            value={pattern.spacingVariation}
            min={0}
            max={1}
            onChange={(spacingVariation) => update({ spacingVariation })}
          />
          <button
            type="button"
            disabled={pattern.spacingVariation === 0}
            title={
              pattern.spacingVariation === 0
                ? 'Increase Variation to shuffle the spacing.'
                : 'Choose a new repeatable spacing arrangement.'
            }
            onClick={() => update({ seed: (pattern.seed + 1) % 2147483648 })}
          >
            Shuffle
          </button>
        </div>
      </section>

      <section className="pattern-editor-section" aria-label="Pattern motion">
        <h3>Motion</h3>
        <label className="pattern-toggle">
          <input
            type="checkbox"
            checked={animated}
            onChange={(event) =>
              update({
                cyclesPerLoop: event.target.checked ? Math.max(1, pattern.cyclesPerLoop) : 0,
                rowOverrides: pattern.rowOverrides.map(({ cycles: _cycles, ...row }) => row),
              })
            }
          />
          Animate all rows
        </label>
        <div className="pattern-controls-grid">
          <label className="pattern-control">
            <span>Direction</span>
            <select
              aria-label="Pattern direction"
              disabled={!animated}
              value={pattern.direction}
              onChange={(event) =>
                update({ direction: event.target.value as TilingPattern['direction'] })
              }
            >
              <option value="alternate">Alternate</option>
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </label>
          <NumberControl
            label="Loop duration (s)"
            value={pattern.cycleFrames / frameRate}
            min={1 / frameRate}
            max={1000000 / frameRate}
            step={0.1}
            disabled={!animated}
            onChange={(seconds) =>
              update({ cycleFrames: Math.max(1, Math.round(seconds * frameRate)) })
            }
          />
        </div>
        <p className="pattern-editor-hint">
          Shorter loops move faster. Preview Play is separate from the scene timeline.
        </p>
      </section>

      <section className="pattern-editor-section" aria-label="Pattern symbols">
        <h3>Shapes</h3>
        <div className="pattern-symbols">
          {pattern.symbols.map((symbol) => (
            <div className="pattern-symbol-card" key={symbol.key}>
              <SymbolPreview symbol={symbol} />
              <div className="pattern-symbol-tools">
                <strong>{symbol.key}</strong>
                <select
                  aria-label={`Replace ${symbol.key} with a built-in shape`}
                  value=""
                  onChange={(event) => {
                    if (event.target.value)
                      run(() => replaceSymbol(builtin(event.target.value, symbol.key)));
                  }}
                >
                  <option value="">Replace shape…</option>
                  <option value="circle">Circle</option>
                  <option value="square">Square</option>
                  <option value="diamond">Diamond</option>
                  <option value="triangle">Triangle</option>
                  <option value="chevron">Chevron</option>
                </select>
                <div className="pattern-button-row">
                  <button
                    type="button"
                    disabled={!canUseSelected}
                    title={selectionHint}
                    onClick={() => selectSource(symbol.key)}
                  >
                    Use selected shape
                  </button>
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => {
                      importTarget.current = symbol.key;
                      input.current?.click();
                    }}
                  >
                    Import SVG
                  </button>
                </div>
                <button
                  type="button"
                  disabled={
                    pattern.sequence.some((entry) => entry.symbolKey === symbol.key) ||
                    pattern.symbols.length === 1
                  }
                  title={
                    pattern.sequence.some((entry) => entry.symbolKey === symbol.key)
                      ? 'Remove this shape from the sequence first.'
                      : 'Remove this unused shape.'
                  }
                  onClick={() =>
                    update({ symbols: pattern.symbols.filter((entry) => entry.key !== symbol.key) })
                  }
                >
                  Remove shape
                </button>
              </div>
            </div>
          ))}
        </div>
        {!canUseSelected && <p className="pattern-editor-hint">{selectionHint}</p>}
        <div className="pattern-button-row">
          <button
            type="button"
            disabled={pattern.symbols.length >= 32}
            onClick={() => run(() => replaceSymbol(builtin('square', nextKey()), true))}
          >
            Add shape
          </button>
          <button
            type="button"
            disabled={!canUseSelected || pattern.symbols.length >= 32}
            title={selectionHint}
            onClick={() => selectSource(nextKey(), true)}
          >
            Add selected shape
          </button>
        </div>
        <h4>Repeating sequence</h4>
        <div className="pattern-sequence">
          {pattern.sequence.map((entry, index) => {
            const symbol = pattern.symbols.find((candidate) => candidate.key === entry.symbolKey)!;
            return (
              <div className="pattern-sequence-entry" key={`${index}:${entry.symbolKey}`}>
                <SymbolPreview symbol={symbol} />
                <span>{symbol.key}</span>
                <div>
                  <button
                    type="button"
                    aria-label={`Move sequence item ${index + 1} left`}
                    disabled={index === 0}
                    onClick={() => moveEntry(index, -1)}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label={`Move sequence item ${index + 1} right`}
                    disabled={index === pattern.sequence.length - 1}
                    onClick={() => moveEntry(index, 1)}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove sequence item ${index + 1}`}
                    disabled={pattern.sequence.length <= 1}
                    onClick={() =>
                      update({ sequence: pattern.sequence.filter((_, at) => at !== index) })
                    }
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="pattern-sequence-add">
          <span>Append:</span>
          {pattern.symbols.map((symbol) => (
            <button
              type="button"
              key={symbol.key}
              title={`Append ${symbol.key} to the repeating sequence`}
              disabled={pattern.sequence.length >= 64}
              onClick={() =>
                update({ sequence: [...pattern.sequence, { symbolKey: symbol.key, gapScale: 1 }] })
              }
            >
              <SymbolPreview symbol={symbol} />
              {symbol.key} +
            </button>
          ))}
        </div>
      </section>

      <details className="pattern-advanced">
        <summary>
          Advanced · source data, rows &amp; lighting
          {pattern.rowOverrides.length ? ` (${pattern.rowOverrides.length} row overrides)` : ''}
        </summary>
        <p className="pattern-editor-hint">
          Individual row overrides keep their own settings when shared controls change.
        </p>
        <TilingPatternAdvancedEditor pattern={pattern} frameRate={frameRate} />
      </details>
      {error && (
        <p className="pattern-editor-error" role="alert">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept=".svg,image/svg+xml"
        hidden
        aria-label="Import pattern SVG"
        onChange={(event) => {
          const file = event.target.files?.[0],
            key = importTarget.current;
          event.target.value = '';
          importTarget.current = null;
          if (!file || !key) return;
          if (file.size > 256 * 1024) {
            setError('Choose an SVG no larger than 256 KB.');
            return;
          }
          const request = ++version.current,
            targetId = pattern.id;
          setImporting(true);
          void file
            .text()
            .then((text) => {
              if (request !== version.current || current.current.id !== targetId) return;
              replaceSymbol(importPatternSvg(text, key));
              setError('');
            })
            .catch((cause: unknown) => {
              if (request === version.current)
                setError(cause instanceof Error ? cause.message : String(cause));
            })
            .finally(() => {
              if (request === version.current) setImporting(false);
            });
        }}
      />
    </div>
  );
}
