import { useState, useEffect } from 'react';
import {
  STYLE_PACKS,
  stylePackIdForComposition,
  type StylePackId,
  type DesignTokenType,
  type DesignSystem,
  type DesignToken,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useProjectSetStore } from '../state/projectSetStore';
import {
  initializeSharedBrandKit,
  updateSharedBrandKit,
  updateSharedBrandToken,
  addSharedBrandToken,
  removeSharedBrandToken,
  setBrandTokenOverride,
  getBrandTokenOrigin,
  updateSharedBrandBackground,
} from '../state/templateSetBrandKit';
import { generateBrandKitCss } from '../state/templateSetTheme';
import { Panel } from './Panel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { ColorInput } from '../components/ColorInput';
import { ResourceTreeItem } from './ResourceTreeComponents';
import { BrandKitStylesEditor } from './BrandKitStylesEditor';
import { FrameDurationControl } from './FrameDurationControl';
import './ResourcesPanel.css';
import './BrandKitPanel.css';
export function BrandKitPanel() {
  const composition = useActiveComposition();
  const projectSet = useProjectSetStore((s) => s.projectSet);
  const [scope, setScope] = useState<'template' | 'set'>('template');
  const [error, setError] = useState<string | null>(null);
  const isMaster = projectSet !== null && scope === 'set';
  const designSystem: DesignSystem = isMaster
    ? (projectSet.brandKit ?? { name: projectSet.name, tokens: [] })
    : composition.designSystem;
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
  const tokenUsageCountInComposition = (target: typeof composition, tokenId: string) =>
    target.layers.filter((layer) =>
      layer.designTokenBindings.some((binding) => binding.tokenId === tokenId),
    ).length +
    target.dataFields.filter((field) => field.defaultTokenId === tokenId).length +
    (target.designSystem.stylePackColors ?? []).filter(
      (link) => link.sourceTokenId === tokenId || link.targetTokenId === tokenId,
    ).length;
  const tokenUsageCount = (tokenId: string) =>
    isMaster
      ? (projectSet?.templates ?? []).reduce(
          (total, template) =>
            total +
            template.project.compositions.reduce(
              (uses, target) => uses + tokenUsageCountInComposition(target, tokenId),
              0,
            ),
          0,
        )
      : tokenUsageCountInComposition(composition, tokenId);
  const change = (operation: () => unknown) => {
    try {
      operation();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Brand Kit could not be updated.');
    }
  };
  const editToken = (tokenId: string, patch: Partial<Omit<DesignToken, 'id'>>) =>
    change(() =>
      isMaster ? updateSharedBrandToken(tokenId, patch) : updateDesignToken(tokenId, patch),
    );
  const addToken = () => {
    change(() => (isMaster ? addSharedBrandToken('color') : addDesignToken('color')));
  };
  const tokenOrigin = (tokenId: string) =>
    isMaster
      ? { origin: 'master' as const, sourceName: projectSet?.name }
      : getBrandTokenOrigin(tokenId);
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
        {projectSet && (
          <div className="brand-kit-scope">
            <select
              aria-label="Brand Kit scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as 'template' | 'set')}
            >
              <option value="template">This template</option>
              <option value="set">Template Set · {projectSet.name}</option>
            </select>
            {!projectSet.brandKit && (
              <button type="button" onClick={() => change(initializeSharedBrandKit)}>
                Use this Brand Kit for set
              </button>
            )}
          </div>
        )}
        <p className="inspector-hint brand-kit-scope-hint">
          {isMaster
            ? 'Master values update inheriting templates. Local overrides are kept.'
            : projectSet?.brandKit
              ? 'Inherited values stay editable. Editing creates a template override; reset restores the master.'
              : 'Link object properties to tokens to share colors, fonts and other styles.'}
        </p>
        {error && (
          <p className="inspector-error" role="alert">
            {error}
          </p>
        )}
        {isMaster && !projectSet?.brandKit ? (
          <p className="panel-placeholder">
            No master Brand Kit yet. Use this template’s Brand Kit to start.
          </p>
        ) : (
          <>
            {isMaster && !designSystem.defaultBackgroundStyleId && (
              <div className="brand-kit-master-background">
                <span>Canvas background</span>
                <ColorInput
                  label="Master canvas background color"
                  value={
                    projectSet?.settings?.backgroundColor === 'transparent'
                      ? '#000000'
                      : (projectSet?.settings?.backgroundColor ?? '#000000')
                  }
                  onChange={(value) => change(() => updateSharedBrandBackground(value))}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={projectSet?.settings?.backgroundColor === 'transparent'}
                    onChange={(event) =>
                      change(() =>
                        updateSharedBrandBackground(
                          event.target.checked ? 'transparent' : '#000000',
                        ),
                      )
                    }
                  />
                  Transparent
                </label>
              </div>
            )}
            <CollapsibleSection
              sectionId="brand-kit.palette"
              title={isMaster ? 'Palette' : 'Palette & style pack'}
              contentClassName="brand-kit-section-content"
            >
              <p className="inspector-hint" title="Playback updates can override these defaults.">
                Palette colors update linked playback defaults.
              </p>
              <div className="brand-kit-palette">
                {designSystem.tokens
                  .filter((t) => t.type === 'color')
                  .map((token) => (
                    <label key={token.id} className="brand-kit-color">
                      <span
                        draggable
                        title="Drag to an object to apply this color"
                        aria-label={`Drag ${token.name} color to an object`}
                        style={{
                          display: 'inline-block',
                          width: 18,
                          height: 18,
                          flex: '0 0 18px',
                          background: String(token.value),
                          cursor: 'grab',
                          border: '1px solid var(--border)',
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            'application/x-ograf-brand-color',
                            JSON.stringify({
                              tokenId: token.id,
                              projectId: useProjectStore.getState().project.id,
                              compositionId: composition.id,
                            }),
                          );
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                      />
                      <ColorInput
                        label={`Palette ${token.name}`}
                        value={String(token.value)}
                        onChange={(value) => editToken(token.id, { value })}
                      />
                      <span title={token.name}>{token.name}</span>
                      <small
                        className={`brand-kit-origin is-${tokenOrigin(token.id).origin}`}
                        title={tokenOrigin(token.id).sourceName}
                      >
                        {tokenOrigin(token.id).origin === 'inherited'
                          ? 'Inherited'
                          : tokenOrigin(token.id).origin === 'overridden'
                            ? 'Override'
                            : isMaster
                              ? 'Master'
                              : 'Local'}
                      </small>
                    </label>
                  ))}
              </div>
              {!isMaster && (
                <>
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
                      Original styles were not saved with this older pack. Removal can only detach
                      it.
                    </p>
                  )}
                </>
              )}
            </CollapsibleSection>
            <CollapsibleSection
              sectionId="brand-kit.tokens"
              title={`Design tokens (${designSystem.tokens.length})`}
              contentClassName="brand-kit-section-content"
              actions={
                <button type="button" onClick={addToken}>
                  + Token
                </button>
              }
            >
              <div className="resources-tree-toolbar">
                <input
                  aria-label="Brand kit name"
                  value={designSystem.name}
                  readOnly={!isMaster && !!projectSet?.brandKit}
                  title={
                    !isMaster && projectSet?.brandKit
                      ? 'The kit name is owned by the Template Set. Edit it in Template Set scope.'
                      : undefined
                  }
                  onChange={(event) =>
                    change(() =>
                      isMaster
                        ? updateSharedBrandKit({ name: event.target.value })
                        : setDesignSystemName(event.target.value),
                    )
                  }
                />
              </div>
              {designSystem.tokens.length === 0 ? (
                <p className="panel-placeholder">No design tokens.</p>
              ) : (
                <div className="resources-tree-items" role="group">
                  {designSystem.tokens.map((token) => {
                    const uses = tokenUsageCount(token.id);
                    const origin = tokenOrigin(token.id);
                    return (
                      <ResourceTreeItem
                        key={token.id}
                        label={token.name || token.key}
                        meta={`${token.type} · ${uses} linked · ${origin.origin === 'overridden' ? 'Override' : origin.origin.charAt(0).toUpperCase() + origin.origin.slice(1)}`}
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
                          {origin.origin !== 'local' && (
                            <div className="brand-kit-origin-row">
                              <small
                                className={`brand-kit-origin is-${origin.origin}`}
                                title={origin.sourceName}
                              >
                                {origin.origin === 'master'
                                  ? 'Template Set master'
                                  : origin.origin === 'overridden'
                                    ? 'Template override'
                                    : `Inherited · ${origin.sourceName ?? 'Template Set'}`}
                              </small>
                              {origin.origin === 'inherited' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    change(() => setBrandTokenOverride(token.id, true))
                                  }
                                >
                                  Override
                                </button>
                              )}
                              {origin.origin === 'overridden' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    change(() => setBrandTokenOverride(token.id, false))
                                  }
                                >
                                  Reset to inherited
                                </button>
                              )}
                            </div>
                          )}
                          <div className="resources-asset-inline">
                            <input
                              aria-label="Token name"
                              value={token.name}
                              readOnly={!isMaster && origin.origin !== 'local'}
                              title={
                                !isMaster && origin.origin !== 'local'
                                  ? 'Token names belong to the master. Edit the name in Template Set scope; override the value here.'
                                  : undefined
                              }
                              onChange={(event) =>
                                editToken(token.id, { name: event.target.value })
                              }
                            />
                            <input
                              aria-label="Token key"
                              value={token.key}
                              readOnly={!isMaster && origin.origin !== 'local'}
                              title={
                                !isMaster && origin.origin !== 'local'
                                  ? 'Token keys belong to the master. Edit the key in Template Set scope.'
                                  : undefined
                              }
                              onChange={(event) => editToken(token.id, { key: event.target.value })}
                            />
                          </div>
                          <div className="resources-asset-inline">
                            <select
                              aria-label="Token type"
                              value={token.type}
                              disabled={!isMaster && origin.origin !== 'local'}
                              title={
                                !isMaster && origin.origin !== 'local'
                                  ? 'Token types belong to the master. Edit the type in Template Set scope.'
                                  : undefined
                              }
                              onChange={(event) => {
                                const type = event.target.value as DesignTokenType;
                                editToken(token.id, {
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
                            {token.type === 'color' ? (
                              <ColorInput
                                label={`${token.name || token.key} color`}
                                value={String(token.value)}
                                onChange={(value) => editToken(token.id, { value })}
                              />
                            ) : token.type === 'number' &&
                              /^motion\.(entrance|exit|update|stagger)\.frames$/.test(token.key) ? (
                              <FrameDurationControl
                                compact
                                label={token.name || token.key}
                                frames={Number(token.value)}
                                frameRate={
                                  isMaster
                                    ? (projectSet?.settings?.frameRate ?? composition.frameRate)
                                    : composition.frameRate
                                }
                                minFrames={0}
                                onChange={(value) => editToken(token.id, { value })}
                              />
                            ) : (
                              <input
                                aria-label="Token value"
                                type={
                                  token.type === 'number' || token.type === 'font-weight'
                                    ? 'number'
                                    : 'text'
                                }
                                value={token.value}
                                onChange={(event) =>
                                  editToken(token.id, {
                                    value:
                                      token.type === 'number' || token.type === 'font-weight'
                                        ? Number(event.target.value)
                                        : event.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                          <div className="resources-tree-actions">
                            <span>
                              {uses} linked use{uses === 1 ? '' : 's'}
                            </span>
                            {(isMaster || origin.origin === 'local') && (
                              <button
                                type="button"
                                className="data-table-delete"
                                disabled={uses > 0}
                                onClick={() =>
                                  change(() =>
                                    isMaster
                                      ? removeSharedBrandToken(token.id)
                                      : removeDesignToken(token.id),
                                  )
                                }
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </ResourceTreeItem>
                    );
                  })}
                </div>
              )}
            </CollapsibleSection>
            <BrandKitStylesEditor
              designSystem={designSystem}
              scope={isMaster ? 'set' : 'template'}
            />
            <p className="inspector-hint">
              Import font files in Resources → Fonts before using them.
            </p>
            {isMaster && (
              <CollapsibleSection
                sectionId="brand-kit.master-css"
                title="Generated master CSS"
                defaultOpen={false}
                contentClassName="brand-kit-section-content"
              >
                <p className="inspector-hint">
                  Read-only CSS generated from the editable master tokens.
                </p>
                <textarea
                  aria-label="Generated master CSS"
                  className="brand-kit-css"
                  readOnly
                  value={generateBrandKitCss(designSystem)}
                />
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
