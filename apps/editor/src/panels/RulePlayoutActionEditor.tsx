import { useEffect, useState } from 'react';
import type {
  FieldDefinition,
  FieldValue,
  Project,
  VisualRuleAction,
} from '@ograf-editor/scene-model';
import { ColorInput } from '../components/ColorInput';
import type { ProjectSetDocument } from '../state/projectSet';

type PlayoutAction = Extract<VisualRuleAction, { type: 'playout' }>;

function StructuredValue({
  value,
  label,
  onChange,
}: {
  value: FieldValue;
  label: string;
  onChange: (value: FieldValue) => void;
}) {
  const serialized = JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(serialized);
    setError('');
  }, [serialized]);
  return (
    <span className="rules-playout-structured">
      <textarea
        aria-label={label}
        aria-invalid={Boolean(error)}
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          try {
            onChange(JSON.parse(draft) as FieldValue);
            setError('');
          } catch {
            setError('Enter a valid JSON value.');
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </span>
  );
}

function PlayoutValue({
  field,
  fieldKey,
  value,
  onChange,
}: {
  field: FieldDefinition | undefined;
  fieldKey: string;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}) {
  const label = `Playout data ${field?.label || fieldKey}`;
  if (field?.type === 'boolean' || typeof value === 'boolean')
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  if (field?.type === 'color')
    return (
      <ColorInput
        label={label}
        value={String(value ?? '#000000')}
        alpha={field.generatedShaderParameter?.glslType === 'vec4'}
        onChange={onChange}
      />
    );
  if (field?.type === 'select')
    return (
      <select
        aria-label={label}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        {!field.options.some((option) => option.value === value) && (
          <option value={String(value)}>{String(value)} (unlisted)</option>
        )}
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label || option.value}
          </option>
        ))}
      </select>
    );
  if (
    value === null ||
    typeof value === 'object' ||
    (field && ['array', 'object', 'gradient', 'select-multiple'].includes(field.type))
  )
    return <StructuredValue value={value} label={label} onChange={onChange} />;
  const numeric = field
    ? ['number', 'integer', 'percentage', 'duration-ms'].includes(field.type)
    : typeof value === 'number';
  return (
    <input
      aria-label={label}
      type={numeric ? 'number' : 'text'}
      step={field?.type === 'integer' ? 1 : 'any'}
      value={String(value)}
      onChange={(event) => {
        if (!numeric) onChange(event.target.value);
        else if (Number.isFinite(event.currentTarget.valueAsNumber))
          onChange(event.currentTarget.valueAsNumber);
      }}
    />
  );
}

