import { useId, useState } from 'react';
import {
  isGradientPaint,
  isShaderPaint,
  type DesignSystem,
  type Paint,
  type TypographyPreset,
  type TypographyProperty,
} from '@ograf-editor/scene-model';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { PropertyRow } from '../components/PropertyRow';
import { InheritanceIcon, ResetInheritanceIcon } from '../components/InheritanceIcons';
import { useActiveComposition } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import {
  addTypographyPreset,
  updateTypographyPreset,
  removeTypographyPreset,
  applyTypographyToLayers,
  getTypographyOrigin,
  setTypographyOverride,
  addBackgroundStyle,
  updateBackgroundStyle,
  removeBackgroundStyle,
  applyBackgroundStyle,
  getBackgroundStyleOrigin,
  setBackgroundStyleOverride,
  setDefaultBackgroundStyle,
} from '../state/brandKitStyles';
import { shaderPaintWithPatch } from '../state/shaderResources';
import { FONT_OPTIONS } from './fontOptions';
import { PaintEditor } from './PaintEditor';
import { ShaderSourceEditor } from './ShaderSourceEditor';
import { ResourceTreeItem } from './ResourceTreeComponents';
import './BrandKitStylesEditor.css';

type BrandKitScope = 'set' | 'template';
const NUMERIC_TYPOGRAPHY = [
  { property: 'fontSize', label: 'Size', min: 1, step: 1 },
  { property: 'fontWeight', label: 'Weight', min: 1, max: 1000, step: 100 },
  { property: 'lineHeight', label: 'Line height', min: 0.5, step: 0.05 },
  { property: 'letterSpacing', label: 'Tracking', step: 0.1 },
] as const;

/** Rich backgrounds use the same paint controls as objects, including editable shader source. */
export function BrandBackgroundPaintEditor({
  value,
  onChange,
  label = 'Paint',
}: {
  value: Paint | undefined;
  onChange: (paint: Paint | undefined) => void;
  label?: string;
}) {
  const [editingShader, setEditingShader] = useState(false);
  return (
    <>
      <PaintEditor
        value={value}
        label={label}
        onChange={onChange}
        onEditShader={() => setEditingShader((open) => !open)}
      />
      {editingShader && isShaderPaint(value) && (
        <CollapsibleSection
          sectionId={`brand-kit.background-shader.${label}`}
          title="Background shader source"
          contentClassName="brand-kit-style-fields"
        >
          <ShaderSourceEditor
            element={value}
            labelPrefix="Background shader"
            showSourceEditor
            onChange={(patch) => onChange(shaderPaintWithPatch(value, patch))}
          />
        </CollapsibleSection>
      )}
    </>
  );
}

