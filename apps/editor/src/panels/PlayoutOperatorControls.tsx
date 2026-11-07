import { useEffect, useState, type KeyboardEvent } from 'react';
import type { LivePlayoutOperation } from '@ograf-editor/agent-tools/playout';
import type { CoordinatedPlayoutSnapshot } from '@ograf-editor/ograf-types';
import type {
  FieldDefinition,
  FieldValue,
  TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { resolvePreviewFormValue } from '../state/previewData';
import { ColorInput } from '../components/ColorInput';

export interface PlayoutOperatorTemplate {
  id: string;
  name: string;
  dataFields: FieldDefinition[];
}

export type PlayoutOperatorCommand = Exclude<LivePlayoutOperation, { type: 'load' | 'unload' }>;

function DataField({
  field,
  value,
  onChange,
  onValidity,
}: {
  field: FieldDefinition;
  value: FieldValue;
  onChange(value: FieldValue): void;
  onValidity(error: string): void;
}) {
  const structured = ['object', 'array', 'gradient'].includes(field.type);
  const numeric = ['number', 'integer', 'duration-ms', 'percentage'].includes(field.type);
  const [draft, setDraft] = useState(() =>
    structured ? JSON.stringify(value, null, 2) : String(value ?? ''),
  );
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(structured ? JSON.stringify(value, null, 2) : String(value ?? ''));
    setError('');
  }, [value, structured]);
  const change = (text: string) => {
    setDraft(text);
    try {
      let next: FieldValue = text;
      if (structured) {
        next = JSON.parse(text) as FieldValue;
        if (
          field.type === 'array'
            ? !Array.isArray(next)
            : !next || typeof next !== 'object' || Array.isArray(next)
        )
          throw new Error(`Enter a JSON ${field.type === 'gradient' ? 'object' : field.type}.`);
      } else if (numeric) {
        if (!text.trim() || !Number.isFinite(Number(text)))
          throw new Error('Enter a finite number.');
        next = Number(text);
        if (field.type === 'integer' && !Number.isInteger(next))
          throw new Error('Enter a whole number.');
        if (field.constraints.minimum !== undefined && next < field.constraints.minimum)
          throw new Error(`Minimum: ${field.constraints.minimum}.`);
        if (field.constraints.maximum !== undefined && next > field.constraints.maximum)
          throw new Error(`Maximum: ${field.constraints.maximum}.`);
      }
      setError('');
      onValidity('');
      onChange(next);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      onValidity(message);
    }
  };
  return (
    <label className="playout-data-field" title={field.description}>
      <span>{field.label || field.key}</span>
      <div>
        {field.type === 'boolean' ? (
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
        ) : field.type === 'color' ? (
          <ColorInput
            label={field.label || field.key}
            value={String(value ?? field.defaultValue ?? '#000000')}
            alpha={field.generatedShaderParameter?.glslType === 'vec4'}
            onChange={(color) => {
              setError('');
              onValidity('');
              onChange(color);
            }}
          />
        ) : field.type === 'select' || field.type === 'select-multiple' ? (
          <select
            multiple={field.type === 'select-multiple'}
            value={
              field.type === 'select-multiple'
                ? Array.isArray(value)
                  ? value.map(String)
                  : []
                : String(value ?? '')
            }
            onChange={(event) =>
              onChange(
                field.type === 'select-multiple'
                  ? [...event.target.selectedOptions].map((option) => option.value)
                  : event.target.value,
              )
            }
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : structured || field.type === 'textarea' ? (
          <textarea
            rows={structured ? 4 : 2}
            spellCheck={!structured}
            value={draft}
            aria-invalid={!!error}
            onChange={(event) => change(event.target.value)}
          />
        ) : (
          <input
            type={numeric ? 'number' : 'text'}
            value={draft}
            min={field.constraints.minimum}
            max={field.constraints.maximum}
            step={field.type === 'integer' ? 1 : (field.constraints.step ?? 'any')}
            aria-invalid={!!error}
            onChange={(event) => change(event.target.value)}
          />
        )}
        {error && <small role="alert">{error}</small>}
      </div>
    </label>
  );
}

