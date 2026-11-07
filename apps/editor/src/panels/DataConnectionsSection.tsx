import { useMemo, useRef } from 'react';
import {
  DEFAULT_PUBLIC_MARKET_SYMBOLS,
  type DataConnectionDefinition,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import {
  connectionRuntimeKey,
  refreshDataConnection,
  useDataConnectionRuntimeStore,
} from '../state/dataConnectionRuntime';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { publicMarketFieldKeys } from '../data/publicMarkets';

export function DataConnectionsSection() {
  const composition = useActiveComposition();
  const projectId = useProjectStore((state) => state.project.id);
  const add = useProjectStore((state) => state.addDataConnection);
  const update = useProjectStore((state) => state.updateDataConnection);
  const remove = useProjectStore((state) => state.removeDataConnection);
  const statuses = useDataConnectionRuntimeStore((state) => state.statuses);
  const fileInputs = useRef(new Map<string, HTMLInputElement>());
  const connections = useMemo(
    () => composition.dataConnections ?? [],
    [composition.dataConnections],
  );

  return (
    <CollapsibleSection
      sectionId="data.connections"
      title="Data Connections"
      className="data-panel-section"
      actions={
        <button type="button" onClick={() => add()}>
          + Add Connection
        </button>
      }
    >
      <p className="inspector-hint">
        Enabled connections keep updating while this pane is closed. Exported OGraf packages receive
        ordinary GDD data from playout.
      </p>
      {connections.length === 0 ? (
        <p className="panel-placeholder">Add a URL, imported data or a public market feed.</p>
      ) : (
        connections.map((connection) => (
          <div className="data-field-schema-node" key={connection.id}>
            <input
              aria-label="Data connection name"
              value={connection.name}
              onChange={(event) => update(connection.id, { name: event.target.value })}
            />
            {connection.source !== 'public-markets' && (
              <label>
                Format
                <select
                  value={connection.format}
                  onChange={(event) =>
                    update(connection.id, { format: event.target.value as 'json' | 'csv' })
                  }
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
            )}
            <label>
              Source
              <select
                value={connection.source}
                onChange={(event) => {
                  const source = event.target.value as DataConnectionDefinition['source'];
                  const publicKeys = new Set(
                    publicMarketFieldKeys(connection.publicMarkets?.symbols),
                  );
                  update(connection.id, {
                    source,
                    ...(source === 'public-markets'
                      ? {
                          format: 'json',
                          target: 'both',
                          refreshMs: 5000,
                          missing: 'keep-last',
                          publicMarkets: connection.publicMarkets ?? {
                            symbols: [...DEFAULT_PUBLIC_MARKET_SYMBOLS],
                          },
                          mappings: composition.dataFields
                            .filter((field) => publicKeys.has(field.key))
                            .map((field) => ({ fieldId: field.id, sourcePath: field.key })),
                        }
                      : {}),
                  });
                }}
              >
                <option value="url">URL</option>
                <option value="embedded">Imported / pasted</option>
                <option value="public-markets">Public markets · Coinbase + ECB</option>
              </select>
            </label>
            <label>
              Update
              <select
                value={connection.target ?? 'editor-preview'}
                onChange={(event) =>
                  update(connection.id, {
                    target: event.target.value as DataConnectionDefinition['target'],
                  })
                }
              >
                <option value="editor-preview">Editor preview</option>
                <option value="coordinated-preview">On-air templates</option>
                <option value="both">Editor and on-air templates</option>
              </select>
            </label>
            {connection.source === 'public-markets' ? (
              <>
                <label>
                  Digital asset products
                  <input
                    key={(connection.publicMarkets?.symbols ?? DEFAULT_PUBLIC_MARKET_SYMBOLS).join(
                      ',',
                    )}
                    defaultValue={(
                      connection.publicMarkets?.symbols ?? DEFAULT_PUBLIC_MARKET_SYMBOLS
                    ).join(', ')}
                    placeholder="BTC-USD, ETH-USD"
                    onChange={(event) => event.currentTarget.setCustomValidity('')}
                    onBlur={(event) => {
                      const symbols = event.currentTarget.value
                        .split(/[\s,]+/)
                        .filter(Boolean)
                        .map((symbol) => symbol.toUpperCase());
                      if (
                        !symbols.length ||
                        symbols.length > 16 ||
                        new Set(symbols).size !== symbols.length ||
                        symbols.some((symbol) => !/^[A-Z0-9]{1,12}-USD$/.test(symbol))
                      ) {
                        event.currentTarget.setCustomValidity(
                          'Enter 1–16 unique USD products, such as BTC-USD.',
                        );
                        event.currentTarget.reportValidity();
                        return;
                      }
                      update(connection.id, { publicMarkets: { symbols } });
                    }}
                  />
                </label>
                <p className="inspector-hint">
                  Coinbase quotes refresh at most every 15 seconds, with 24-hour changes. FX uses
                  dated daily ECB reference rates. No API key required; quote age and feed status
                  are included.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const keys = new Set(publicMarketFieldKeys(connection.publicMarkets?.symbols));
                    update(connection.id, {
                      mappings: composition.dataFields
                        .filter((field) => keys.has(field.key))
                        .map((field) => ({
                          fieldId: field.id,
                          sourcePath: field.key,
                        })),
                    });
                  }}
                >
                  Map matching field keys
                </button>
              </>
            ) : connection.source === 'url' ? (
              <label>
                URL
                <input
                  type="url"
                  placeholder="https://example.com/data.json"
                  value={connection.url}
                  onChange={(event) => update(connection.id, { url: event.target.value })}
                />
              </label>
            ) : (
              <>
                <textarea
                  aria-label="Embedded data"
                  rows={4}
                  value={connection.embeddedText}
                  onChange={(event) => update(connection.id, { embeddedText: event.target.value })}
                />
                <button
                  type="button"
                  onClick={() => fileInputs.current.get(connection.id)?.click()}
                >
                  Import CSV / JSON…
                </button>
                <input
                  ref={(element) => {
                    if (element) fileInputs.current.set(connection.id, element);
                    else fileInputs.current.delete(connection.id);
                  }}
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    void file.text().then((embeddedText) =>
                      update(connection.id, {
                        embeddedText,
                        format: file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json',
                      }),
                    );
                  }}
                />
              </>
            )}
            <label>
              Refresh ms
              <input
                type="number"
                min={0}
                value={connection.refreshMs}
                onChange={(event) =>
                  update(connection.id, { refreshMs: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Missing data
              <select
                value={connection.missing}
                onChange={(event) =>
                  update(connection.id, {
                    missing: event.target.value as typeof connection.missing,
                  })
                }
              >
                <option value="default">Use field default</option>
                <option value="empty">Use empty value</option>
                <option value="keep-last">Keep last value</option>
              </select>
            </label>
            {composition.dataFields.map((field) => {
              const mapping = connection.mappings.find(
                (candidate) => candidate.fieldId === field.id,
              );
              return (
                <label key={field.id}>
                  {field.label || field.key} path / column
                  <input
                    value={mapping?.sourcePath ?? ''}
                    placeholder={field.key}
                    onChange={(event) => {
                      const others = connection.mappings.filter(
                        (candidate) => candidate.fieldId !== field.id,
                      );
                      update(connection.id, {
                        mappings: event.target.value
                          ? [...others, { fieldId: field.id, sourcePath: event.target.value }]
                          : others,
                      });
                    }}
                  />
                </label>
              );
            })}
            <div className="resources-tree-actions wrap">
              <button
                type="button"
                disabled={
                  statuses[connectionRuntimeKey(projectId, composition.id, connection.id)]?.pending
                }
                onClick={() =>
                  void refreshDataConnection(projectId, composition.id, connection.id).catch(
                    () => undefined,
                  )
                }
              >
                Refresh now
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={connection.enabled}
                  onChange={(event) => update(connection.id, { enabled: event.target.checked })}
                />
                Enabled
              </label>
              <button
                type="button"
                className="data-table-delete"
                onClick={() => remove(connection.id)}
              >
                Remove
              </button>
            </div>
            {statuses[connectionRuntimeKey(projectId, composition.id, connection.id)] ? (
              <p className="inspector-hint" role="status">
                {statuses[connectionRuntimeKey(projectId, composition.id, connection.id)]!.message}
              </p>
            ) : null}
          </div>
        ))
      )}
    </CollapsibleSection>
  );
}
