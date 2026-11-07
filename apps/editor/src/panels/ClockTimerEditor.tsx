import { useEffect, useState } from 'react';
import {
  formatClockTimerValue,
  isClockTimerFormatValid,
  isClockTimeZoneValid,
  normalizeClockTimerSettings,
  parseClockTimerManualValue,
  type ClockTimerSettings,
} from '@ograf-editor/scene-model';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { PropertyRow } from '../components/PropertyRow';
import { useEditorWindow } from '../layout/EditorWindow';
import {
  commandClockTimerPreview,
  useClockTimerPreviewStore,
} from '../state/clockTimerPreviewStore';
import './ClockTimerEditor.css';
import { ClockTimerAlarms } from './ClockTimerAlarms';

const FORMATS = ['hh:mm:ss', 'hh:mm', 'mm:ss', 'ss', 'hh:mm:ss.SSS', 'dd:hh:mm:ss'];

function CommittedInput({
  value,
  label,
  placeholder,
  type = 'text',
  validate,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'datetime-local';
  validate?: (value: string) => string | null;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="clock-timer-committed-input">
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        type={type}
        step={type === 'datetime-local' ? 1 : undefined}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          const message = validate?.(draft) ?? null;
          setError(message);
          if (!message && draft !== value) onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(value);
            setError(null);
          }
        }}
      />
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}

function FormatPreview({ value }: { value: ClockTimerSettings }) {
  const { window: ownerWindow } = useEditorWindow();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (value.mode !== 'clock' || value.source === 'manual') return;
    const interval = ownerWindow.setInterval(() => setNow(Date.now()), 250);
    return () => ownerWindow.clearInterval(interval);
  }, [ownerWindow, value.mode, value.source]);
  const previewValue =
    value.source === 'manual'
      ? (parseClockTimerManualValue(value, value.manualValue) ?? 0)
      : value.mode === 'clock'
        ? now
        : value.initialValueMs;
  return (
    <div className="clock-timer-format-preview">
      <span>
        {value.source === 'manual'
          ? 'Fallback display'
          : value.mode === 'clock'
            ? 'System time'
            : 'Initial display'}
      </span>
      <output>{formatClockTimerValue(value, previewValue)}</output>
    </div>
  );
}

