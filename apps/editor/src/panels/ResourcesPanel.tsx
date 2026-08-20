import { useRef, type ChangeEvent } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { Panel } from './Panel';
import './ResourcesPanel.css';

const PLACEHOLDER_GROUPS = ['Compositions', 'Image sequences', 'Fonts'] as const;

export function ResourcesPanel() {
  const composition = useActiveComposition();
  const importAsset = useProjectStore((s) => s.importAsset);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void importAsset(file);
  };

  return (
    <Panel title="Resources">
      <div className="resources-panel">
        <section className="data-panel-section">
          <div className="data-panel-section-header">
            <h3>Images</h3>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              {'+ Import Image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="resources-file-input"
              onChange={handleFileChange}
            />
          </div>

          {composition.assets.length === 0 ? (
            <p className="panel-placeholder">No images imported yet.</p>
          ) : (
            <ul className="resources-asset-list">
              {composition.assets.map((asset) => (
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
