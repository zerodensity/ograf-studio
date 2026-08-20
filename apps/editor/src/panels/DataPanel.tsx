import { useState, type ChangeEvent } from 'react';
import { defaultValueForFieldType, type FieldType } from '@ograf-editor/scene-model';
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
  { value: 'boolean', label: 'Boolean' },
  { value: 'color', label: 'Color' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image-url', label: 'Image URL' },
];

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
                  <tr key={field.id}>
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
                          updateDataField(field.id, {
                            type,
                            defaultValue: defaultValueForFieldType(type),
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
                        type={field.type}
                        value={field.defaultValue}
                        onChange={(value) => updateDataField(field.id, { defaultValue: value })}
                      />
                    </td>
                    <td className="data-table-checkbox-cell">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateDataField(field.id, { required: e.target.checked })}
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
                    type={field.type}
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

function DefaultValueInput({
  type,
  value,
  onChange,
}: {
  type: FieldType;
  value: TestValue;
  onChange: (value: TestValue) => void;
}) {
  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
    );
  }
  if (type === 'number') {
    return (
      <input
        type="number"
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
    return <textarea rows={2} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  }
  if (type === 'gradient') {
    return typeof value === 'object' ? <PaintEditor value={value} onChange={onChange} /> : null;
  }
  return (
    <input
      type="text"
      placeholder={type === 'image-url' ? 'https://…' : undefined}
      value={String(value)}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}
