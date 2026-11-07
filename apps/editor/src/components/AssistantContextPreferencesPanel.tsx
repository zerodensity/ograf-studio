import { useEffect, useId, useState } from 'react';
import {
  ASSISTANT_CONTEXT_TOKEN_BOUNDS,
  normalizeAssistantContextPreferences,
  type AssistantContextPreferences,
} from '../state/workspaceModel';
import { useWorkspaceStore } from '../state/workspaceStore';
import './AssistantContextPreferencesPanel.css';

type ContextLimitKey = keyof AssistantContextPreferences;

const FIELDS: Array<{
  key: ContextLimitKey;
  label: string;
  hint: string;
  initial: number;
}> = [
  {
    key: 'contextWindowTokens',
    label: 'Override model context window',
    hint: 'Use the model’s documented capacity when automatic discovery is unavailable. This does not enlarge the model’s actual capacity.',
    initial: 65_536,
  },
  {
    key: 'maxHistoryTokens',
    label: 'Limit conversation context',
    hint: 'Cap the conversation included in each model request. Older conversation remains available through history paging.',
    initial: 16_384,
  },
  {
    key: 'maxToolResultTokens',
    label: 'Limit tool result page',
    hint: 'Cap each result page sent to the model. Larger results remain available through structured paging.',
    initial: 4_096,
  },
];

function ContextLimit({
  field,
  value,
  onChange,
}: {
  field: (typeof FIELDS)[number];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value ?? field.initial));
  const [error, setError] = useState('');
  const { min, max } = ASSISTANT_CONTEXT_TOKEN_BOUNDS[field.key];
  useEffect(() => {
    setDraft(String(value ?? field.initial));
    setError('');
  }, [value, field.initial]);
  const commit = () => {
    const tokens = Number(draft);
    if (!draft.trim() || !Number.isSafeInteger(tokens) || tokens < min || tokens > max) {
      setError(`Enter a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}.`);
      return;
    }
    setError('');
    onChange(tokens);
  };
  return (
    <div className="assistant-context-setting">
      <label className="assistant-context-toggle" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={value !== null}
          onChange={(event) => {
            setError('');
            onChange(event.target.checked ? field.initial : null);
          }}
        />
        {field.label}
      </label>
      {value === null ? (
        <span className="assistant-context-auto">Automatic</span>
      ) : (
        <label className="assistant-context-token-input" htmlFor={id}>
          <input
            id={id}
            type="number"
            min={min}
            max={max}
            step={1}
            value={draft}
            aria-label={`${field.label} tokens`}
            aria-invalid={!!error}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
            }}
          />
          <span>tokens</span>
        </label>
      )}
      <p>{field.hint}</p>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

/** The form is exported separately so its saved automatic/custom states can be reviewed. */
export function AssistantContextPreferencesForm({
  value,
  onChange,
}: {
  value: AssistantContextPreferences;
  onChange: (value: AssistantContextPreferences) => void;
}) {
  return (
    <section
      className="assistant-context-preferences"
      aria-label="AI assistant context preferences"
    >
      <h3>AI assistant</h3>
      <p>
        Automatic planning uses model metadata when available, otherwise an estimated fallback that
        you can override. It reserves room for tools and the reply. Set optional limits to reduce
        how much context is sent with a request.
      </p>
      {FIELDS.map((field) => (
        <ContextLimit
          key={field.key}
          field={field}
          value={value[field.key]}
          onChange={(tokens) => onChange({ ...value, [field.key]: tokens })}
        />
      ))}
      <button type="button" onClick={() => onChange(normalizeAssistantContextPreferences(null))}>
        Restore automatic context
      </button>
      <p className="assistant-context-footnote">
        Token counts are estimates. Effective limits also respect the model’s capacity and reserved
        reply space. These preferences apply to new built-in assistant requests, are saved for this
        user, and are not included in templates or exports. External MCP clients manage their own
        model context.
      </p>
    </section>
  );
}

export function AssistantContextPreferencesPanel() {
  const value = useWorkspaceStore((state) => state.editorPreferences.assistantContext);
  return (
    <AssistantContextPreferencesForm
      value={normalizeAssistantContextPreferences(value)}
      onChange={(assistantContext) =>
        useWorkspaceStore.getState().updateEditorPreferences({ assistantContext })
      }
    />
  );
}
