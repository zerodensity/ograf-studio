import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  findAssetConsumers,
  findMissingAssetReferences,
  isSafePackagePath,
  STYLE_PACKS,
  stylePackIdForComposition,
  type Asset,
  type DesignTokenType,
  type StylePackId,
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
  const updateComponentFromLayers = useProjectStore((s) => s.updateComponentFromLayers);
  const refreshLinkedComponentInstances = useProjectStore((s) => s.refreshLinkedComponentInstances);
  const renameComponent = useProjectStore((s) => s.renameComponent);
  const removeComponent = useProjectStore((s) => s.removeComponent);
  const setDesignSystemName = useProjectStore((s) => s.setDesignSystemName);
  const applyStylePack = useProjectStore((s) => s.applyStylePack);
  const addDesignToken = useProjectStore((s) => s.addDesignToken);
  const updateDesignToken = useProjectStore((s) => s.updateDesignToken);
  const removeDesignToken = useProjectStore((s) => s.removeDesignToken);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const [svgImportStatus, setSvgImportStatus] = useState<string | null>(null);
  const [selectedStylePack, setSelectedStylePack] = useState<StylePackId>(
    stylePackIdForComposition(composition) ?? 'news',
  );
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

  useEffect(() => {
    const current = stylePackIdForComposition(composition);
    if (current) setSelectedStylePack(current);
  }, [composition]);

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
  const tokenUsageCount = (tokenId: string) =>
    composition.layers.filter((layer) =>
      layer.designTokenBindings.some((binding) => binding.tokenId === tokenId),
    ).length;
  const defaultTokenValue = (type: DesignTokenType): string | number => {
    if (type === 'color') return '#ffffff';
    if (type === 'number') return 16;
    if (type === 'font-weight') return 700;
    if (type === 'font-family') return 'Arial';
    return '';
  };
  const linkedInstanceCount = (componentId: string) =>
    new Set(
      composition.layers
        .filter((layer) => layer.componentLink?.componentId === componentId)
        .map((layer) => layer.componentLink!.instanceId),
    ).size;

  return (
    <Panel title="Resources">
      <div className="resources-panel">
        <section className="data-panel-section">
          <div className="resources-style-pack-row">
            <select
              aria-label="Broadcast style pack"
              value={selectedStylePack}
              onChange={(event) => setSelectedStylePack(event.target.value as StylePackId)}
            >
              {STYLE_PACKS.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => applyStylePack(selectedStylePack)}
              title="Copy editable pack tokens and apply them to compatible semantic layers"
            >
              Apply Pack
            </button>
          </div>
          <div className="data-panel-section-header">
            <input
              className="resources-component-name"
              aria-label="Brand kit name"
              value={composition.designSystem.name}
              onChange={(event) => setDesignSystemName(event.target.value)}
            />
            <button type="button" onClick={() => addDesignToken('color')}>
              {'+ Token'}
            </button>
          </div>
          {composition.designSystem.tokens.length === 0 ? (
            <p className="panel-placeholder">
              Add reusable colours, typography, and measurements for this brand.
            </p>
          ) : (
            <ul className="resources-asset-list">
              {composition.designSystem.tokens.map((token) => {
                const uses = tokenUsageCount(token.id);
                return (
                  <li key={token.id} className="resources-asset-row">
                    {token.type === 'color' && typeof token.value === 'string' ? (
                      <input
                        aria-label={`${token.name} colour`}
                        type="color"
                        value={token.value.slice(0, 7)}
                        onChange={(event) =>
                          updateDesignToken(token.id, { value: event.target.value })
                        }
                      />
                    ) : (
                      <span className="resources-font-preview">T</span>
                    )}
                    <div className="resources-asset-fields">
                      <div className="resources-asset-inline">
                        <input
                          aria-label="Token name"
                          value={token.name}
                          onChange={(event) =>
                            updateDesignToken(token.id, { name: event.target.value })
                          }
                        />
                        <input
                          aria-label="Token key"
                          value={token.key}
                          onChange={(event) =>
                            updateDesignToken(token.id, { key: event.target.value })
                          }
                        />
                      </div>
                      <div className="resources-asset-inline">
                        <select
                          aria-label="Token type"
                          value={token.type}
                          onChange={(event) => {
                            const type = event.target.value as DesignTokenType;
                            updateDesignToken(token.id, {
                              type,
                              value: defaultTokenValue(type),
                            });
                          }}
                        >
                          <option value="color">Colour</option>
                          <option value="number">Number</option>
                          <option value="font-family">Font family</option>
                          <option value="font-weight">Font weight</option>
                          <option value="text">Text</option>
                        </select>
                        <input
                          aria-label="Token value"
                          type={
                            token.type === 'number' || token.type === 'font-weight'
                              ? 'number'
                              : 'text'
                          }
                          value={token.value}
                          onChange={(event) =>
                            updateDesignToken(token.id, {
                              value:
                                token.type === 'number' || token.type === 'font-weight'
                                  ? Number(event.target.value)
                                  : event.target.value,
                            })
                          }
                        />
                      </div>
                      <span className="resources-asset-meta">
                        {uses} linked layer{uses === 1 ? '' : 's'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="data-table-delete"
                      disabled={uses > 0}
                      onClick={() => removeDesignToken(token.id)}
                      title={uses > 0 ? 'Unlink this token before deleting it' : 'Delete token'}
                    >
                      {'✕'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="inspector-hint">
            Token values are materialized into normal OGraf properties and stay portable.
          </p>
        </section>

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
                    onClick={() => selectMany(instantiateComponent(component.id, undefined, true))}
                    title="Insert a portable layer instance that can be explicitly refreshed from this component"
                  >
                    Link
                  </button>
                  <button
                    type="button"
                    disabled={selectedLayerIds.length === 0}
                    onClick={() => updateComponentFromLayers(component.id, selectedLayerIds)}
                    title="Replace the saved component snapshot from the selected layers"
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    disabled={linkedInstanceCount(component.id) === 0}
                    onClick={() => selectMany(refreshLinkedComponentInstances(component.id))}
                    title="Refresh every linked instance; independent instances remain unchanged"
                  >
                    Refresh {linkedInstanceCount(component.id) || ''}
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
            Insert creates independent layers. Link creates normal portable layers that can be
            explicitly refreshed after updating the saved snapshot.
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