function OperatorSlot({
  slot,
  definition,
  templates,
  snapshot,
  onCommand,
  disabled,
}: {
  slot: TransitionLogicDefinition['slots'][number];
  definition: TransitionLogicDefinition;
  templates: PlayoutOperatorTemplate[];
  snapshot: CoordinatedPlayoutSnapshot | null;
  onCommand(command: PlayoutOperatorCommand): Promise<unknown>;
  disabled: boolean;
}) {
  const states = definition.states.filter((state) => state.slotId === slot.id);
  const [selected, setSelected] = useState(states[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, Record<string, FieldValue>>>({});
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [formRevision, setFormRevision] = useState(0);
  const state = states.find((entry) => entry.id === selected) ?? states[0];
  const template = templates.find((entry) => entry.id === state?.templateId);
  const status = snapshot?.slots[slot.id];
  const prepared = snapshot?.prepared[slot.id];
  const active = status?.incoming ?? status?.current;
  const canUpdate =
    !!state && active?.stateId === state.id && !(status?.transition && !status.incoming);
  const name = (id?: string | null) =>
    definition.states.find((entry) => entry.id === id)?.name ?? 'Off';
  const fields = template?.dataFields ?? [];
  const data = Object.fromEntries(
    fields.map((field) => [
      field.key,
      resolvePreviewFormValue(field, values[state?.id ?? '']?.[field.key]),
    ]),
  );
  const invalidData = Object.keys(invalid).length > 0;
  const send = (command: PlayoutOperatorCommand) => {
    setError('');
    void onCommand(command).catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  const take = () => {
    if (!state || disabled || invalidData) return;
    send({ type: 'take', slotId: slot.id, stateId: state.id, data });
  };
  const update = () => {
    if (!state || disabled || invalidData || !canUpdate) return;
    send({ type: 'update', slotId: slot.id, stateId: state.id, data });
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (![' ', 't', 'p', 'u', 'o'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    if (key === 't' || key === ' ') take();
    else if (key === 'u') update();
    else if (key === 'o') send({ type: 'out', slotId: slot.id });
    else if (state && !invalidData)
      send({ type: 'prepare', slotId: slot.id, stateId: state.id, data });
  };
  return (
    <fieldset
      className="playout-slot"
      tabIndex={0}
      onKeyDown={keyboard}
      onMouseDown={(event) => {
        if (!(event.target as HTMLElement).closest('input, textarea, select, button, summary'))
          event.currentTarget.focus({ preventScroll: true });
      }}
    >
      <legend>{slot.name}</legend>
      <div className="playout-slot-status">
        <span className={status?.current || status?.incoming ? 'playout-on-air' : ''}>
          On air: <strong>{name(status?.current?.stateId)}</strong>
        </span>
        {status?.incoming && <span>Incoming: {name(status.incoming.stateId)}</span>}
        {status?.readiness === 'preparing' && (
          <span>Requested: {name(status.desired?.stateId)}</span>
        )}
        {status?.pending && <span>Pending: {name(status.pending.stateId)}</span>}
        {prepared && (
          <span>
            Prepared: {name(prepared.stateId)} · {prepared.status}
            {prepared.status === 'ready' && (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  send({ type: 'take', slotId: slot.id, preparedRequestId: prepared.requestId })
                }
                title="Take the exact prepared state and data, including preparation from MCP."
              >
                Take prepared
              </button>
            )}
          </span>
        )}
        <span>
          {status?.readiness === 'preparing'
            ? 'Loading resources…'
            : status?.transition
              ? `Transition ${Math.round(status.transition.progress * 100)}%`
              : 'Idle'}
        </span>
      </div>
      {status?.transition && (
        <progress
          aria-label={`${slot.name} transition progress`}
          value={status.transition.progress}
          max={1}
        />
      )}
      <label className="playout-state-choice">
        <span>Next</span>
        <select
          aria-label={`${slot.name} next state`}
          value={state?.id ?? ''}
          disabled={disabled}
          onChange={(event) => {
            setSelected(event.target.value);
            setInvalid({});
            setFormRevision((value) => value + 1);
            setError('');
          }}
        >
          {!states.length && <option value="">No states</option>}
          {states.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div className="playout-slot-actions">
        <button
          type="button"
          disabled={disabled || !state || invalidData}
          onClick={() =>
            state && send({ type: 'prepare', slotId: slot.id, stateId: state.id, data })
          }
          title="Load resources without changing output (P when this slot is focused)"
        >
          Prepare
        </button>
        <button
          className="playout-take"
          type="button"
          disabled={disabled || !state || invalidData}
          onClick={take}
          title="Take the selected state and data (T or Space when this slot is focused)"
        >
          Take
        </button>
        <button
          type="button"
          disabled={disabled || !state || invalidData || !canUpdate}
          onClick={update}
          title="Update data for the selected on-air state (U when this slot is focused)"
        >
          Update
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => send({ type: 'out', slotId: slot.id })}
          title="Animate this slot out (O when this slot is focused)"
        >
          Out
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => send({ type: 'clear', slotId: slot.id })}
          title="Clear this slot immediately"
        >
          Clear
        </button>
      </div>
      {snapshot?.loops
        ?.filter((loop) => loop.slotId === slot.id)
        .map((loop) => (
          <div className="playout-session-actions" key={loop.groupId}>
            <span>{loop.name}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                send({
                  type: 'loop',
                  slotId: slot.id,
                  groupId: loop.groupId,
                  action: loop.paused ? 'resume' : 'pause',
                })
              }
            >
              {loop.paused ? 'Resume loop' : 'Pause loop'}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                send({ type: 'loop', slotId: slot.id, groupId: loop.groupId, action: 'next' })
              }
            >
              Next headline
            </button>
          </div>
        ))}
      {(error || status?.error || prepared?.error) && (
        <p className="playout-error" role="alert">
          {error || status?.error || prepared?.error}
        </p>
      )}
      {!!fields.length && (
        <details className="playout-data" open>
          <summary>Data for {state?.name}</summary>
          {state && active?.stateId === state.id && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setValues((current) => ({
                  ...current,
                  [state.id]: structuredClone(active.data) as Record<string, FieldValue>,
                }));
                setInvalid({});
                setFormRevision((value) => value + 1);
              }}
            >
              Use on-air data
            </button>
          )}
          <div className="playout-data-fields" key={`${state?.id}-${formRevision}`}>
            {fields.map((field) => (
              <DataField
                key={field.id}
                field={field}
                value={data[field.key]!}
                onChange={(value) =>
                  state &&
                  setValues((current) => ({
                    ...current,
                    [state.id]: { ...current[state.id], [field.key]: value },
                  }))
                }
                onValidity={(message) =>
                  setInvalid((current) => {
                    const next = { ...current };
                    if (message) next[field.id] = message;
                    else delete next[field.id];
                    return next;
                  })
                }
              />
            ))}
          </div>
          <p className="playout-note">
            Data is staged locally. Prepare or Take uses these values; Update changes the selected
            on-air state.
          </p>
        </details>
      )}
    </fieldset>
  );
}

export function PlayoutOperatorControls({
  definition,
  templates,
  snapshot,
  onCommand,
  disabled = false,
}: {
  definition: TransitionLogicDefinition;
  templates: PlayoutOperatorTemplate[];
  snapshot: CoordinatedPlayoutSnapshot | null;
  onCommand(command: PlayoutOperatorCommand): Promise<unknown>;
  disabled?: boolean;
}) {
  return (
    <div className="playout-slots">
      {definition.slots.map((slot) => (
        <OperatorSlot
          key={slot.id}
          slot={slot}
          definition={definition}
          templates={templates}
          snapshot={snapshot}
          onCommand={onCommand}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