function PreviewControls({ layerId }: { layerId: string }) {
  const running = useClockTimerPreviewStore((state) => state.running[layerId] ?? false);
  const error = useClockTimerPreviewStore((state) => state.error);
  return (
    <>
      <div
        className="inspector-button-row clock-timer-controls"
        role="group"
        aria-label="Timer preview"
      >
        <button
          type="button"
          onClick={() => commandClockTimerPreview(layerId, running ? 'pause' : 'start')}
        >
          {running ? 'Pause' : 'Start'}
        </button>
        <button
          type="button"
          title="Return to the initial value and pause"
          onClick={() => commandClockTimerPreview(layerId, 'reset')}
        >
          Reset
        </button>
        <button
          type="button"
          title="Return to the initial value and start"
          onClick={() => commandClockTimerPreview(layerId, 'restart')}
        >
          Restart
        </button>
        <span>{running ? 'Running' : 'Paused'}</span>
      </div>
      {error ? (
        <p className="inspector-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function ClockTimerEditor({
  value: suppliedValue,
  onChange,
  layerId,
  disabled = false,
  externalBinding,
}: {
  value: ClockTimerSettings;
  onChange: (value: ClockTimerSettings) => void;
  layerId?: string;
  disabled?: boolean;
  externalBinding?: {
    fieldId: string | null;
    fields: Array<{ id: string; label: string }>;
    onChange: (fieldId: string | null) => void;
    onCreate: () => void;
  };
}) {
  const value = normalizeClockTimerSettings(suppliedValue);
  const [customFormat, setCustomFormat] = useState(false);
  const [customZone, setCustomZone] = useState(false);
  const update = (patch: Partial<ClockTimerSettings>) => {
    const next = normalizeClockTimerSettings({ ...value, ...patch });
    if (
      (patch.mode !== undefined || patch.source !== undefined) &&
      next.source === 'manual' &&
      parseClockTimerManualValue(next, next.manualValue) === null
    ) {
      next.manualValue = next.mode === 'clock' ? Date.now() : next.initialValueMs;
    }
    onChange(next);
  };
  const isClock = value.mode === 'clock';
  const isAutomatic = value.source !== 'manual';
  const showCustomFormat = customFormat || !FORMATS.includes(value.format);
  const showCustomZone = customZone || !['local', 'UTC'].includes(value.timeZone);
  const referenceDate = new Date(value.referenceTimeMs);
  const referenceValue = Number.isFinite(referenceDate.getTime())
    ? referenceDate.toISOString().slice(0, 19)
    : '1970-01-01T00:00:00';

  return (
    <CollapsibleSection sectionId="properties.clock-timer" title="Clock / Timer">
      <fieldset className="clock-timer-editor" disabled={disabled}>
        <PropertyRow
          help="Display time of day, elapsed time, or remaining time. The source determines whether time advances automatically or comes from external data."
          className="inspector-row"
        >
          <span>Mode</span>
          <select
            aria-label="Clock or timer mode"
            value={value.mode}
            onChange={(event) => {
              const mode = event.target.value as ClockTimerSettings['mode'];
              update({
                mode,
                ...(isClock && mode !== 'clock'
                  ? { initialValueMs: mode === 'count-down' ? 60_000 : 0 }
                  : {}),
              });
            }}
          >
            <option value="clock">Clock (time of day)</option>
            <option value="count-up">Count up</option>
            <option value="count-down">Count down</option>
          </select>
        </PropertyRow>
        <PropertyRow
          help="Automatic reads the system clock or runs the timer. Manual displays a supplied value and updates only when that value changes."
          className="inspector-row"
        >
          <span>Source</span>
          <select
            aria-label="Clock or timer source"
            value={value.source}
            onChange={(event) =>
              update({ source: event.target.value as ClockTimerSettings['source'] })
            }
          >
            <option value="automatic">Automatic (system clock/timer)</option>
            <option value="manual">Manual (external data)</option>
          </select>
        </PropertyRow>
        {!isAutomatic ? (
          <>
            {externalBinding ? (
              <PropertyRow
                help="Bind a data field to the clock or timer value. Connect its external feed in Data, or edit it from Preview & Export. Nested values can be configured under Data Bindings."
                className="inspector-row"
              >
                <span>External value</span>
                <select
                  aria-label="Clock or timer external data field"
                  value={externalBinding.fieldId ?? ''}
                  onChange={(event) => {
                    if (event.target.value === '__create__') externalBinding.onCreate();
                    else externalBinding.onChange(event.target.value || null);
                  }}
                >
                  <option value="">None — use fallback</option>
                  {externalBinding.fieldId &&
                  !externalBinding.fields.some((field) => field.id === externalBinding.fieldId) ? (
                    <option value={externalBinding.fieldId}>
                      Current binding (see Data Bindings)
                    </option>
                  ) : null}
                  {externalBinding.fields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                  ))}
                  {!externalBinding.fieldId ? (
                    <option value="__create__">+ Create data field</option>
                  ) : null}
                </select>
              </PropertyRow>
            ) : null}
            <PropertyRow
              help={
                isClock
                  ? 'Use epoch milliseconds, an ISO date and time with time zone, or HH:mm:ss. This value is used when no valid external value is available.'
                  : 'Use milliseconds or a duration such as HH:mm:ss. This value is used when no valid external value is available; it does not count automatically.'
              }
              className="inspector-row"
            >
              <span>Fallback value</span>
              <CommittedInput
                key={`${value.mode}:${value.manualValue}`}
                value={String(value.manualValue)}
                label="Manual clock or timer fallback value"
                placeholder={isClock ? '13:05:09 or ISO date/time' : '60000 or 00:01:00'}
                validate={(manualValue) =>
                  parseClockTimerManualValue(value, manualValue) !== null
                    ? null
                    : isClock
                      ? 'Enter milliseconds, HH:mm:ss, or an ISO date/time with Z or a time zone offset.'
                      : 'Enter milliseconds or a duration such as 00:01:00.'
                }
                onCommit={(manualValue) =>
                  update({
                    manualValue: /^-?\d+(?:\.\d+)?$/.test(manualValue.trim())
                      ? Number(manualValue)
                      : manualValue,
                  })
                }
              />
            </PropertyRow>
            <p className="inspector-hint">
              {isClock
                ? 'External values: epoch milliseconds, ISO date/time with zone, or HH:mm:ss.'
                : 'External values: milliseconds or HH:mm:ss. Manual values stay fixed until updated.'}
            </p>
          </>
        ) : null}
        <PropertyRow
          help="Choose which time units to display. Hidden units roll into the largest displayed timer unit."
          className="inspector-row"
        >
          <span>Format</span>
          <select
            aria-label="Clock or timer format"
            value={showCustomFormat ? 'custom' : value.format}
            onChange={(event) => {
              setCustomFormat(event.target.value === 'custom');
              if (event.target.value !== 'custom') update({ format: event.target.value });
            }}
          >
            {FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </PropertyRow>
        {showCustomFormat ? (
          <>
            <PropertyRow
              help="Use h or hh for hours, m or mm for minutes, s or ss for seconds, SSS for milliseconds, d or dd for days, and A or a for AM/PM. Put literal text in [brackets]."
              className="inspector-row"
            >
              <span>Custom format</span>
              <CommittedInput
                key={value.format}
                value={value.format}
                label="Custom clock or timer format"
                placeholder="hh:mm:ss"
                validate={(format) =>
                  isClockTimerFormatValid(format)
                    ? null
                    : 'Use a time token and balanced [literal] brackets, up to 128 characters.'
                }
                onCommit={(format) => update({ format })}
              />
            </PropertyRow>
            <p className="inspector-hint">
              h / hh · m / mm · s / ss · SSS · d / dd · A / a · [literal text]
            </p>
          </>
        ) : null}
        {isClock ? (
          <>
            <PropertyRow help="Use a 24-hour clock or a 12-hour clock." className="inspector-row">
              <span>Hour cycle</span>
              <select
                aria-label="Clock hour cycle"
                value={value.hourCycle}
                onChange={(event) =>
                  update({ hourCycle: event.target.value as ClockTimerSettings['hourCycle'] })
                }
              >
                <option value="24">24 hours</option>
                <option value="12">12 hours</option>
              </select>
            </PropertyRow>
            <PropertyRow
              help="Local uses the playback computer's time zone. Choose a named zone to keep the display in one location across computers."
              className="inspector-row"
            >
              <span>Time zone</span>
              <select
                aria-label="Clock time zone"
                value={showCustomZone ? 'custom' : value.timeZone}
                onChange={(event) => {
                  setCustomZone(event.target.value === 'custom');
                  if (event.target.value !== 'custom') update({ timeZone: event.target.value });
                }}
              >
                <option value="local">System local</option>
                <option value="UTC">UTC</option>
                <option value="custom">Named time zone…</option>
              </select>
            </PropertyRow>
            {showCustomZone ? (
              <PropertyRow
                help="Use an IANA time zone, such as Europe/Istanbul or America/New_York."
                className="inspector-row"
              >
                <span>Named zone</span>
                <CommittedInput
                  key={value.timeZone}
                  value={value.timeZone === 'local' ? '' : value.timeZone}
                  label="Named clock time zone"
                  placeholder="Europe/Istanbul"
                  validate={(zone) => {
                    if (!zone.trim()) return 'Enter a time zone.';
                    return isClockTimeZoneValid(zone.trim())
                      ? null
                      : 'Enter a valid time zone, for example Europe/Istanbul.';
                  }}
                  onCommit={(timeZone) => update({ timeZone: timeZone.trim() })}
                />
              </PropertyRow>
            ) : null}
            {value.hourCycle === '12' ? (
              <>
                <PropertyRow
                  help="Append an AM/PM marker unless the custom format already contains A or a."
                  className="inspector-row inspector-checkbox-row"
                >
                  <span>Show AM/PM</span>
                  <input
                    type="checkbox"
                    checked={value.showAmPm}
                    onChange={(event) => update({ showAmPm: event.target.checked })}
                  />
                </PropertyRow>
                {value.showAmPm ? (
                  <PropertyRow
                    help="Display AM/PM in capitals instead of am/pm."
                    className="inspector-row inspector-checkbox-row"
                  >
                    <span>Uppercase AM/PM</span>
                    <input
                      type="checkbox"
                      checked={value.uppercaseAmPm}
                      onChange={(event) => update({ uppercaseAmPm: event.target.checked })}
                    />
                  </PropertyRow>
                ) : null}
              </>
            ) : null}
          </>
        ) : isAutomatic ? (
          <>
            <PropertyRow
              help="The timer starts at this value. Decimal seconds are supported, for example 90 means 1 minute 30 seconds."
              className="inspector-row"
            >
              <span>
                {value.mode === 'count-down' ? 'Duration (seconds)' : 'Start at (seconds)'}
              </span>
              <input
                aria-label={
                  value.mode === 'count-down'
                    ? 'Countdown duration in seconds'
                    : 'Count-up initial value in seconds'
                }
                type="number"
                min={0}
                step={0.001}
                value={value.initialValueMs / 1000}
                onChange={(event) => {
                  if (Number.isFinite(event.target.valueAsNumber)) {
                    const initialValueMs = Math.max(0, event.target.valueAsNumber) * 1000;
                    update({
                      initialValueMs,
                      ...(value.mode === 'count-up' && value.limitMs !== null
                        ? { limitMs: Math.max(initialValueMs, value.limitMs) }
                        : {}),
                    });
                  }
                }}
              />
            </PropertyRow>
            {value.mode === 'count-up' ? (
              <>
                <PropertyRow
                  help="Choose a target value for the count-up timer."
                  className="inspector-row inspector-checkbox-row"
                >
                  <span>Use end value</span>
                  <input
                    type="checkbox"
                    checked={value.limitMs !== null}
                    onChange={(event) =>
                      update({
                        limitMs: event.target.checked
                          ? Math.max(value.initialValueMs + 60_000, 60_000)
                          : null,
                      })
                    }
                  />
                </PropertyRow>
                {value.limitMs !== null ? (
                  <PropertyRow
                    help="The count-up timer reaches its end at this total value in seconds."
                    className="inspector-row"
                  >
                    <span>End at (seconds)</span>
                    <input
                      aria-label="Count-up end value in seconds"
                      type="number"
                      min={value.initialValueMs / 1000}
                      step={0.001}
                      value={value.limitMs / 1000}
                      onChange={(event) => {
                        if (Number.isFinite(event.target.valueAsNumber))
                          update({
                            limitMs: Math.max(
                              value.initialValueMs,
                              event.target.valueAsNumber * 1000,
                            ),
                          });
                      }}
                    />
                  </PropertyRow>
                ) : null}
              </>
            ) : null}
            {value.mode === 'count-down' || value.limitMs !== null ? (
              <PropertyRow
                help="Stop at the end, continue past it (negative overtime for countdowns), or loop back to the initial value."
                className="inspector-row"
              >
                <span>At end</span>
                <select
                  aria-label="Timer end behavior"
                  value={value.endBehavior}
                  onChange={(event) =>
                    update({ endBehavior: event.target.value as ClockTimerSettings['endBehavior'] })
                  }
                >
                  <option value="stop">Stop</option>
                  <option value="continue">Continue / overtime</option>
                  <option value="loop">Loop</option>
                </select>
              </PropertyRow>
            ) : null}
            <PropertyRow
              help="Start or resume the timer automatically when the graphic is taken on air."
              className="inspector-row inspector-checkbox-row"
            >
              <span>Start on Take In</span>
              <input
                type="checkbox"
                checked={value.autoStart}
                onChange={(event) => update({ autoStart: event.target.checked })}
              />
            </PropertyRow>
            <PropertyRow
              help="Pause the timer when the graphic is taken off air, preserving its elapsed time."
              className="inspector-row inspector-checkbox-row"
            >
              <span>Pause off air</span>
              <input
                type="checkbox"
                checked={value.pauseWhenOffAir}
                onChange={(event) => update({ pauseWhenOffAir: event.target.checked })}
              />
            </PropertyRow>
            {layerId ? <PreviewControls layerId={layerId} /> : null}
          </>
        ) : null}
        {layerId ? <ClockTimerAlarms layerId={layerId} clock={value} /> : null}
        <PropertyRow
          help="Pad these time units to two digits when using hh, mm, or ss. Single-letter format tokens remain unpadded."
          className="inspector-row"
          as="div"
        >
          <span>Leading zeros</span>
          <div className="clock-timer-padding">
            {(
              [
                ['padHours', 'Hours'],
                ['padMinutes', 'Minutes'],
                ['padSeconds', 'Seconds'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={value[key]}
                  onChange={(event) => update({ [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </PropertyRow>
        <PropertyRow help="Text placed before the formatted time." className="inspector-row">
          <span>Prefix</span>
          <input
            aria-label="Clock or timer prefix"
            value={value.prefix}
            onChange={(event) => update({ prefix: event.target.value })}
          />
        </PropertyRow>
        <PropertyRow help="Text placed after the formatted time." className="inspector-row">
          <span>Suffix</span>
          <input
            aria-label="Clock or timer suffix"
            value={value.suffix}
            onChange={(event) => update({ suffix: event.target.value })}
          />
        </PropertyRow>
        <FormatPreview value={value} />
        {isClock && isAutomatic ? (
          <details className="clock-timer-reference">
            <summary>Frame preview reference</summary>
            <p className="inspector-hint">
              Frame seeking uses this reference plus the timeline time. Live playback always uses
              the system clock.
            </p>
            <PropertyRow
              help="UTC date and time corresponding to timeline frame zero for repeatable frame previews."
              className="inspector-row"
            >
              <span>Reference (UTC)</span>
              <CommittedInput
                key={value.referenceTimeMs}
                type="datetime-local"
                value={referenceValue}
                label="Clock frame preview reference in UTC"
                validate={(input) =>
                  Number.isFinite(Date.parse(`${input}Z`)) ? null : 'Enter a valid date and time.'
                }
                onCommit={(input) => update({ referenceTimeMs: Date.parse(`${input}Z`) })}
              />
            </PropertyRow>
            <div className="inspector-button-row">
              <button type="button" onClick={() => update({ referenceTimeMs: Date.now() })}>
                Use current time
              </button>
            </div>
          </details>
        ) : null}
      </fieldset>
    </CollapsibleSection>
  );
}