export function BrandKitStylesEditor({
  designSystem,
  scope,
}: {
  designSystem: DesignSystem;
  scope: BrandKitScope;
}) {
  const composition = useActiveComposition();
  const selectedIds = useSelectionStore((state) => state.selectedLayerIds);
  const fontListId = useId();
  const [error, setError] = useState('');
  const selectedTextIds = composition.layers
    .filter(
      (layer) => selectedIds.includes(layer.id) && layer.element.type === 'text' && !layer.isLocked,
    )
    .map((layer) => layer.id);
  const master = scope === 'set';
  const change = (operation: () => unknown) => {
    try {
      operation();
      setError('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The Brand Kit style could not be updated.',
      );
    }
  };
  const editTypography = (
    preset: TypographyPreset,
    property: TypographyProperty,
    value: string | number,
  ) =>
    change(() =>
      updateTypographyPreset(scope, preset.id, {
        properties: { ...preset.properties, [property]: value },
      }),
    );
  const typography = designSystem.typography ?? [];
  const backgrounds = designSystem.backgrounds ?? [];
  return (
    <div className="brand-kit-styles">
      {error && (
        <p className="inspector-error" role="alert">
          {error}
        </p>
      )}
      <datalist id={fontListId}>
        {FONT_OPTIONS.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
        {composition.assets
          .filter((asset) => asset.kind === 'font')
          .map((asset) => (
            <option key={asset.id} value={asset.fontFamily ?? asset.name} />
          ))}
      </datalist>
      <CollapsibleSection
        sectionId="brand-kit.typography"
        title={`Typography (${typography.length})`}
        contentClassName="brand-kit-style-section"
        actions={
          <span className="brand-kit-style-add">
            {(['headline', 'body', 'caption'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-label={`Add ${kind} typography preset`}
                onClick={() => change(() => addTypographyPreset(scope, kind))}
              >
                + {kind === 'headline' ? 'Heading' : kind === 'body' ? 'Body' : 'Caption'}
              </button>
            ))}
          </span>
        }
      >
        {typography.length === 0 && (
          <p className="panel-placeholder">
            Add a named style, then apply it to selected text objects.
          </p>
        )}
        {typography.map((preset) => {
          const origin = master
            ? { origin: 'master' as const, sourceName: designSystem.name }
            : getTypographyOrigin(preset.id);
          const inheritedIdentity = !master && origin.origin !== 'local';
          return (
            <ResourceTreeItem
              key={preset.id}
              label={preset.name}
              meta={`${preset.properties.fontSize}px`}
              preview={<span className="resources-tree-item-icon">T</span>}
            >
              <div className="brand-kit-style-fields">
                <div className="brand-kit-style-origin-row">
                  <small
                    className={`brand-kit-origin is-${origin.origin}`}
                    title={`${origin.origin}: ${origin.sourceName ?? 'local style'}`}
                    aria-label={`${origin.origin} typography style`}
                  >
                    {master ? (
                      'Master'
                    ) : origin.origin === 'local' ? (
                      'Local'
                    ) : (
                      <InheritanceIcon overridden={origin.origin === 'overridden'} />
                    )}
                  </small>
                  {origin.origin === 'inherited' && (
                    <button
                      type="button"
                      title="Keep this style as a local override"
                      aria-label="Keep typography style as a local override"
                      onClick={() => change(() => setTypographyOverride(preset.id, true))}
                    >
                      <InheritanceIcon overridden />
                    </button>
                  )}
                  {origin.origin === 'overridden' && (
                    <button
                      type="button"
                      title="Reset to inherited typography style"
                      aria-label="Reset to inherited typography style"
                      onClick={() => change(() => setTypographyOverride(preset.id, false))}
                    >
                      <ResetInheritanceIcon />
                    </button>
                  )}
                </div>
                <PropertyRow
                  help="Style name. Inherited style names are owned by the master kit."
                  className="inspector-row"
                >
                  <span>Name</span>
                  <input
                    aria-label={`${preset.name} style name`}
                    value={preset.name}
                    readOnly={inheritedIdentity}
                    onChange={(event) =>
                      change(() =>
                        updateTypographyPreset(scope, preset.id, { name: event.target.value }),
                      )
                    }
                  />
                </PropertyRow>
                <PropertyRow
                  help="Shared typeface. Import font files in Resources → Fonts for portable use."
                  className="inspector-row"
                >
                  <span>Font</span>
                  <input
                    aria-label={`${preset.name} font family`}
                    list={fontListId}
                    value={preset.properties.fontFamily}
                    onChange={(event) => editTypography(preset, 'fontFamily', event.target.value)}
                  />
                </PropertyRow>
                {NUMERIC_TYPOGRAPHY.map((field) => (
                  <PropertyRow
                    key={field.property}
                    help={`Shared ${field.label.toLowerCase()} for text using this typography style.`}
                    className="inspector-row"
                  >
                    <span>{field.label}</span>
                    <input
                      aria-label={`${preset.name} ${field.label.toLowerCase()}`}
                      type="number"
                      min={'min' in field ? field.min : undefined}
                      max={'max' in field ? field.max : undefined}
                      step={field.step}
                      value={preset.properties[field.property]}
                      onChange={(event) =>
                        editTypography(preset, field.property, Number(event.target.value))
                      }
                    />
                  </PropertyRow>
                ))}
                <PropertyRow help="Shared horizontal text alignment." className="inspector-row">
                  <span>Align</span>
                  <select
                    aria-label={`${preset.name} alignment`}
                    value={preset.properties.textAlign}
                    onChange={(event) => editTypography(preset, 'textAlign', event.target.value)}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </PropertyRow>
                <PropertyRow
                  help="Shared text case transformation; the source text is unchanged."
                  className="inspector-row"
                >
                  <span>Case</span>
                  <select
                    aria-label={`${preset.name} text case`}
                    value={preset.properties.textTransform}
                    onChange={(event) =>
                      editTypography(preset, 'textTransform', event.target.value)
                    }
                  >
                    <option value="none">None</option>
                    <option value="uppercase">Uppercase</option>
                    <option value="lowercase">Lowercase</option>
                    <option value="capitalize">Capitalize</option>
                  </select>
                </PropertyRow>
                <div className="brand-kit-style-actions">
                  <button
                    type="button"
                    disabled={selectedTextIds.length === 0}
                    onClick={() =>
                      change(() => applyTypographyToLayers(selectedTextIds, preset.id))
                    }
                    title="Apply this style to selected unlocked text objects"
                  >
                    Apply to selected text
                  </button>
                  {!inheritedIdentity && (
                    <button
                      type="button"
                      onClick={() => change(() => removeTypographyPreset(scope, preset.id))}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </ResourceTreeItem>
          );
        })}
      </CollapsibleSection>
      <CollapsibleSection
        sectionId="brand-kit.background-styles"
        title={`Background styles (${backgrounds.length})`}
        contentClassName="brand-kit-style-section"
        actions={
          <button type="button" onClick={() => change(() => addBackgroundStyle(scope))}>
            + Background
          </button>
        }
      >
        {master && (
          <PropertyRow
            help="Default canvas background for all templates that inherit the master. Local template overrides are retained."
            className="inspector-row"
          >
            <span>Set default</span>
            <select
              aria-label="Master default background style"
              value={designSystem.defaultBackgroundStyleId ?? ''}
              onChange={(event) =>
                change(() => setDefaultBackgroundStyle(event.target.value || null))
              }
            >
              <option value="">Canvas color / transparent</option>
              {backgrounds.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
          </PropertyRow>
        )}
        {backgrounds.length === 0 && (
          <p className="panel-placeholder">Add solid, gradient, shader or media backgrounds.</p>
        )}
        {backgrounds.map((style) => {
          const origin = master
            ? { origin: 'master' as const, sourceName: designSystem.name }
            : getBackgroundStyleOrigin(style.id);
          const inheritedIdentity = !master && origin.origin !== 'local';
          const paintLabel =
            typeof style.paint === 'string'
              ? 'Solid'
              : isGradientPaint(style.paint)
                ? 'Gradient'
                : isShaderPaint(style.paint)
                  ? 'Shader'
                  : 'Media';
          return (
            <ResourceTreeItem
              key={style.id}
              label={style.name}
              meta={paintLabel}
              preview={
                typeof style.paint === 'string' ? (
                  <span className="resources-token-swatch" style={{ background: style.paint }} />
                ) : (
                  <span className="resources-tree-item-icon">B</span>
                )
              }
            >
              <div className="brand-kit-style-fields">
                <div className="brand-kit-style-origin-row">
                  <small
                    className={`brand-kit-origin is-${origin.origin}`}
                    title={`${origin.origin}: ${origin.sourceName ?? 'local style'}`}
                    aria-label={`${origin.origin} background style`}
                  >
                    {master ? (
                      'Master'
                    ) : origin.origin === 'local' ? (
                      'Local'
                    ) : (
                      <InheritanceIcon overridden={origin.origin === 'overridden'} />
                    )}
                  </small>
                  {origin.origin === 'inherited' && (
                    <button
                      type="button"
                      title="Keep this style as a local override"
                      aria-label="Keep background style as a local override"
                      onClick={() => change(() => setBackgroundStyleOverride(style.id, true))}
                    >
                      <InheritanceIcon overridden />
                    </button>
                  )}
                  {origin.origin === 'overridden' && (
                    <button
                      type="button"
                      title="Reset to inherited background style"
                      aria-label="Reset to inherited background style"
                      onClick={() => change(() => setBackgroundStyleOverride(style.id, false))}
                    >
                      <ResetInheritanceIcon />
                    </button>
                  )}
                </div>
                <PropertyRow
                  help="Style name. Inherited background names are owned by the master kit."
                  className="inspector-row"
                >
                  <span>Name</span>
                  <input
                    aria-label={`${style.name} background style name`}
                    value={style.name}
                    readOnly={inheritedIdentity}
                    onChange={(event) =>
                      change(() =>
                        updateBackgroundStyle(scope, style.id, { name: event.target.value }),
                      )
                    }
                  />
                </PropertyRow>
                <BrandBackgroundPaintEditor
                  value={style.paint}
                  onChange={(paint) =>
                    change(() =>
                      updateBackgroundStyle(scope, style.id, { paint: paint ?? 'transparent' }),
                    )
                  }
                />
                <div className="brand-kit-style-actions">
                  <button
                    type="button"
                    disabled={master && designSystem.defaultBackgroundStyleId === style.id}
                    onClick={() =>
                      change(() =>
                        master
                          ? setDefaultBackgroundStyle(style.id)
                          : applyBackgroundStyle(style.id),
                      )
                    }
                  >
                    {master
                      ? designSystem.defaultBackgroundStyleId === style.id
                        ? 'Default background'
                        : 'Use as default background'
                      : 'Apply to this template'}
                  </button>
                  {!inheritedIdentity && (
                    <button
                      type="button"
                      onClick={() => change(() => removeBackgroundStyle(scope, style.id))}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </ResourceTreeItem>
          );
        })}
      </CollapsibleSection>
    </div>
  );
}
