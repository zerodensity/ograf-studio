import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { Panel } from './Panel';
import './ResourcesPanel.css';

const PLACEHOLDER_GROUPS = ['Compositions', 'Image sequences'] as const;

export function ResourcesPanel() {
  const composition = useActiveComposition();
  const importAsset = useProjectStore((s) => s.importAsset);
  const importSvgBundle = useProjectStore((s) => s.importSvgBundle);
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

  useEffect(() => {
    const loaded: FontFace[] = [];
    let cancelled = false;
    for (const asset of composition.assets.filter((candidate) => candidate.kind === 'font')) {
      const family = asset.fontFamily || asset.name.replace(/\.[^.]+$/, '');
      const face = new FontFace(family, `url(${asset.dataUri})`, { weight: '100 900' });
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
      for (const file of files.filter((file) => file.type.startsWith('image/'))) {
        void importAsset(file);
      }
    }
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
                    <span className="resources-asset-name" title={asset.name}>
                      {asset.name}
                    </span>
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
                    <span className="resources-asset-name" title={asset.name}>
                      {asset.fontFamily || asset.name}
                    </span>
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

        <ul className="panel-placeholder-list">
          {PLACEHOLDER_GROUPS.map((group) => (
            <li key={group}>{group}</li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