/** Playout actions issue commands; the Transitions planner owns timing and dependencies. */
export function RulePlayoutActionEditor({
  action,
  projectSet,
  activeTemplateId,
  activeProject,
  onChange,
}: {
  action: PlayoutAction;
  projectSet: ProjectSetDocument | null;
  activeTemplateId: string | null;
  activeProject: Project;
  onChange: (action: PlayoutAction) => void;
}) {
  const definition = projectSet?.transitionLogic;
  const slot = definition?.slots.find((candidate) => candidate.id === action.slotId);
  const states = definition?.states.filter((state) => state.slotId === action.slotId) ?? [];
  const hasState = action.operation === 'take' || action.operation === 'update';
  const selectedState = states.find((state) => state.id === action.stateId);
  const selectedTemplateExists = Boolean(
    selectedState &&
    projectSet?.templates.some((template) => template.id === selectedState.templateId),
  );
  const invalidState =
    hasState &&
    (action.stateId !== undefined
      ? !selectedState || !selectedTemplateExists
      : action.operation === 'take');
  const availableFields = new Map<string, FieldDefinition>();
  for (const state of action.stateId
    ? states.filter((entry) => entry.id === action.stateId)
    : states) {
    const template = projectSet?.templates.find((candidate) => candidate.id === state.templateId);
    const project = template?.id === activeTemplateId ? activeProject : template?.project;
    const composition = project?.compositions.find(
      (entry) => entry.id === project.mainCompositionId,
    );
    for (const field of composition?.dataFields ?? [])
      if (!availableFields.has(field.key)) availableFields.set(field.key, field);
  }
  const data = action.data ?? {};
  const customData = action.data !== undefined;
  const remainingFields = [...availableFields.values()].filter((field) => !(field.key in data));
  const setData = (next: Record<string, FieldValue>) => {
    onChange({ ...action, data: next });
  };
  return (
    <div className="rules-playout-action">
      <label className="rule-editor-field">
        <span>Lane</span>
        <select
          aria-label="Playout target lane"
          aria-invalid={!slot}
          value={action.slotId}
          disabled={!definition?.slots.length}
          onChange={(event) => {
            const slotId = event.target.value;
            // Data belongs to the selected lane/template; changing that target starts fresh.
            const stateId =
              action.operation === 'take'
                ? (definition?.states.find((state) => state.slotId === slotId)?.id ?? '')
                : undefined;
            onChange({
              type: 'playout',
              operation: action.operation,
              slotId,
              ...(stateId !== undefined ? { stateId } : {}),
            });
          }}
        >
          {!slot && (
            <option value={action.slotId}>
              {action.slotId ? `Missing lane: ${action.slotId}` : 'Choose lane'}
            </option>
          )}
          {definition?.slots.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      {hasState && (
        <label className="rule-editor-field">
          <span>Template</span>
          <select
            aria-label="Playout target template"
            aria-invalid={invalidState}
            value={action.stateId ?? ''}
            disabled={!slot}
            onChange={(event) => {
              const stateId = event.target.value;
              onChange({
                type: 'playout',
                operation: action.operation,
                slotId: action.slotId,
                ...(stateId ? { stateId } : {}),
              });
            }}
          >
            <option value="">
              {action.operation === 'update' ? 'Current on-air template' : 'Choose template'}
            </option>
            {action.stateId && !selectedState && (
              <option value={action.stateId}>Missing template: {action.stateId}</option>
            )}
            {states.map((state) => {
              const template = projectSet?.templates.find(
                (candidate) => candidate.id === state.templateId,
              );
              return (
                <option key={state.id} value={state.id}>
                  {state.name}
                  {!template ? ' (missing template)' : ''}
                  {template && template.name !== state.name ? ` · ${template.name}` : ''}
                </option>
              );
            })}
          </select>
        </label>
      )}
      {!definition?.slots.length ? (
        <p className="rules-playout-hint">Configure lanes and templates in Transitions first.</p>
      ) : !slot || invalidState ? (
        <p className="rules-playout-hint rules-playout-error" role="alert">
          Choose an existing lane{hasState ? ' and template' : ''}. This action cannot run with a
          missing target.
        </p>
      ) : (
        <p className="rules-playout-hint">
          {action.operation === 'clear'
            ? 'Immediately clears this lane and its dependent lanes.'
            : action.operation === 'update'
              ? 'Updates the on-air template through its transition. A selected template acts as a guard.'
              : 'Uses the timing and dependencies configured in Transitions.'}
        </p>
      )}
      {hasState && (
        <details className="rule-editor-options rules-playout-data">
          <summary>Data{Object.keys(data).length ? ` · ${Object.keys(data).length}` : ''}</summary>
          <div className="rules-playout-data-fields">
            <select
              aria-label="Playout data source"
              value={customData ? 'custom' : 'current'}
              onChange={(event) => {
                const { data: _previous, ...rest } = action;
                onChange(event.target.value === 'custom' ? { ...rest, data: {} } : rest);
              }}
            >
              <option value="current">
                {action.operation === 'update'
                  ? 'Data from this template'
                  : 'Current values / defaults'}
              </option>
              <option value="custom">Choose fields</option>
            </select>
            {customData &&
              Object.entries(data).map(([key, value]) => (
                <div className="rules-playout-data-row" key={key}>
                  <label className="rule-editor-field">
                    <span title={availableFields.has(key) ? key : `Field not found: ${key}`}>
                      {availableFields.get(key)?.label || key}
                    </span>
                    <PlayoutValue
                      field={availableFields.get(key)}
                      fieldKey={key}
                      value={value}
                      onChange={(next) => setData({ ...data, [key]: next })}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove playout data ${key}`}
                    title="Use current value"
                    onClick={() => {
                      const next = { ...data };
                      delete next[key];
                      setData(next);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            {customData && remainingFields.length > 0 && (
              <select
                aria-label="Add playout data field"
                value=""
                onChange={(event) => {
                  const field = availableFields.get(event.target.value);
                  if (field) setData({ ...data, [field.key]: structuredClone(field.defaultValue) });
                }}
              >
                <option value="">+ Add data field</option>
                {remainingFields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label || field.key}
                  </option>
                ))}
              </select>
            )}
            <p className="rules-playout-hint">
              {customData
                ? Object.keys(data).length
                  ? 'Only listed fields are sent. Other fields keep their current values.'
                  : 'No fields selected. This action sends no data changes.'
                : action.operation === 'update'
                  ? 'Sends this rule’s current data to matching fields in the on-air template.'
                  : 'Uses the target template’s retained values or defaults.'}
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
