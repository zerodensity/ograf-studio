import { useState, type ReactNode } from 'react';
import {
  chartPresentationErrors,
  type ChartElement,
  type ChartPresentation,
} from '@ograf-editor/scene-model';
import { ColorInput } from '../components/ColorInput';

function NumberSetting({
  value,
  label,
  onChange,
  min,
  max,
}: {
  value: number | undefined;
  label: string;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      aria-label={label}
      key={String(value)}
      defaultValue={value ?? ''}
      placeholder="Auto"
      min={min}
      max={max}
      onBlur={(event) => {
        if (!event.target.value.trim()) onChange(undefined);
        else if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="chart-editor-option">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function ChartPresentationEditor({
  element,
  onChange,
  supported,
  morphSupported,
}: {
  element: ChartElement;
  onChange: (patch: Partial<ChartElement>) => void;
  supported: boolean;
  morphSupported: boolean;
}) {
  const [error, setError] = useState('');
  const presentation = element.presentation ?? {};
  const canonical = !!element.data.mode;
  const patch = (values: Partial<ChartPresentation>) => {
    const next = { ...presentation, ...values };
    for (const key of Object.keys(next) as Array<keyof ChartPresentation>)
      if (next[key] === undefined) delete next[key];
    const issues = chartPresentationErrors(next);
    if (issues.length) {
      setError(issues.join(' '));
      return;
    }
    try {
      onChange({ presentation: Object.keys(next).length ? next : undefined });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const axis = (values: NonNullable<ChartPresentation['valueAxis']>) => {
    const next = { ...presentation.valueAxis, ...values };
    for (const key of Object.keys(next) as Array<keyof typeof next>)
      if (next[key] === undefined) delete next[key];
    patch({ valueAxis: Object.keys(next).length ? next : undefined });
  };
  return (
    <details className="chart-editor-advanced">
      <summary>Presentation & updates</summary>
      {!supported && (
        <p className="chart-editor-label">
          Choose a renderer supporting chart presentation to edit these settings.
        </p>
      )}
      <fieldset className="chart-presentation-options" disabled={!supported}>
        {canonical ? (
          <p className="chart-editor-label">
            Percentage scale: 0–100%. Values are taken from canonical rows.
          </p>
        ) : (
          <>
            <Row label="Axis minimum">
              <NumberSetting
                label="Chart axis minimum"
                value={presentation.valueAxis?.min}
                onChange={(min) => axis({ min })}
              />
            </Row>
            <Row label="Axis maximum">
              <NumberSetting
                label="Chart axis maximum"
                value={presentation.valueAxis?.max}
                onChange={(max) => axis({ max })}
              />
            </Row>
          </>
        )}
        <Row label="Axis step">
          <NumberSetting
            label="Chart axis step"
            min={0.000001}
            value={presentation.valueAxis?.step}
            onChange={(step) => axis({ step })}
          />
        </Row>
        <Row label="Tick format">
          <select
            aria-label="Chart tick format"
            value={canonical ? 'percent' : (presentation.valueAxis?.format ?? 'number')}
            disabled={canonical}
            onChange={(event) => axis({ format: event.target.value as 'number' | 'percent' })}
          >
            <option value="number">Number</option>
            <option value="percent">Percent</option>
          </select>
        </Row>
        <Row label="Tick decimals">
          <NumberSetting
            label="Chart tick decimals"
            min={0}
            max={6}
            value={presentation.valueAxis?.decimals}
            onChange={(decimals) => axis({ decimals })}
          />
        </Row>
        <Row label="Font family">
          <input
            aria-label="Chart font family"
            value={presentation.fontFamily ?? ''}
            placeholder="Inherit"
            maxLength={200}
            onChange={(event) => patch({ fontFamily: event.target.value || undefined })}
          />
        </Row>
        <Row label="Font weight">
          <select
            aria-label="Chart font weight"
            value={presentation.fontWeight ?? ''}
            onChange={(event) =>
              patch({ fontWeight: event.target.value ? Number(event.target.value) : undefined })
            }
          >
            <option value="">Inherit</option>
            {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => (
              <option key={weight} value={weight}>
                {weight}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Maximum bar thickness">
          <NumberSetting
            label="Chart maximum bar thickness"
            min={1}
            max={500}
            value={presentation.maxBarThickness}
            onChange={(maxBarThickness) => patch({ maxBarThickness })}
          />
        </Row>
        <Row label="Value labels">
          <input
            type="checkbox"
            aria-label="Chart value labels"
            checked={presentation.valueLabels?.show ?? false}
            onChange={(event) =>
              patch({ valueLabels: { ...presentation.valueLabels, show: event.target.checked } })
            }
          />
        </Row>
        {presentation.valueLabels?.show && (
          <>
            <Row label="Value decimals">
              <NumberSetting
                label="Chart value decimals"
                min={0}
                max={6}
                value={presentation.valueLabels.decimals}
                onChange={(decimals) =>
                  patch({ valueLabels: { ...presentation.valueLabels!, decimals } })
                }
              />
            </Row>
            <Row label="Value suffix">
              <input
                aria-label="Chart value suffix"
                maxLength={12}
                value={presentation.valueLabels.suffix ?? (canonical ? '%' : '')}
                onChange={(event) =>
                  patch({
                    valueLabels: { ...presentation.valueLabels!, suffix: event.target.value },
                  })
                }
              />
            </Row>
          </>
        )}
        {presentation.gradient && (
          <>
            <p className="chart-editor-label">Legacy bar gradient. Use Fill for new paints.</p>
            <Row label="Gradient start">
              <ColorInput
                label="Chart gradient start"
                value={presentation.gradient.from}
                alpha={false}
                onChange={(from) => patch({ gradient: { ...presentation.gradient!, from } })}
              />
            </Row>
            <Row label="Gradient end">
              <ColorInput
                label="Chart gradient end"
                value={presentation.gradient.to}
                alpha={false}
                onChange={(to) => patch({ gradient: { ...presentation.gradient!, to } })}
              />
            </Row>
          </>
        )}
      </fieldset>
      <Row label="Data update">
        <select
          aria-label="Chart data update mode"
          disabled={!morphSupported}
          value={element.animation?.updateMode ?? 'replay'}
          onChange={(event) =>
            onChange({
              animation: {
                ...element.animation!,
                updateMode: event.target.value as 'replay' | 'morph',
              },
            })
          }
        >
          <option value="replay">Replay entrance</option>
          <option value="morph">Animate changed values</option>
        </select>
      </Row>
      {error && (
        <p className="chart-editor-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
