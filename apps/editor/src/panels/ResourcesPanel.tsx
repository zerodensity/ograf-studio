import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  findAssetConsumers,
  findMissingAssetReferences,
  isSafePackagePath,
  type Asset,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { ResourceTreeBranch, ResourceTreeItem } from './ResourceTreeComponents';
import { Panel } from './Panel';
import { TilingPatternEditor } from './TilingPatternEditor';
import { partitionResourceAssets } from './resourceTree';
import './ResourcesPanel.css';
import { useImagePlacement } from '../state/useImagePlacement';

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function ResourcesPanel() {
  const imagePlacement = useImagePlacement();
  const composition = useActiveComposition();
  const addPattern = useProjectStore((s) => s.addLayer);
  const addPatternInstance = useProjectStore((s) => s.addPatternInstance);
  const removePattern = useProjectStore((s) => s.removeTilingPattern);
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
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const [svgImportStatus, setSvgImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const missingReferences = useMemo(() => findMissingAssetReferences(composition), [composition]);
  const assetsByKind = useMemo(
    () => partitionResourceAssets(composition.assets),
    [composition.assets],
  );
  const imageAssets = assetsByKind.images;
  const fontAssets = assetsByKind.fonts;
  const sourceAssets = assetsByKind.sources;

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
  const linkedInstanceCount = (componentId: string) =>
    new Set(
      composition.layers
        .filter((layer) => layer.componentLink?.componentId === componentId)
        .map((layer) => layer.componentLink!.instanceId),
    ).size;

  return (
    <Panel title="Resources">
      <div className="resources-panel">
        <div className="resources-tree" role="tree" aria-label="Project resources">
          <ResourceTreeBranch label="Patterns" count={composition.patterns.length}>
            <button
              onClick={() => {
                const id = addPattern('pattern');
                selectMany([id]);
              }}
            >
              Add procedural pattern
            </button>
            {composition.patterns.map((pattern) => (
              <ResourceTreeItem key={pattern.id} label={pattern.name} meta={`${pattern.rows} rows`}>
                <div className="resources-tree-toolbar">
                  <button onClick={() => selectMany([addPatternInstance(pattern.id)])}>
                    Add linked layer
                  </button>
                  <button
                    disabled={[
                      ...composition.layers,
                      ...composition.components.flatMap((c) => c.layers),
                    ].some(
                      (l) => l.element.type === 'pattern' && l.element.patternId === pattern.id,
                    )}
                    onClick={() => removePattern(pattern.id)}
                  >
                    Remove pattern
                  </button>
                </div>
                <TilingPatternEditor pattern={pattern} frameRate={composition.frameRate} />
              </ResourceTreeItem>
            ))}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Components" count={composition.components.length}>
            <div className="resources-tree-toolbar">
              <span>Reusable layer snapshots</span>
              <button
                type="button"
                disabled={selectedLayerIds.length === 0}
                onClick={() => createComponent(selectedLayerIds)}
              >
                + Save Selection
              </button>
            </div>
            {composition.components.length === 0 ? (
              <p className="panel-placeholder">No saved components.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {composition.components.map((component) => {
                  const linked = linkedInstanceCount(component.id);
                  return (
                    <ResourceTreeItem
                      key={component.id}
                      label={component.name}
                      meta={`${component.layers.length} layers · ${linked} linked`}
                      preview={<span className="resources-tree-item-icon">C</span>}
                    >
                      <input
                        aria-label="Component name"
                        value={component.name}
                        onChange={(event) => renameComponent(component.id, event.target.value)}
                      />
                      <div className="resources-tree-actions wrap">
                        <button
                          type="button"
                          onClick={() => selectMany(instantiateComponent(component.id))}
                        >
                          Insert
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            selectMany(instantiateComponent(component.id, undefined, true))
                          }
                        >
                          Link
                        </button>
                        <button
                          type="button"
                          disabled={selectedLayerIds.length === 0}
                          onClick={() => updateComponentFromLayers(component.id, selectedLayerIds)}
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          disabled={linked === 0}
                          onClick={() => selectMany(refreshLinkedComponentInstances(component.id))}
                        >
                          Refresh {linked || ''}
                        </button>
                        <button
                          type="button"
                          className="data-table-delete"
                          onClick={() => removeComponent(component.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Images" count={imageAssets.length}>
            <div className="resources-tree-toolbar">
              <span>Images and SVG bundles</span>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                + Import
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
            {imageAssets.length === 0 ? (
              <p className="panel-placeholder">No images imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {imageAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <ResourceTreeItem
                      key={asset.id}
                      label={asset.name}
                      meta={`${formatBytes(asset.byteSize)} · ${uses} uses`}
                      preview={<img src={asset.dataUri} alt="" className="resources-asset-thumb" />}
                    >
                      <div className="resources-asset-fields">
                        <input
                          aria-label="Resource name"
                          value={asset.name}
                          onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                        />
                        <span className="resources-asset-meta">
                          {asset.originalFileName || asset.name} · {asset.mimeType}
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
                        <div className="resources-tree-actions">
                          <span>{uses} use(s)</span>
                          <button
                            type="button"
                            disabled={imagePlacement.busy}
                            onClick={() => void imagePlacement.place({ assetId: asset.id })}
                          >
                            Add to canvas
                          </button>
                          <button
                            type="button"
                            className="data-table-delete"
                            disabled={uses > 0}
                            onClick={() => removeAsset(asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
            <p className="inspector-hint">Select SVG companion files together when importing.</p>
            {imagePlacement.error && (
              <p className="image-placement-error" role="alert">
                {imagePlacement.error}
              </p>
            )}
            {svgImportStatus && <p className="inspector-hint">{svgImportStatus}</p>}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Fonts" count={fontAssets.length}>
            <div className="resources-tree-toolbar">
              <span>Packaged font faces</span>
              <button type="button" onClick={() => fontInputRef.current?.click()}>
                + Import
              </button>
              <input
                ref={fontInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                className="resources-file-input"
                onChange={handleFileChange}
              />
            </div>
            {fontAssets.length === 0 ? (
              <p className="panel-placeholder">No fonts imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {fontAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <ResourceTreeItem
                      key={asset.id}
                      label={asset.name}
                      meta={`${asset.fontFamily || 'Unassigned family'} · ${uses} uses`}
                      preview={
                        <span
                          className="resources-tree-font-preview"
                          title={`Template font: ${asset.fontFamily || asset.name}`}
                        >
                          Aa
                        </span>
                      }
                    >
                      <div className="resources-asset-fields">
                        <input
                          aria-label="Resource name"
                          value={asset.name}
                          onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                        />
                        <span className="resources-asset-meta">
                          {asset.originalFileName || asset.name} · {formatBytes(asset.byteSize)}
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
                        <div className="resources-tree-actions">
                          <span>{uses} use(s)</span>
                          <button
                            type="button"
                            className="data-table-delete"
                            disabled={uses > 0}
                            onClick={() => removeAsset(asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Source attachments" count={sourceAssets.length}>
            <div className="resources-tree-toolbar">
              <span>CSS, JSON and source references</span>
              <button type="button" onClick={() => sourceInputRef.current?.click()}>
                + Attach
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
            {sourceAssets.length === 0 ? (
              <p className="panel-placeholder">No source documents attached.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {sourceAssets.map((asset) => (
                  <ResourceTreeItem
                    key={asset.id}
                    label={asset.name}
                    meta={`${asset.mimeType} · ${formatBytes(asset.byteSize)}`}
                    preview={<span className="resources-tree-item-icon">S</span>}
                  >
                    <div className="resources-asset-fields">
                      <input
                        aria-label="Resource name"
                        value={asset.name}
                        onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                      />
                      <span className="resources-asset-meta">
                        {asset.originalFileName || asset.name} · {asset.mimeType}
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
                      <div className="resources-tree-actions">
                        <span>{formatBytes(asset.byteSize)}</span>
                        <button
                          type="button"
                          className="data-table-delete"
                          onClick={() => removeAsset(asset.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </ResourceTreeItem>
                ))}
              </div>
            )}
          </ResourceTreeBranch>
        </div>

        {missingReferences.length > 0 && (
          <p className="resources-asset-warning" role="alert">
            Missing resources: {missingReferences.join(', ')}
          </p>
        )}
      </div>
    </Panel>
  );
}
