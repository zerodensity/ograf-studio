import { useEffect, useRef, useState } from 'react';
import type { FieldDefinition } from '@ograf-editor/scene-model';
import type { TestValue } from '../state/testDataStore';
import { resolvePreviewFormValue } from '../state/previewData';
import { PropertyRow } from '../components/PropertyRow';
import { ColorInput } from '../components/ColorInput';

function StructuredPreviewValue({
  fieldKey,
  type,
  value,
  onValidChange,
}: {
  fieldKey: string;
  type: 'array' | 'object';
  value: TestValue;
  onValidChange: (value: TestValue) => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  const lastEmitted = useRef(JSON.stringify(value));

  useEffect(() => {
    const incoming = JSON.stringify(value);
    if (incoming === lastEmitted.current) return;
    setDraft(JSON.stringify(value, null, 2));
    setError('');
    lastEmitted.current = incoming;
  }, [value]);

  return (
    <div className="preview-json-field">
      <textarea
        aria-label={`${fieldKey} JSON`}
        aria-invalid={Boolean(error)}
        rows={6}
        spellCheck={false}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          try {
            const parsed: unknown = JSON.parse(next);
            if (
              type === 'array'
                ? !Array.isArray(parsed)
                : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            )
              throw new Error(`Enter a JSON ${type}.`);
            lastEmitted.current = JSON.stringify(parsed);
            onValidChange(parsed as TestValue);
            setError('');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : `Enter a JSON ${type}.`);
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

export function PreviewDataFields({
  fields,
  values,
  onChange,
  changeHint = 'update the preview automatically without changing its saved default',
}: {
  fields: FieldDefinition[];
  values: Record<string, TestValue>;
  onChange: (key: string, value: TestValue) => void;
  changeHint?: string;
}) {
  return (
    <div className="preview-data-form">
      {fields.map((field) => (
        <PropertyRow
          help={`${field.description ? field.description + ' ' : ''}Changes to ${field.key} ${changeHint}.`}
          key={field.id}
          className="preview-data-row"
        >
          <span>{field.label || field.key}</span>
          {field.type === 'array' ||
          field.type === 'object' ||
          field.type === 'gradient' ||
          field.type === 'select-multiple' ? (
            <StructuredPreviewValue
              fieldKey={field.key}
              type={field.type === 'array' || field.type === 'select-multiple' ? 'array' : 'object'}
              value={values[field.key] ?? field.defaultValue}
              onValidChange={(value) => onChange(field.key, value)}
            />
          ) : field.type === 'boolean' ? (
            <input
              type="checkbox"
              aria-label={field.label || field.key}
              checked={resolvePreviewFormValue(field, values[field.key]) === true}
              onChange={(event) => onChange(field.key, event.currentTarget.checked)}
            />
          ) : field.type === 'color' ? (
            <ColorInput
              label={field.label || field.key}
              value={String(values[field.key] ?? field.defaultValue ?? '#000000')}
              alpha={field.generatedShaderParameter?.glslType === 'vec4'}
              onChange={(value) => onChange(field.key, value)}
            />
          ) : field.type === 'select' ? (
            <select
              aria-label={field.label || field.key}
              value={String(values[field.key] ?? field.defaultValue)}
              onChange={(event) => onChange(field.key, event.target.value)}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              aria-label={field.label || field.key}
              value={String(values[field.key] ?? '')}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          )}
        </PropertyRow>
      ))}
    </div>
  );
}
