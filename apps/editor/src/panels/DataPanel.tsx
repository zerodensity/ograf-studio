import { Fragment, useState, type ChangeEvent } from 'react';
import {
  defaultConstraintsForFieldType,
  defaultOptionsForFieldType,
  defaultValueForFieldType,
  type FieldConstraints,
  type FieldDefinition,
  type FieldOption,
  type FieldType,
} from '@ograf-editor/scene-model';
import { compileCustomActions, compileDataSchema } from '@ograf-editor/codegen';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useTestDataStore, type TestValue } from '../state/testDataStore';
import { Panel } from './Panel';
import { PaintEditor } from './PaintEditor';
import './DataPanel.css';

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'duration-ms', label: 'Duration (ms)' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'color', label: 'Color' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image-url', label: 'Image URL' },
  { value: 'file-path', label: 'File Path' },
  { value: 'select', label: 'Select' },
  { value: 'select-multiple', label: 'Select Multiple' },
];

function optionsText(options: FieldOption[]): string {
  return options.map((option) => `${option.value}|${option.label}`).join('\n');
}

function parseOptions(value: string): FieldOption[] {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf('|');
      const optionValue = (separator >= 0 ? line.slice(0, separator) : line).trim();
      const label = (separator >= 0 ? line.slice(separator + 1) : optionValue).trim();
      return { value: optionValue, label: label || optionValue };
    })
    .filter((option) => option.value.length > 0);
}

