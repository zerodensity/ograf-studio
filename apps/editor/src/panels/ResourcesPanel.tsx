import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  findAssetConsumers,
  findMissingAssetReferences,
  isSafePackagePath,
  type Asset,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { Panel } from './Panel';
import './ResourcesPanel.css';

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function ResourcesPanel() {
  const composition = useActiveComposition();
  const importAsset = useProjectStore((s) => s.importAsset);
  const importSvgBundle = useProjectStore((s) => s.importSvgBundle);
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const createComponent = useProjectStore((s) => s.createComponent);
  const instantiateComponent = useProjectStore((s) => s.instantiateComponent);
  const renameComponent = useProjectStore((s) => s.renameComponent);
  const removeComponent = useProjectStore((s) => s.removeComponent);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const [svgImportStatus, setSvgImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const missingReferences = useMemo(() => findMissingAssetReferences(composition), [composition]);

  useEffect(() => {
    const loaded: FontFace[] = [];
    let cancelled = false;
    for (const asset of composition.assets.filter((candidate) => candidate.kind === 'font')) {
      const family = asset.fontFamily || asset.name.replace(/\.[^.]+$/, '');
      const face = new FontFace(family, `url(${asset.dataUri})`, {
        weight: asset.fontWeight || '100 900',
        style: asset.fontStyle || 'normal',
      });
      void face
        .load()
        .then((ready) => {
          if (cancelled) return;
          document.fonts.add(ready);
          loaded.push(ready);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      for (const face of loaded) document.fonts.delete(face);
    };
  }, [composition.assets]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0) return;
    if (files.some((file) => file.name.toLowerCase().endsWith('.svg'))) {
      setSvgImportStatus('Importing portable SVG bundle…');
      void importSvgBundle(files)
        .then(({ warnings }) => {
          setSvgImportStatus(
            warnings.length === 0
              ? 'SVG bundle imported with all selected resources embedded.'
              : `SVG imported with ${warnings.length} unresolved companion resource${warnings.length === 1 ? '' : 's'}: ${warnings.join(' ')}`,
          );
        })
        .catch((error: unknown) => {
          setSvgImportStatus(error instanceof Error ? error.message : String(error));
        });
    } else {
      for (const file of files) {
        void importAsset(file);
      }
      setSvgImportStatus(
        `${files.length} resource${files.length === 1 ? '' : 's'} imported; identical payloads reuse one registry entry.`,
      );
    }
  };

  const usageCount = (asset: Asset) => {
    const consumers = findAssetConsumers(composition, asset);
    return consumers.layerIds.length + consumers.fieldIds.length + consumers.fontLayerIds.length;
  };

  return (
    <Panel title="Resources">
      <div className="resources-panel">
        <section className="data-panel-section">
          <div className="data-panel-section-header">
            <h3>Components</h3>
            <button
              type="button"
              disabled={selectedLayerIds.length === 0}
              onClick={() => createComponent(selectedLayerIds)}
              title="Save the selected layers and their bound fields as a reusable component"
            >
              {'+ Save Selection'}
            </button>
          </div>
          {composition.components.length === 0 ? (
            <p className="panel-placeholder">Select layers to save a reusable component.</p>
          ) : (
            <ul className="resources-asset-list">
              {composition.components.map((component) => (
                <li key={component.id} className="resources-asset-row">
                  <input
                    className="resources-component-name"
                    aria-label="Component name"
                    value={component.name}
                    onChange={(event) => renameComponent(component.id, event.target.value)}
                  />
                  <span className="resources-component-count">
                    {component.layers.length} layer{component.layers.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectMany(instantiateComponent(component.id))}
                    title="Insert an independent editable instance"
                  >
                    Insert
                  </button>
                  <button
                    type="button"
                    className="data-table-delete"
                    onClick={() => removeComponent(component.id)}
                    title="Remove this saved component; existing instances remain"
                  >
                    {'✕'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="inspector-hint">
            Inserted components are normal OGraf layers and remain independently editable.
          </p>
        </section>

        <section className="data-panel-section">
          <div className="data-panel-section-header">
            <h3>Images</h3>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              {'+ Import Image/SVG Bundle'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.css,.ttf,.otf,.woff,.woff2"
              multiple
              className="resources-file-input"
              onChange={handleFileChange}
            />
          </div>

          {composition.assets.filter((asset) => asset.kind === 'image').length === 0 ? (
            <p className="panel-placeholder">No images imported yet.</p>
          ) : (
            <ul className="resources-asset-list">
              {composition.assets
                .filter((asset) => asset.kind === 'image')
                .map((asset) => (
                  <li key={asset.id} className="resources-asset-row">
                    <img src={asset.dataUri} alt="" className="resources-asset-thumb" />
                    <div className="resources-asset-fields">
                      <input
                        aria-label="Resource name"
                        value={asset.name}
                        onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                      />
                      <span className="resources-asset-meta">
                        {asset.originalFileName || asset.name} · {asset.mimeType} ·{' '}
                        {formatBytes(asset.byteSize)} · {usageCount(asset)} use(s)
                      </span>
                      <input
                        aria-label="Package path"
                        className={
                          !asset.packagePath || isSafePackagePath(asset.packagePath)
                            ? ''
                            : 'invalid'
                        }
                        placeholder={`assets/${asset.id}`}
                        value={asset.packagePath ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, { packagePath: event.target.value || undefined })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="data-table-delete"
                      disabled={usageCount(asset) > 0}
                      onClick={() => removeAsset(asset.id)}
                      title={
                        usageCount(asset) > 0
                          ? 'Remove or retarget every resource use first'
                          : 'Remove resource'
                      }
                    >
                      {'✕'}
                    </button>
                  </li>
                ))}
            </ul>
          )}
          <p className="inspector-hint">
            For Photoshop SVG exports, select the SVG, CSS, linked images, and fonts together.
          </p>
          {svgImportStatus && <p className="inspector-hint">{svgImportStatus}</p>}
        </section>

        <section className="data-panel-section">
          <div className="data-panel-section-header">
            <h3>Fonts</h3>
            <button type="button" onClick={() => fontInputRef.current?.click()}>
              {'+ Import Font'}
            </button>
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
              className="resources-file-input"
              onChange={handleFileChange}
            />
          </div>
          {composition.assets.filter((asset) => asset.kind === 'font').length === 0 ? (
            <p className="panel-placeholder">No fonts imported yet.</p>
          ) : (
            <ul className="resources-asset-list">
              {composition.assets
                .filter((asset) => asset.kind === 'font')
                .map((asset) => (
                  <li key={asset.id} className="resources-asset-row">
                    <span
                      className="resources-font-preview"
                      style={{
                        fontFamily: asset.fontFamily,
                        fontWeight: asset.fontWeight,
                        fontStyle: asset.fontStyle,
                      }}
                    >
                      Aa 123
                    </span>
                    <div className="resources-asset-fields">
                      <input
                        aria-label="Resource name"
                        value={asset.name}
                        onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                      />
                      <span className="resources-asset-meta">
                        {asset.originalFileName || asset.name} · {asset.mimeType} ·{' '}
                        {formatBytes(asset.byteSize)} · {usageCount(asset)} use(s)
                      </span>
                      <input
                        aria-label="Font family"
                        placeholder="Font family"
                        value={asset.fontFamily ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, { fontFamily: event.target.value })
                        }
                      />
                      <div className="resources-asset-inline">
                        <input
                          aria-label="Font weight"
                          placeholder="100 900"
                          value={asset.fontWeight ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { fontWeight: event.target.value })
                          }
                        />
                        <select
                          aria-label="Font style"
                          value={asset.fontStyle ?? 'normal'}
                          onChange={(event) =>
                            updateAsset(asset.id, {
                              fontStyle: event.target.value as Asset['fontStyle'],
                            })
                          }
                        >
                          <option value="normal">Normal</option>
                          <option value="italic">Italic</option>
                          <option value="oblique">Oblique</option>
                        </select>
                      </div>
                      <input
                        aria-label="Package path"
                        className={
                          !asset.packagePath || isSafePackagePath(asset.packagePath)
                            ? ''
                            : 'invalid'
                        }
                        placeholder={`assets/${asset.id}`}
                        value={asset.packagePath ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, { packagePath: event.target.value || undefined })
                        }
                      />
                      <input
                        aria-label="Font license name"
                        placeholder="License name, e.g. OFL-1.1"
                        value={asset.licenseName ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, { licenseName: event.target.value })
                        }
                      />
                      <input
                        aria-label="Font license URL"
                        placeholder="License URL"
                        value={asset.licenseUrl ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, { licenseUrl: event.target.value })
                        }
                      />
                      <textarea
                        aria-label="Font license text"
                        rows={2}
                        placeholder="Optional license text packaged under licenses/"
                        value={asset.licenseText ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, { licenseText: event.target.value })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="data-table-delete"
                      disabled={usageCount(asset) > 0}
                      onClick={() => removeAsset(asset.id)}
                      title={
                        usageCount(asset) > 0
                          ? 'Remove or retarget every resource use first'
                          : 'Remove resource'
                      }
                    >
                      {'✕'}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="data-panel-section">
          <div className="data-panel-section-header">
            <h3>Source attachments</h3>
            <button type="button" onClick={() => sourceInputRef.current?.click()}>
              {'+ Attach Source'}
            </button>
            <input
              ref={sourceInputRef}
              type="file"
              accept=".css,.json,.txt,.md,.xml,.license,text/*,application/json"
              multiple
              className="resources-file-input"
              onChange={handleFileChange}
            />
          </div>
          {composition.assets.filter((asset) => asset.kind === 'source').length === 0 ? (
            <p className="panel-placeholder">No source documents attached.</p>
          ) : (
            <ul className="resources-asset-list">
              {composition.assets
                .filter((asset) => asset.kind === 'source')
                .map((asset) => (
                  <li key={asset.id} className="resources-asset-row">
                    <div className="resources-asset-fields">
                      <input
                        aria-label="Resource name"
                        value={asset.name}
                        onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                      />
                      <span className="resources-asset-meta">
                        {asset.originalFileName || asset.name} · {asset.mimeType} ·{' '}
                        {formatBytes(asset.byteSize)}
                      </span>
                      <input
                        aria-label="Package path"
                        className={
                          !asset.packagePath || isSafePackagePath(asset.packagePath)
                            ? ''
                            : 'invalid'
                        }
                        placeholder={`assets/${asset.id}`}
                        value={asset.packagePath ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, { packagePath: event.target.value || undefined })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="data-table-delete"
                      onClick={() => removeAsset(asset.id)}
                    >
                      {'✕'}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>

        {missingReferences.length > 0 && (
          <p className="resources-asset-warning" role="alert">
            Missing resources: {missingReferences.join(', ')}
          </p>
        )}
      </div>
    </Panel>
  );
}
