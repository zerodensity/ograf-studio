import { useState, useEffect } from 'react';
import {
  STYLE_PACKS,
  stylePackIdForComposition,
  type StylePackId,
  type DesignTokenType,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { Panel } from './Panel';
import { ResourceTreeItem } from './ResourceTreeComponents';
import './ResourcesPanel.css';
import './BrandKitPanel.css';
export function BrandKitPanel() {
  const composition = useActiveComposition();
  const setDesignSystemName = useProjectStore((s) => s.setDesignSystemName);
  const applyStylePack = useProjectStore((s) => s.applyStylePack);
  const removeStylePack = useProjectStore((s) => s.removeStylePack);
  const appliedStylePack = stylePackIdForComposition(composition);
  const addDesignToken = useProjectStore((s) => s.addDesignToken);
  const updateDesignToken = useProjectStore((s) => s.updateDesignToken);
  const removeDesignToken = useProjectStore((s) => s.removeDesignToken);
  const [selectedStylePack, setSelectedStylePack] = useState<StylePackId>(
    stylePackIdForComposition(composition) ?? 'news',
  );
  useEffect(() => {
    const current = stylePackIdForComposition(composition);
    if (current) setSelectedStylePack(current);
  }, [composition]);
  const tokenUsageCount = (tokenId: string) =>
    composition.layers.filter((layer) =>
      layer.designTokenBindings.some((binding) => binding.tokenId === tokenId),
    ).length +
    composition.dataFields.filter((field) => field.defaultTokenId === tokenId).length +
    (composition.designSystem.stylePackColors ?? []).filter(
      (link) => link.sourceTokenId === tokenId || link.targetTokenId === tokenId,
    ).length;
  const defaultTokenValue = (type: DesignTokenType): string | number => {
    if (type === 'color') return '#ffffff';
    if (type === 'number') return 16;
    if (type === 'font-weight') return 700;
    if (type === 'font-family') return 'Arial';
    return '';
  };

  return (
    <Panel title="Brand Kit">
      <div className="resources-panel brand-kit-panel">
        <p className="inspector-hint" title="Playback updates can override these defaults.">
          Palette colors update linked playback defaults.
        </p>
        <div className="brand-kit-palette">
          {composition.designSystem.tokens
            .filter((t) => t.type === 'color')
            .map((token) => (
              <label key={token.id} className="brand-kit-color">
                <input
                  aria-label={`Palette ${token.name}`}
                  type="color"
                  value={String(token.value).slice(0, 7)}
                  onChange={(event) => updateDesignToken(token.id, { value: event.target.value })}
                />
                <span title={token.name}>{token.name}</span>
              </label>
            ))}
        </div>
        <div className="resources-tree-toolbar resources-style-pack-row">
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
          <button type="button" onClick={() => applyStylePack(selectedStylePack)}>
            Apply Pack
          </button>
        </div>
        <div className="resources-tree-toolbar">
          <span>
            {appliedStylePack
              ? `Applied: ${STYLE_PACKS.find((pack) => pack.id === appliedStylePack)?.name}`
              : 'No pack applied'}
          </span>
          <button
            type="button"
            disabled={!appliedStylePack}
            title={
              composition.designSystem.stylePackRestore
                ? 'Restore the fonts, colors and other styles recorded before the pack was applied.'
                : 'This older applied pack has no saved original styles. Removal detaches its tokens; use Undo or saved source to recover earlier styling.'
            }
            onClick={removeStylePack}
          >
            Remove applied pack
          </button>
        </div>
        {appliedStylePack && !composition.designSystem.stylePackRestore && (
          <p className="inspector-hint">
            Original styles were not saved with this older pack. Removal can only detach it.
          </p>
        )}
        <div className="resources-tree-toolbar">
          <input
            aria-label="Brand kit name"
            value={composition.designSystem.name}
            onChange={(event) => setDesignSystemName(event.target.value)}
          />
          <button type="button" onClick={() => addDesignToken('color')}>
            + Token
          </button>
        </div>
        {composition.designSystem.tokens.length === 0 ? (
          <p className="panel-placeholder">No design tokens.</p>
        ) : (
          <details className="brand-kit-advanced">
            <summary>Advanced tokens ({composition.designSystem.tokens.length})</summary>
            <div className="resources-tree-items" role="group">
              {composition.designSystem.tokens.map((token) => {
                const uses = tokenUsageCount(token.id);
                return (
                  <ResourceTreeItem
                    key={token.id}
                    label={token.name || token.key}
                    meta={`${token.type} · ${uses} linked`}
                    preview={
                      token.type === 'color' && typeof token.value === 'string' ? (
                        <span
                          className="resources-token-swatch"
                          style={{ background: token.value }}
                        />
                      ) : (
                        <span className="resources-tree-item-icon">T</span>
                      )
                    }
                  >
                    <div className="resources-asset-fields">
                      {token.type === 'color' && typeof token.value === 'string' && (
                        <input
                          aria-label={`${token.name} colour`}
                          type="color"
                          value={token.value.slice(0, 7)}
                          onChange={(event) =>
                            updateDesignToken(token.id, { value: event.target.value })
                          }
                        />
                      )}
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
                      <div className="resources-tree-actions">
                        <span>
                          {uses} linked use{uses === 1 ? '' : 's'}
                        </span>
                        <button
                          type="button"
                          className="data-table-delete"
                          disabled={uses > 0}
                          onClick={() => removeDesignToken(token.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </ResourceTreeItem>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </Panel>
  );
}
