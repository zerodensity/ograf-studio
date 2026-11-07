import { useEffect, useState, type ReactNode } from 'react';
import { createId, parseChartData, type ChartElement } from '@ograf-editor/scene-model';
import { ColorInput } from '../components/ColorInput';
import {
  chartDataFromRows,
  chartRowsForEditing,
  legacyChartData,
  type ChartDataMode,
} from './chartAuthoring';

/** Percentage rows are edited as a draft so their total is validated in one atomic commit. */
export function ChartDataModeEditor({
  data,
  onChange,
  supported,
  children,
}: {
  data: ChartElement['data'];
  onChange: (data: ChartElement['data']) => void;
  supported: boolean;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<ChartDataMode>(data.mode ?? 'metrics');
  const [rows, setRows] = useState(() => chartRowsForEditing(data));
  const [series, setSeries] = useState(data.seriesLabel ?? data.datasets[0]?.label ?? 'Share');
  const [json, setJson] = useState(() => JSON.stringify(data, null, 2));
  const [error, setError] = useState('');
  const signature = JSON.stringify(data);
  useEffect(() => {
    // Only a published data change resets drafts; unrelated presentation edits must preserve them.
    const published = JSON.parse(signature) as ChartElement['data'];
    setMode(published.mode ?? 'metrics');
    setRows(chartRowsForEditing(published));
    setSeries(published.seriesLabel ?? published.datasets[0]?.label ?? 'Share');
    setJson(JSON.stringify(published, null, 2));
    setError('');
  }, [signature]);
  const applyRows = () => {
    try {
      onChange(mode === 'metrics' ? legacyChartData(data) : chartDataFromRows(mode, rows, series));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="chart-data-mode">
      <label className="chart-editor-option">
        <span>Data mode</span>
        <select
          aria-label="Chart data mode"
          value={mode}
          disabled={!supported}
          onChange={(event) => {
            const next = event.target.value as ChartDataMode;
            setMode(next);
            setError('');
            if (next === 'metrics') onChange(legacyChartData(data));
          }}
        >
          <option value="metrics">Independent metrics</option>
          <option value="counts">Counts → share (%)</option>
          <option value="percentages">Percentage distribution</option>
        </select>
      </label>
      {!supported && (
        <p className="chart-editor-label">
          Choose a renderer supporting canonical chart data to use percentage modes.
        </p>
      )}
      {mode === 'metrics' ? (
        children
      ) : (
        <>
          <p className="chart-editor-label">
            {mode === 'counts'
              ? 'Counts are converted to shares using their total.'
              : 'Percentages must total 100% (tolerance 0.000001).'}{' '}
            Labels and bars use the same numeric source.
          </p>
          <label className="chart-editor-option">
            <span>Series</span>
            <input
              aria-label="Canonical chart series"
              value={series}
              maxLength={120}
              onChange={(event) => setSeries(event.target.value)}
            />
          </label>
          <div className="chart-rows" role="group" aria-label="Canonical chart rows">
            {rows.map((row, index) => (
              <div className="chart-row chart-canonical-row" key={row.id}>
                <input
                  aria-label={`Category ${index + 1}`}
                  value={row.label}
                  maxLength={120}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item) =>
                        item.id === row.id ? { ...item, label: event.target.value } : item,
                      ),
                    )
                  }
                />
                <input
                  type="number"
                  min={0}
                  max={mode === 'percentages' ? 100 : undefined}
                  step="any"
                  aria-label={`Source value ${index + 1}`}
                  value={row.value}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item) =>
                        item.id === row.id ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                />
                <ColorInput
                  label={`Canonical row color ${index + 1}`}
                  value={row.color}
                  alpha={false}
                  onChange={(color) =>
                    setRows((current) =>
                      current.map((item) => (item.id === row.id ? { ...item, color } : item)),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove canonical row ${index + 1}`}
                  disabled={rows.length <= 1}
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="chart-data-actions">
            <button
              type="button"
              disabled={rows.length >= 100}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  {
                    id: createId('chart-row'),
                    label: `Item ${current.length + 1}`,
                    value: '0',
                    color: '#2676EF',
                  },
                ])
              }
            >
              + Add row
            </button>
            <button type="button" onClick={applyRows}>
              Apply rows
            </button>
          </div>
          <p className="chart-editor-label">
            Edits remain a draft until Apply rows. Invalid data leaves the displayed chart
            unchanged. Rounded counts may total 99.99%.
          </p>
          <details className="chart-editor-advanced">
            <summary>Advanced · edit canonical JSON</summary>
            <textarea
              aria-label="Canonical chart JSON"
              value={json}
              onChange={(event) => setJson(event.target.value)}
              rows={8}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => {
                try {
                  onChange(parseChartData(json));
                  setError('');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              Apply JSON
            </button>
          </details>
          {error && (
            <p className="chart-editor-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