function constraintsWith(
  field: FieldDefinition,
  key: keyof FieldConstraints,
  value: number | string | undefined,
): FieldConstraints {
  const constraints = { ...field.constraints };
  if (value === undefined || value === '') delete constraints[key];
  else (constraints as Record<string, number | string>)[key] = value;
  return constraints;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function DataPanel() {
  const composition = useActiveComposition();
  const addDataField = useProjectStore((s) => s.addDataField);
  const removeDataField = useProjectStore((s) => s.removeDataField);
  const updateDataField = useProjectStore((s) => s.updateDataField);
  const addCustomAction = useProjectStore((s) => s.addCustomAction);
  const removeCustomAction = useProjectStore((s) => s.removeCustomAction);
  const updateCustomAction = useProjectStore((s) => s.updateCustomAction);

  const testValues = useTestDataStore((s) => s.values);
  const setTestValue = useTestDataStore((s) => s.setValue);
  const resetTestData = useTestDataStore((s) => s.resetAll);

  const [addFieldType, setAddFieldType] = useState<FieldType>('text');

  const schema = compileDataSchema(composition);
  const compiledCustomActions = compileCustomActions(composition);

  return (
    <Panel title="Data">
      <div className="data-panel">
        <section className="data-panel-section">
          <div className="data-panel-section-header">
            <h3>Fields</h3>
            <div className="data-panel-add-row">
              <select
                value={addFieldType}
                onChange={(e) => setAddFieldType(e.target.value as FieldType)}
              >
                {FIELD_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => addDataField(addFieldType)}>
                {'+ Add Field'}
              </button>
            </div>
          </div>

          {composition.dataFields.length === 0 ? (
            <p className="panel-placeholder">
              No fields yet — add one to make this template data-driven.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Default</th>
                  <th>Req.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {composition.dataFields.map((field) => (
                  <Fragment key={field.id}>
                    <tr>
                      <td>
                        <input
                          type="text"
                          value={field.key}
                          onChange={(e) => updateDataField(field.id, { key: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateDataField(field.id, { label: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          value={field.type}
                          onChange={(e) => {
                            const type = e.target.value as FieldType;
                            const options = defaultOptionsForFieldType(type);
                            updateDataField(field.id, {
                              type,
                              options,
                              constraints: defaultConstraintsForFieldType(type),
                              fileExtensions: [],
                              defaultValue: defaultValueForFieldType(type, options),
                            });
                          }}
                        >
                          {FIELD_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <DefaultValueInput
                          field={field}
                          value={field.defaultValue}
                          onChange={(value) => updateDataField(field.id, { defaultValue: value })}
                        />
                      </td>
                      <td className="data-table-checkbox-cell">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) =>
                            updateDataField(field.id, { required: e.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="data-table-delete"
                          onClick={() => removeDataField(field.id)}
                        >
                          {'✕'}
                        </button>
                      </td>
                    </tr>
                    <tr className="data-field-details-row">
                      <td colSpan={6}>
                        <FieldDetails field={field} update={updateDataField} />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="data-panel-section">
          <div className="data-panel-section-header">
            <h3>Custom Actions</h3>
            <button type="button" onClick={() => addCustomAction()}>
              {'+ Add Action'}
            </button>
          </div>

          {composition.customActions.length === 0 ? (
            <p className="panel-placeholder">No custom actions yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action ID</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {composition.customActions.map((action) => (
                  <tr key={action.id}>
                    <td>
                      <input
                        type="text"
                        value={action.actionId}
                        onChange={(e) =>
                          updateCustomAction(action.id, { actionId: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={action.name}
                        onChange={(e) => updateCustomAction(action.id, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={action.description}
                        onChange={(e) =>
                          updateCustomAction(action.id, { description: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="data-table-delete"
                        onClick={() => removeCustomAction(action.id)}
                      >
                        {'✕'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {composition.dataFields.length > 0 && (
          <section className="data-panel-section">
            <div className="data-panel-section-header">
              <h3>Test Data (live preview)</h3>
              <button type="button" onClick={resetTestData}>
                Reset to defaults
              </button>
            </div>
            <div className="test-data-form">
              {composition.dataFields.map((field) => (
                <label className="test-data-row" key={field.id}>
                  <span>{field.label || field.key}</span>
                  <DefaultValueInput
                    field={field}
                    value={testValues[field.id] ?? field.defaultValue}
                    onChange={(value) => setTestValue(field.id, value)}
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="data-panel-section">
          <h3>Compiled Schema Preview</h3>
          <pre className="data-json-preview">{JSON.stringify(schema, null, 2)}</pre>
          {compiledCustomActions.length > 0 && (
            <pre className="data-json-preview">
              {JSON.stringify(compiledCustomActions, null, 2)}
            </pre>
          )}
        </section>
      </div>
    </Panel>
  );
}

function FieldDetails({
  field,
  update,
}: {
  field: FieldDefinition;
  update: (
    fieldId: string,
    patch: Partial<
      Pick<
        FieldDefinition,
        'description' | 'defaultValue' | 'options' | 'constraints' | 'fileExtensions'
      >
    >,
  ) => void;
}) {
  const setConstraint = (key: keyof FieldConstraints, value: number | string | undefined) =>
    update(field.id, { constraints: constraintsWith(field, key, value) });
  return (
    <div className="data-field-details">
      <label>
        <span>Description</span>
        <input
          type="text"
          value={field.description}
          placeholder="Operator-facing help text"
          onChange={(event) => update(field.id, { description: event.target.value })}
        />
      </label>
      {(field.type === 'select' || field.type === 'select-multiple') && (
        <label className="data-field-options">
          <span>Options · one value|label per line</span>
          <textarea
            rows={Math.max(2, field.options.length)}
            value={optionsText(field.options)}
            onChange={(event) => {
              const options = parseOptions(event.target.value);
              const values = new Set(options.map((option) => option.value));
              const defaultValue =
                field.type === 'select-multiple'
                  ? Array.isArray(field.defaultValue)
                    ? field.defaultValue.filter((value) => values.has(value))
                    : []
                  : typeof field.defaultValue === 'string' && values.has(field.defaultValue)
                    ? field.defaultValue
                    : (options[0]?.value ?? '');
              update(field.id, { options, defaultValue });
            }}
          />
        </label>
      )}
      {(field.type === 'file-path' || field.type === 'image-url') && (
        <label>
          <span>Allowed extensions</span>
          <input
            type="text"
            value={field.fileExtensions.join(', ')}
            placeholder="png, svg, jpg"
            onChange={(event) =>
              update(field.id, {
                fileExtensions: [
                  ...new Set(
                    event.target.value
                      .split(',')
                      .map((extension) => extension.trim().replace(/^\./, '').toLowerCase())
                      .filter(Boolean),
                  ),
                ],
              })
            }
          />
        </label>
      )}
      <div className="data-field-constraints">
        <label>
          <span>Min length</span>
          <input
            type="number"
            min={0}
            value={field.constraints.minLength ?? ''}
            onChange={(event) => setConstraint('minLength', optionalNumber(event.target.value))}
          />
        </label>
        <label>
          <span>Max length</span>
          <input
            type="number"
            min={0}
            value={field.constraints.maxLength ?? ''}
            onChange={(event) => setConstraint('maxLength', optionalNumber(event.target.value))}
          />
        </label>
        <label>
          <span>Minimum</span>
          <input
            type="number"
            value={field.constraints.minimum ?? ''}
            onChange={(event) => setConstraint('minimum', optionalNumber(event.target.value))}
          />
        </label>
        <label>
          <span>Maximum</span>
          <input
            type="number"
            value={field.constraints.maximum ?? ''}
            onChange={(event) => setConstraint('maximum', optionalNumber(event.target.value))}
          />
        </label>
        <label>
          <span>Step</span>
          <input
            type="number"
            min={0}
            value={field.constraints.step ?? ''}
            onChange={(event) => setConstraint('step', optionalNumber(event.target.value))}
          />
        </label>
        <label className="data-field-pattern">
          <span>Pattern</span>
          <input
            type="text"
            value={field.constraints.pattern ?? ''}
            placeholder="JSON Schema regular expression"
            onChange={(event) => setConstraint('pattern', event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function DefaultValueInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: TestValue;
  onChange: (value: TestValue) => void;
}) {
  const { type } = field;
  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
    );
  }
  if (type === 'number' || type === 'integer' || type === 'duration-ms' || type === 'percentage') {
    return (
      <input
        type="number"
        min={field.constraints.minimum}
        max={field.constraints.maximum}
        step={field.constraints.step ?? (type === 'number' || type === 'percentage' ? 'any' : 1)}
        value={Number(value)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
    );
  }
  if (type === 'color') {
    return (
      <input
        type="color"
        value={String(value)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    );
  }
  if (type === 'textarea') {
    return (
      <textarea
        rows={2}
        value={String(value)}
        minLength={field.constraints.minLength}
        maxLength={field.constraints.maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (type === 'gradient') {
    return typeof value === 'object' && !Array.isArray(value) ? (
      <PaintEditor value={value} onChange={onChange} />
    ) : null;
  }
  if (type === 'select') {
    return (
      <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (type === 'select-multiple') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <select
        multiple
        value={selected}
        onChange={(event) =>
          onChange([...event.target.selectedOptions].map((option) => option.value))
        }
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      placeholder={type === 'image-url' ? 'asset:… or image path' : undefined}
      minLength={field.constraints.minLength}
      maxLength={field.constraints.maxLength}
      pattern={field.constraints.pattern}
      value={String(value)}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}
