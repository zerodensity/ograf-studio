import { useEffect, useMemo, useState } from 'react';
import type {
  FieldDefinition,
  FieldValue,
  TransitionLogicDefinition,
  TransitionLogicReferences,
  TransitionLogicSlot,
} from '@ograf-editor/scene-model';
import { ColorInput } from '../components/ColorInput';
import { resolveProjectSetTemplate, type ProjectSetDocument } from '../state/projectSet';
import { setLayerAdmission, setTemplateDataDefaults } from '../state/transitionChoreography';
import { parseTransitionPresetValue } from '../state/transitionPresetValue';

function PresetField({
  field,
  value,
  enabled,
  label,
  onChange,
}: {
  field: FieldDefinition;
  value: FieldValue;
  enabled: boolean;
  label: string;
  onChange: (value: FieldValue) => void;
}) {
  const complex = ['array', 'object', 'select-multiple', 'gradient'].includes(field.type);
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(JSON.stringify(value, null, 2));
    setError('');
  }, [value]);
  if (complex)
    return (
      <div>
        <textarea
          aria-label={label}
          disabled={!enabled}
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            try {
              onChange(parseTransitionPresetValue(field, draft));
              setError('');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Enter valid JSON.');
            }
          }}
        />
        {error && <small role="alert">{error}</small>}
      </div>
    );
  if (field.type === 'boolean')
    return (
      <input
        aria-label={label}
        type="checkbox"
        disabled={!enabled}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  if (field.type === 'color')
    return (
      <ColorInput
        label={label}
        disabled={!enabled}
        value={typeof value === 'string' ? value : '#000000'}
        onChange={onChange}
      />
    );
  if (field.type === 'select')
    return (
      <select
        aria-label={label}
        disabled={!enabled}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  const numeric = field.type === 'number' || field.type === 'integer';
  return (
    <input
      aria-label={label}
      type={numeric ? 'number' : 'text'}
      disabled={!enabled}
      value={typeof value === 'string' || typeof value === 'number' ? value : ''}
      min={field.constraints.minimum}
      max={field.constraints.maximum}
      step={field.type === 'integer' ? 1 : 'any'}
      onChange={(event) => {
        if (!numeric) onChange(event.target.value);
        else if (Number.isFinite(event.target.valueAsNumber))
          onChange(
            field.type === 'integer'
              ? Math.round(event.target.valueAsNumber)
              : event.target.valueAsNumber,
          );
      }}
    />
  );
}

/** Optional authoring settings; playback stays in Preview & Export. */
export function TransitionLaneConditions({
  definition,
  slot,
  set,
  references,
  disabled,
  run,
}: {
  definition: TransitionLogicDefinition;
  slot: TransitionLogicSlot;
  set: ProjectSetDocument;
  references: TransitionLogicReferences;
  disabled: boolean;
  run: (edit: (definition: TransitionLogicDefinition) => TransitionLogicDefinition) => void;
}) {
  const others = definition.slots.filter((item) => item.id !== slot.id);
  const states = definition.states.filter((item) => item.slotId === slot.id);
  const [selected, setSelected] = useState(states[0]?.id ?? '');
  const state = states.find((item) => item.id === selected) ?? states[0];
  const templateId = state?.templateId;
  const fields = useMemo(() => {
    if (!templateId) return [];
    const project = resolveProjectSetTemplate(set, templateId);
    return (
      project.compositions.find((item) => item.id === project.mainCompositionId)?.dataFields ?? []
    );
  }, [set, templateId]);
  const updateAdmission = (
    kind: 'requireOnSlotIds' | 'blockWhileActiveSlotIds',
    id: string,
    enabled: boolean,
  ) =>
    run((current) => {
      const admission = current.slots.find((item) => item.id === slot.id)?.admission ?? {};
      const values = admission[kind] ?? [];
      return setLayerAdmission(
        current,
        slot.id,
        {
          ...admission,
          [kind]: enabled ? [...new Set([...values, id])] : values.filter((value) => value !== id),
        },
        references,
      );
    });
  const preset = (key: string, value: FieldValue | undefined) => {
    if (!state) return;
    run((current) => {
      const defaults = { ...current.states.find((item) => item.id === state.id)?.dataDefaults };
      if (value === undefined) delete defaults[key];
      else defaults[key] = structuredClone(value);
      return setTemplateDataDefaults(current, state.id, defaults, references);
    });
  };
  return (
    <div className="tr-lane-conditions">
      {!!others.length && (
        <details>
          <summary>Take conditions{slot.admission && <strong>Configured</strong>}</summary>
          <div className="tr-take-condition-grid">
            <fieldset disabled={disabled}>
              <legend>Require On</legend>
              {others.map((other) => (
                <label key={other.id}>
                  <input
                    type="checkbox"
                    aria-label={`Require ${other.name} On before ${slot.name}`}
                    checked={slot.admission?.requireOnSlotIds?.includes(other.id) ?? false}
                    disabled={slot.admission?.blockWhileActiveSlotIds?.includes(other.id)}
                    onChange={(event) =>
                      updateAdmission('requireOnSlotIds', other.id, event.target.checked)
                    }
                  />
                  {other.name}
                </label>
              ))}
            </fieldset>
            <fieldset disabled={disabled}>
              <legend>Block while active</legend>
              {others.map((other) => (
                <label key={other.id}>
                  <input
                    type="checkbox"
                    aria-label={`Block ${slot.name} while ${other.name} is active`}
                    checked={slot.admission?.blockWhileActiveSlotIds?.includes(other.id) ?? false}
                    disabled={slot.admission?.requireOnSlotIds?.includes(other.id)}
                    onChange={(event) =>
                      updateAdmission('blockWhileActiveSlotIds', other.id, event.target.checked)
                    }
                  />
                  {other.name}
                </label>
              ))}
            </fieldset>
          </div>
          <p className="tr-muted">
            A blocked Take stays Off. It is not queued to appear later. Required lanes must finish
            entering; blocking lanes must finish leaving.
          </p>
        </details>
      )}
      {!!states.length && (
        <details>
          <summary>Template presets</summary>
          <label className="tr-preset-choice">
            Template
            <select
              aria-label={`Template preset in ${slot.name}`}
              value={state?.id ?? ''}
              disabled={disabled}
              onChange={(event) => setSelected(event.target.value)}
            >
              {states.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p className="tr-muted">
            Override data for this named state. Operator edits are retained; template artwork is
            shared.
          </p>
          <div className="tr-preset-fields">
            {fields.map((field) => {
              const active = !!state && Object.hasOwn(state.dataDefaults ?? {}, field.key);
              const value = (
                active ? state!.dataDefaults![field.key] : field.defaultValue
              ) as FieldValue;
              return (
                <div className="tr-preset-field" key={field.id}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Override ${field.label || field.key} for ${state?.name}`}
                      disabled={disabled}
                      checked={active}
                      onChange={(event) =>
                        preset(field.key, event.target.checked ? field.defaultValue : undefined)
                      }
                    />
                    {field.label || field.key}
                  </label>
                  <PresetField
                    field={field}
                    value={value}
                    enabled={!disabled && active}
                    label={`${field.label || field.key} preset for ${state?.name}`}
                    onChange={(value) => preset(field.key, value)}
                  />
                </div>
              );
            })}
          </div>
          {!fields.length && <p className="tr-muted">This template has no data fields.</p>}
        </details>
      )}
    </div>
  );
}
