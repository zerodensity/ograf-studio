import type { ChangeEvent } from 'react';
import {
  getLayerTransformAtFrame,
  useActiveComposition,
  useProjectStore,
  type ElementFields,
} from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { BINDABLE_PROPERTIES } from '../state/dataBinding';
import type {
  BlendMode,
  DesignTokenTargetProperty,
  DesignTokenType,
  LayerTransform,
  TextElement,
} from '@ograf-editor/scene-model';
import {
  BLEND_MODES,
  findLayerKeyframeAtFrame,
  getLayerEffectsAtFrame,
  getLayerPropertyValueAtFrame,
  getPaintAtFrame,
  listFieldLeafPaths,
  getResolvedLayerAnimationTracks,
  isPixelTransformKey,
  parseLottieJson,
  type EasingPreset,
  type SemanticLayerRole,
} from '@ograf-editor/scene-model';
import { useTimelineStore } from '../state/timelineStore';
import { CompositionSettings } from './CompositionSettings';
import { Panel } from './Panel';
import { alphaPercentToOpacity, opacityToAlphaPercent } from './alphaControl';
import { EASING_OPTION_GROUPS } from './easingOptions';
import { FONT_OPTIONS } from './fontOptions';
import { measureAutoSizedText } from './textAutoSize';
import { PaintEditor } from './PaintEditor';
import './InspectorPanel.css';

const TRANSFORM_FIELDS: { key: keyof LayerTransform; label: string; step?: number }[] = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'W' },
  { key: 'height', label: 'H' },
  { key: 'rotation', label: 'Rotation' },
];

const SEMANTIC_ROLES: Array<{ value: SemanticLayerRole; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'background', label: 'Background' },
  { value: 'container', label: 'Container' },
  { value: 'accent', label: 'Accent' },
  { value: 'headline', label: 'Headline' },
  { value: 'subheadline', label: 'Subheadline' },
  { value: 'label', label: 'Label' },
  { value: 'value', label: 'Value' },
  { value: 'logo', label: 'Logo' },
  { value: 'image', label: 'Image' },
  { value: 'icon', label: 'Icon' },
  { value: 'mask', label: 'Mask' },
  { value: 'decorative', label: 'Decorative' },
  { value: 'ticker', label: 'Ticker' },
  { value: 'score', label: 'Score' },
  { value: 'custom', label: 'Custom' },
];

const DESIGN_TOKEN_TARGETS: Record<
  'rectangle' | 'ellipse' | 'text' | 'path',
  Array<{ property: DesignTokenTargetProperty; label: string; tokenType: DesignTokenType }>
> = {
  rectangle: [
    { property: 'fill', label: 'Fill', tokenType: 'color' },
    { property: 'strokeColor', label: 'Stroke', tokenType: 'color' },
    { property: 'strokeWidth', label: 'Stroke width', tokenType: 'number' },
    { property: 'borderRadius', label: 'Corner radius', tokenType: 'number' },
  ],
  ellipse: [
    { property: 'fill', label: 'Fill', tokenType: 'color' },
    { property: 'strokeColor', label: 'Stroke', tokenType: 'color' },
    { property: 'strokeWidth', label: 'Stroke width', tokenType: 'number' },
  ],
  path: [
    { property: 'fill', label: 'Fill', tokenType: 'color' },
    { property: 'strokeColor', label: 'Stroke', tokenType: 'color' },
    { property: 'strokeWidth', label: 'Stroke width', tokenType: 'number' },
  ],
  text: [
    { property: 'color', label: 'Text colour', tokenType: 'color' },
    { property: 'strokeColor', label: 'Stroke', tokenType: 'color' },
    { property: 'strokeWidth', label: 'Stroke width', tokenType: 'number' },
    { property: 'fontFamily', label: 'Font family', tokenType: 'font-family' },
    { property: 'fontSize', label: 'Font size', tokenType: 'number' },
    { property: 'fontWeight', label: 'Font weight', tokenType: 'font-weight' },
  ],
};

export function InspectorPanel() {
  const composition = useActiveComposition();
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const selectedLayerId = useSelectionStore((s) => s.selectedLayerId);
  const liveTransform = useSelectionStore((s) => s.liveTransform);
  const renameLayer = useProjectStore((s) => s.renameLayer);
  const updateLayerTransform = useProjectStore((s) => s.updateLayerTransform);
  const updateLayerKeyframeEasing = useProjectStore((s) => s.updateLayerKeyframeEasing);
  const updateLayerElement = useProjectStore((s) => s.updateLayerElement);
  const updateLayerTextStroke = useProjectStore((s) => s.updateLayerTextStroke);
  const updateLayerPaint = useProjectStore((s) => s.updateLayerPaint);
  const updateLayerEffects = useProjectStore((s) => s.updateLayerEffects);
  const setLayerBindings = useProjectStore((s) => s.setLayerBindings);
  const toggleLayerLock = useProjectStore((s) => s.toggleLayerLock);
  const setLayerParent = useProjectStore((s) => s.setLayerParent);
  const setLayerClipChildren = useProjectStore((s) => s.setLayerClipChildren);
  const setLayerConstraints = useProjectStore((s) => s.setLayerConstraints);
  const setLayerSemantics = useProjectStore((s) => s.setLayerSemantics);
  const setLayerBlendMode = useProjectStore((s) => s.setLayerBlendMode);
  const bindDesignToken = useProjectStore((s) => s.bindDesignToken);
  const unbindDesignToken = useProjectStore((s) => s.unbindDesignToken);

  const layer = composition.layers.find((l) => l.id === selectedLayerId);

  // Standard design-tool behavior: with nothing selected, the Inspector edits the document itself
  // rather than showing a dead-end message.
  if (!layer) {
    return (
      <Panel title="Inspector">
        <CompositionSettings />
      </Panel>
    );
  }

  const roundedFrame = Math.round(currentFrame);
  const activeLayerKeyframe = findLayerKeyframeAtFrame(layer, roundedFrame);
  const authoredPose = getLayerTransformAtFrame(layer, currentFrame);
  const pose =
    liveTransform?.layerId === layer.id
      ? { ...authoredPose, ...liveTransform.patch }
      : authoredPose;
  const isLiveTransform = liveTransform?.layerId === layer.id;
  const alphaPercent = opacityToAlphaPercent(pose.opacity);
  const evaluatedEffects = getLayerEffectsAtFrame(layer, currentFrame);
  const evaluatedPaint =
    layer.element.type === 'rectangle' || layer.element.type === 'ellipse'
      ? getPaintAtFrame(layer.element.fill, getResolvedLayerAnimationTracks(layer), currentFrame)
      : null;
  const evaluatedTextStrokeWidth =
    layer.element.type === 'text'
      ? getLayerPropertyValueAtFrame(layer, 'strokeWidth', currentFrame)
      : 0;

  const transformInputValue = (key: keyof LayerTransform): number => {
    if (isLiveTransform) return pose[key];
    const value = activeLayerKeyframe?.transform[key] ?? pose[key];
    return isPixelTransformKey(key) ? Math.round(value) : value;
  };

  const evaluatedPixelSummary = `X ${authoredPose.x.toFixed(3)} · Y ${authoredPose.y.toFixed(3)} · W ${authoredPose.width.toFixed(3)} · H ${authoredPose.height.toFixed(3)}`;

  const setTransform = (key: keyof LayerTransform, value: number) => {
    updateLayerTransform(layer.id, roundedFrame, { [key]: value });
  };

  const setElement = (patch: Partial<ElementFields>) => {
    updateLayerElement(layer.id, patch);
  };

  const setTextElement = (patch: Partial<TextElement>) => {
    if (layer.element.type !== 'text') return;
    const next = { ...layer.element, ...patch };
    setElement(patch);
    if (next.autoFit === 'auto-size') {
      updateLayerTransform(layer.id, roundedFrame, measureAutoSizedText(next));
    }
  };

  const setTextStroke = (patch: Partial<Pick<TextElement, 'strokeColor' | 'strokeWidth'>>) => {
    if (layer.element.type !== 'text') return;
    updateLayerTextStroke(layer.id, roundedFrame, patch);
    if (patch.strokeWidth !== undefined && layer.element.autoFit === 'auto-size') {
      updateLayerTransform(
        layer.id,
        roundedFrame,
        measureAutoSizedText({ ...layer.element, strokeWidth: Math.max(0, patch.strokeWidth) }),
      );
    }
  };

  // Narrowed to a local so it survives into the `.find()` closure below — TS discards narrowing
  // from `layer.element.type === 'image'` once `layer.element` is re-read inside a nested function.
  const imageSrc = layer.element.type === 'image' ? layer.element.src : null;
  const sequenceFrames = layer.element.type === 'image-sequence' ? layer.element.frames : [];
  const selectedFontFamily = layer.element.type === 'text' ? layer.element.fontFamily : '';
  const selectedFontSize = layer.element.type === 'text' ? layer.element.fontSize : 1;
  const importedFontOptions = composition.assets
    .filter((asset) => asset.kind === 'font')
    .map((asset) => ({
      label: asset.fontFamily || asset.name.replace(/\.[^.]+$/, ''),
      value: asset.fontFamily || asset.name.replace(/\.[^.]+$/, ''),
    }));
  const availableFontOptions = [...importedFontOptions, ...FONT_OPTIONS];
  const tokenTargets =
    layer.element.type in DESIGN_TOKEN_TARGETS
      ? DESIGN_TOKEN_TARGETS[layer.element.type as keyof typeof DESIGN_TOKEN_TARGETS]
      : [];

  return (
    <Panel title="Inspector">
      <div className="inspector">
        <label className="inspector-row">
          <span>Name</span>
          <input
            type="text"
            value={layer.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => renameLayer(layer.id, e.target.value)}
          />
        </label>
        <h3 className="inspector-section">Semantic intent</h3>
        <label className="inspector-row">
          <span>Role</span>
          <select
            value={layer.semantics.role}
            onChange={(event) =>
              setLayerSemantics(layer.id, { role: event.target.value as SemanticLayerRole })
            }
          >
            {SEMANTIC_ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inspector-row">
          <span>Tags</span>
          <input
            type="text"
            value={layer.semantics.tags.join(', ')}
            placeholder="primary, breaking-news"
            onChange={(event) =>
              setLayerSemantics(layer.id, {
                tags: event.target.value.split(',').map((tag) => tag.trim()),
              })
            }
          />
        </label>
        <label className="inspector-row">
          <span>Intent</span>
          <textarea
            value={layer.semantics.description}
            placeholder="What this layer means in the design"
            onChange={(event) => setLayerSemantics(layer.id, { description: event.target.value })}
          />
        </label>
        {tokenTargets.length > 0 && (
          <>
            <h3 className="inspector-section">Brand tokens</h3>
            {tokenTargets.map((target) => {
              const binding = layer.designTokenBindings.find(
                (candidate) => candidate.targetProperty === target.property,
              );
              const compatibleTokens = composition.designSystem.tokens.filter(
                (token) => token.type === target.tokenType,
              );
              return (
                <label className="inspector-row" key={target.property}>
                  <span>{target.label}</span>
                  <select
                    value={binding?.tokenId ?? ''}
                    onChange={(event) => {
                      if (event.target.value) {
                        bindDesignToken(layer.id, event.target.value, target.property);
                      } else {
                        unbindDesignToken(layer.id, target.property);
                      }
                    }}
                  >
                    <option value="">Unlinked</option>
                    {compatibleTokens.map((token) => (
                      <option key={token.id} value={token.id}>
                        {token.name} ({token.key})
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
            {composition.designSystem.tokens.length === 0 && (
              <p className="inspector-hint">Create brand tokens in Resources first.</p>
            )}
          </>
        )}
        <label className="inspector-row inspector-checkbox-row">
          <span>Clip children</span>
          <input
            type="checkbox"
            checked={layer.clipChildren}
            onChange={(event) => setLayerClipChildren(layer.id, event.target.checked)}
          />
        </label>

        <h3 className="inspector-section">Compositing</h3>
        <label className="inspector-row">
          <span>Blend mode</span>
          <select
            value={layer.blendMode}
            disabled={layer.isLocked}
            onChange={(event) => setLayerBlendMode(layer.id, event.target.value as BlendMode)}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode.replace('-', ' ')}
              </option>
            ))}
          </select>
        </label>

        <h3 className="inspector-section">Layout relationships</h3>
        <label className="inspector-row inspector-checkbox-row">
          <span>Locked</span>
          <input
            type="checkbox"
            checked={layer.isLocked}
            onChange={() => toggleLayerLock(layer.id)}
          />
        </label>
        <label className="inspector-row">
          <span>Parent</span>
          <select
            value={layer.parentId ?? ''}
            onChange={(event) => setLayerParent(layer.id, event.target.value || null)}
          >
            <option value="">None</option>
            {composition.layers
              .filter((candidate) => candidate.id !== layer.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </label>
        <div className="inspector-grid">
          <label className="inspector-row">
            <span>Horizontal</span>
            <select
              value={layer.constraints.horizontal}
              onChange={(event) =>
                setLayerConstraints(layer.id, {
                  horizontal: event.target.value as typeof layer.constraints.horizontal,
                })
              }
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="left-right">Left + Right</option>
              <option value="center">Center</option>
              <option value="scale">Scale</option>
            </select>
          </label>
          <label className="inspector-row">
            <span>Vertical</span>
            <select
              value={layer.constraints.vertical}
              onChange={(event) =>
                setLayerConstraints(layer.id, {
                  vertical: event.target.value as typeof layer.constraints.vertical,
                })
              }
            >
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="top-bottom">Top + Bottom</option>
              <option value="center">Center</option>
              <option value="scale">Scale</option>
            </select>
          </label>
        </div>
        {layer.groupId && <p className="inspector-hint">Persistent group: {layer.groupId}</p>}

        <h3 className="inspector-section">Data Bindings</h3>
        <div className="inspector-binding-list">
          {layer.bindings.map((binding, index) => {
            const field = composition.dataFields.find(
              (candidate) => candidate.id === binding.fieldId,
            );
            const sourcePaths = field
              ? listFieldLeafPaths(field, { fromArrayItem: field.type === 'array' })
              : [];
            return (
              <div className="inspector-binding" key={`${binding.targetProperty}:${index}`}>
                <label className="inspector-row">
                  <span>Field</span>
                  <select
                    aria-label={`Binding ${index + 1} field`}
                    value={binding.fieldId}
                    onChange={(event) => {
                      const nextField = composition.dataFields.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      const nextPath = nextField
                        ? (listFieldLeafPaths(nextField, {
                            fromArrayItem: nextField.type === 'array',
                          })[0]?.path ?? [])
                        : [];
                      const bindings = layer.bindings.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, fieldId: event.target.value, sourcePath: nextPath }
                          : candidate,
                      );
                      setLayerBindings(layer.id, bindings);
                    }}
                  >
                    {composition.dataFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label || field.key}
                      </option>
                    ))}
                  </select>
                </label>
                {(field?.type === 'object' || field?.type === 'array') && (
                  <label className="inspector-row">
                    <span>Value path</span>
                    <select
                      aria-label={`Binding ${index + 1} value path`}
                      value={JSON.stringify(binding.sourcePath ?? [])}
                      onChange={(event) => {
                        const sourcePath = JSON.parse(event.target.value) as string[];
                        setLayerBindings(
                          layer.id,
                          layer.bindings.map((candidate, candidateIndex) =>
                            candidateIndex === index ? { ...candidate, sourcePath } : candidate,
                          ),
                        );
                      }}
                    >
                      {sourcePaths.map((path) => (
                        <option key={JSON.stringify(path.path)} value={JSON.stringify(path.path)}>
                          {path.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="inspector-row">
                  <span>Property</span>
                  <select
                    aria-label={`Binding ${index + 1} property`}
                    value={binding.targetProperty}
                    onChange={(event) => {
                      const bindings = layer.bindings.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, targetProperty: event.target.value }
                          : candidate,
                      );
                      setLayerBindings(layer.id, bindings);
                    }}
                  >
                    {BINDABLE_PROPERTIES[layer.element.type]
                      .filter(
                        (property) =>
                          property.value === binding.targetProperty ||
                          !layer.bindings.some(
                            (candidate, candidateIndex) =>
                              candidateIndex !== index &&
                              candidate.targetProperty === property.value,
                          ),
                      )
                      .map((property) => (
                        <option key={property.value} value={property.value}>
                          {property.label}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="inspector-binding-remove"
                  aria-label={`Remove binding ${index + 1}`}
                  onClick={() =>
                    setLayerBindings(
                      layer.id,
                      layer.bindings.filter((_, candidateIndex) => candidateIndex !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            );
          })}
          <button
            type="button"
            disabled={
              composition.dataFields.length === 0 ||
              BINDABLE_PROPERTIES[layer.element.type].every((property) =>
                layer.bindings.some((binding) => binding.targetProperty === property.value),
              )
            }
            onClick={() => {
              const targetProperty = BINDABLE_PROPERTIES[layer.element.type].find(
                (property) =>
                  !layer.bindings.some((binding) => binding.targetProperty === property.value),
              )?.value;
              const fieldId = composition.dataFields[0]?.id;
              if (targetProperty && fieldId) {
                const field = composition.dataFields[0]!;
                const sourcePath =
                  listFieldLeafPaths(field, { fromArrayItem: field.type === 'array' })[0]?.path ??
                  [];
                setLayerBindings(layer.id, [
                  ...layer.bindings,
                  { fieldId, targetProperty, sourcePath },
                ]);
              }
            }}
          >
            + Add Binding
          </button>
        </div>

        <h3 className="inspector-section">Transform — frame {roundedFrame}</h3>
        {!activeLayerKeyframe && (
          <div className="inspector-evaluated-pose">
            <span>Evaluated between keys</span>
            <output>{evaluatedPixelSummary}</output>
            <small>Editing creates an integer-pixel keyframe only for this layer.</small>
          </div>
        )}
        <div className="inspector-grid">
          {TRANSFORM_FIELDS.map(({ key, label, step }) => (
            <label className="inspector-row" key={key}>
              <span>{label}</span>
              <input
                type="number"
                step={step ?? 1}
                value={transformInputValue(key)}
                disabled={layer.isLocked}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setTransform(key, Number(e.target.value))
                }
              />
            </label>
          ))}
        </div>

        <div className="inspector-alpha-control">
          <span className="inspector-alpha-label">Alpha</span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={alphaPercent}
            aria-label="Object alpha"
            onInput={(event) =>
              setTransform('opacity', alphaPercentToOpacity(Number(event.currentTarget.value)))
            }
          />
          <label className="inspector-alpha-number">
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={alphaPercent}
              aria-label="Object alpha percentage"
              onChange={(event) =>
                setTransform('opacity', alphaPercentToOpacity(Number(event.target.value)))
              }
            />
            <span>%</span>
          </label>
        </div>

        {activeLayerKeyframe && (
          <label className="inspector-row">
            <span>Incoming easing (this key)</span>
            <select
              aria-label="Selected keyframe easing"
              value={activeLayerKeyframe.easing}
              onChange={(event) =>
                updateLayerKeyframeEasing(
                  layer.id,
                  activeLayerKeyframe.id,
                  event.target.value as EasingPreset,
                )
              }
            >
              {EASING_OPTION_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        <h3 className="inspector-section">Effects</h3>
        <label className="inspector-row">
          <span>Blur</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={evaluatedEffects.blur}
            onChange={(event) =>
              updateLayerEffects(layer.id, roundedFrame, { blur: Number(event.target.value) })
            }
          />
        </label>
        <label className="inspector-row inspector-checkbox-row">
          <span>Drop shadow</span>
          <input
            type="checkbox"
            checked={layer.effects.dropShadowEnabled}
            onChange={(event) =>
              updateLayerEffects(layer.id, roundedFrame, {
                dropShadowEnabled: event.target.checked,
              })
            }
          />
        </label>
        {layer.effects.dropShadowEnabled && (
          <div className="inspector-grid inspector-effect-grid">
            <label className="inspector-row">
              <span>Color</span>
              <input
                type="color"
                value={layer.effects.dropShadowColor}
                onChange={(event) =>
                  updateLayerEffects(layer.id, roundedFrame, {
                    dropShadowColor: event.target.value,
                  })
                }
              />
            </label>
            <label className="inspector-row">
              <span>Alpha %</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={Math.round(evaluatedEffects.dropShadowOpacity * 100)}
                onChange={(event) =>
                  updateLayerEffects(layer.id, roundedFrame, {
                    dropShadowOpacity: Number(event.target.value) / 100,
                  })
                }
              />
            </label>
            <label className="inspector-row">
              <span>Offset X</span>
              <input
                type="number"
                step={1}
                value={evaluatedEffects.dropShadowOffsetX}
                onChange={(event) =>
                  updateLayerEffects(layer.id, roundedFrame, {
                    dropShadowOffsetX: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="inspector-row">
              <span>Offset Y</span>
              <input
                type="number"
                step={1}
                value={evaluatedEffects.dropShadowOffsetY}
                onChange={(event) =>
                  updateLayerEffects(layer.id, roundedFrame, {
                    dropShadowOffsetY: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="inspector-row">
              <span>Softness</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={evaluatedEffects.dropShadowBlur}
                onChange={(event) =>
                  updateLayerEffects(layer.id, roundedFrame, {
                    dropShadowBlur: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
        )}

        <h3 className="inspector-section">{layer.element.type}</h3>
        {layer.bindings.length > 0 && (
          <p className="inspector-hint">
            {layer.bindings
              .map(
                (binding) =>
                  BINDABLE_PROPERTIES[layer.element.type].find(
                    (property) => property.value === binding.targetProperty,
                  )?.label ?? binding.targetProperty,
              )
              .join(', ')}{' '}
            {layer.bindings.length === 1 ? 'is' : 'are'} data-driven — values below are design-time
            defaults.
          </p>
        )}
        {layer.element.type === 'rectangle' && (
          <>
            <PaintEditor
              value={evaluatedPaint ?? layer.element.fill}
              onChange={(fill) => updateLayerPaint(layer.id, roundedFrame, fill)}
            />
            <label className="inspector-row">
              <span>Radius</span>
              <input
                type="number"
                value={layer.element.borderRadius}
                onChange={(e) => setElement({ borderRadius: Number(e.target.value) })}
              />
            </label>
          </>
        )}

        {layer.element.type === 'ellipse' && (
          <>
            <PaintEditor
              value={evaluatedPaint ?? layer.element.fill}
              onChange={(fill) => updateLayerPaint(layer.id, roundedFrame, fill)}
            />
            <label className="inspector-row">
              <span>Stroke Color</span>
              <input
                type="color"
                value={
                  layer.element.strokeColor === 'transparent'
                    ? '#000000'
                    : layer.element.strokeColor
                }
                onChange={(e) => setElement({ strokeColor: e.target.value })}
              />
            </label>
            <label className="inspector-row">
              <span>Stroke Width</span>
              <input
                type="number"
                value={layer.element.strokeWidth}
                onChange={(e) => setElement({ strokeWidth: Number(e.target.value) })}
              />
            </label>
          </>
        )}

        {layer.element.type === 'text' && (
          <>
            <label className="inspector-row inspector-row-stacked">
              <span>Content</span>
              <textarea
                rows={3}
                value={layer.element.content}
                onChange={(e) => setTextElement({ content: e.target.value })}
              />
            </label>
            <label className="inspector-row">
              <span>Color</span>
              <input
                type="color"
                value={layer.element.color}
                onChange={(e) => setTextElement({ color: e.target.value })}
              />
            </label>
            <label className="inspector-row">
              <span>Stroke Color</span>
              <input
                type="color"
                value={
                  layer.element.strokeColor === 'transparent'
                    ? '#000000'
                    : layer.element.strokeColor
                }
                onChange={(event) => setTextStroke({ strokeColor: event.target.value })}
              />
            </label>
            <label className="inspector-row">
              <span>Stroke Width</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={evaluatedTextStrokeWidth}
                onChange={(event) =>
                  setTextStroke({ strokeWidth: Math.max(0, Number(event.target.value)) })
                }
              />
            </label>
            <label className="inspector-row">
              <span>Size</span>
              <input
                type="number"
                min={1}
                value={layer.element.fontSize}
                onChange={(e) => setTextElement({ fontSize: Math.max(1, Number(e.target.value)) })}
              />
            </label>
            <label className="inspector-row">
              <span>Weight</span>
              <input
                type="number"
                min={100}
                max={900}
                step={100}
                value={layer.element.fontWeight}
                onChange={(e) =>
                  setTextElement({
                    fontWeight: Math.max(100, Math.min(900, Number(e.target.value))),
                  })
                }
              />
            </label>
            <label className="inspector-row">
              <span>Align</span>
              <select
                value={layer.element.textAlign}
                onChange={(e) =>
                  setTextElement({ textAlign: e.target.value as 'left' | 'center' | 'right' })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="inspector-row">
              <span>Font</span>
              <select
                className="inspector-font-select"
                value={selectedFontFamily}
                onChange={(e) => setTextElement({ fontFamily: e.target.value })}
              >
                {!availableFontOptions.some((option) => option.value === selectedFontFamily) && (
                  <option value={selectedFontFamily}>Current custom font</option>
                )}
                {availableFontOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="inspector-font-preview"
              title={`Selected template font: ${layer.element.fontFamily}`}
            >
              Template font: {selectedFontFamily}
            </div>
            <div className="inspector-grid">
              <label className="inspector-row">
                <span>Line height</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.05}
                  value={layer.element.lineHeight}
                  onChange={(e) =>
                    setTextElement({ lineHeight: Math.max(0.5, Number(e.target.value)) })
                  }
                />
              </label>
              <label className="inspector-row">
                <span>Tracking</span>
                <input
                  type="number"
                  step={0.1}
                  value={layer.element.letterSpacing}
                  onChange={(e) => setTextElement({ letterSpacing: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="inspector-grid">
              <label className="inspector-row">
                <span>Baseline</span>
                <input
                  type="number"
                  step={0.5}
                  value={layer.element.baselineShift}
                  onChange={(e) => setTextElement({ baselineShift: Number(e.target.value) })}
                />
              </label>
              <label className="inspector-row">
                <span>Minimum size</span>
                <input
                  type="number"
                  min={1}
                  max={selectedFontSize}
                  value={layer.element.minFontSize}
                  disabled={layer.element.autoFit !== 'shrink-to-fit'}
                  onChange={(e) =>
                    setTextElement({
                      minFontSize: Math.max(1, Math.min(selectedFontSize, Number(e.target.value))),
                    })
                  }
                />
              </label>
            </div>
            <label className="inspector-row">
              <span>Vertical</span>
              <select
                value={layer.element.verticalAlign}
                onChange={(event) =>
                  setTextElement({
                    verticalAlign: event.target.value as TextElement['verticalAlign'],
                  })
                }
              >
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <label className="inspector-row">
              <span>Transform</span>
              <select
                value={layer.element.textTransform}
                onChange={(event) =>
                  setTextElement({
                    textTransform: event.target.value as TextElement['textTransform'],
                  })
                }
              >
                <option value="none">None</option>
                <option value="uppercase">Uppercase</option>
                <option value="lowercase">Lowercase</option>
                <option value="capitalize">Capitalize</option>
              </select>
            </label>
            <label className="inspector-row">
              <span>Text sizing</span>
              <select
                value={layer.element.autoFit}
                onChange={(event) =>
                  setTextElement({ autoFit: event.target.value as TextElement['autoFit'] })
                }
              >
                <option value="auto-size">Auto size box</option>
                <option value="shrink-to-fit">Shrink text to box</option>
                <option value="fit-to-width">Fit to width</option>
                <option value="fixed">Fixed box</option>
              </select>
            </label>
            <label className="inspector-row">
              <span>Overflow</span>
              <select
                value={layer.element.overflowPolicy}
                onChange={(event) =>
                  setTextElement({
                    overflowPolicy: event.target.value as TextElement['overflowPolicy'],
                  })
                }
              >
                <option value="visible">Visible</option>
                <option value="clip">Clip</option>
                <option value="ellipsis">Ellipsis</option>
              </select>
            </label>
            <p className="inspector-hint">
              Auto size changes the authored box. Shrink only reduces text to its minimum-size
              floor. Fit to width grows or shrinks text to fill the fixed box without overflow.
            </p>
          </>
        )}

        {layer.element.type === 'path' && (
          <>
            <p className="inspector-hint">
              Raw SVG path data — paste a "d" attribute value. A visual path editor is future work.
            </p>
            <label className="inspector-row inspector-row-stacked">
              <span>Path Data (d)</span>
              <textarea
                rows={3}
                value={layer.element.d}
                onChange={(e) => setElement({ d: e.target.value })}
              />
            </label>
            <label className="inspector-row">
              <span>Fill</span>
              <input
                type="color"
                value={layer.element.fill}
                onChange={(e) => setElement({ fill: e.target.value })}
              />
            </label>
            <label className="inspector-row">
              <span>Stroke Color</span>
              <input
                type="color"
                value={
                  layer.element.strokeColor === 'transparent'
                    ? '#000000'
                    : layer.element.strokeColor
                }
                onChange={(e) => setElement({ strokeColor: e.target.value })}
              />
            </label>
            <label className="inspector-row">
              <span>Stroke Width</span>
              <input
                type="number"
                value={layer.element.strokeWidth}
                onChange={(e) => setElement({ strokeWidth: Number(e.target.value) })}
              />
            </label>
            <label className="inspector-row">
              <span>ViewBox W</span>
              <input
                type="number"
                value={layer.element.viewBoxWidth}
                onChange={(e) => setElement({ viewBoxWidth: Number(e.target.value) })}
              />
            </label>
            <label className="inspector-row">
              <span>ViewBox H</span>
              <input
                type="number"
                value={layer.element.viewBoxHeight}
                onChange={(e) => setElement({ viewBoxHeight: Number(e.target.value) })}
              />
            </label>
          </>
        )}

        {layer.element.type === 'image-sequence' && (
          <>
            {composition.assets.length > 0 && (
              <label className="inspector-row">
                <span>Add Frame</span>
                <select
                  value=""
                  onChange={(e) => {
                    const asset = composition.assets.find((a) => a.id === e.target.value);
                    if (asset) setElement({ frames: [...sequenceFrames, asset.dataUri] });
                  }}
                >
                  <option value="">Choose from Resources…</option>
                  {composition.assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {sequenceFrames.length === 0 ? (
              <p className="inspector-hint">No frames yet — add images from Resources, in order.</p>
            ) : (
              <ul className="inspector-frame-list">
                {sequenceFrames.map((frameSrc, index) => (
                  <li key={index} className="inspector-frame-row">
                    <img src={frameSrc} alt="" className="inspector-frame-thumb" />
                    <span>{index + 1}</span>
                    <button
                      type="button"
                      className="data-table-delete"
                      onClick={() =>
                        setElement({ frames: sequenceFrames.filter((_, i) => i !== index) })
                      }
                    >
                      {'✕'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="inspector-row">
              <span>FPS</span>
              <input
                type="number"
                value={layer.element.fps}
                onChange={(e) => setElement({ fps: Number(e.target.value) })}
              />
            </label>
            <label className="inspector-row">
              <span>Loop</span>
              <input
                type="checkbox"
                checked={layer.element.loop}
                onChange={(e) => setElement({ loop: e.target.checked })}
              />
            </label>
          </>
        )}

        {layer.element.type === 'lottie' && (
          <>
            <label className="inspector-row inspector-row-stacked">
              <span>
                {layer.element.animationData ? 'Replace Lottie JSON' : 'Choose Lottie JSON'}
              </span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  void file
                    .text()
                    .then((source) => setElement({ animationData: parseLottieJson(source) }))
                    .catch((error) =>
                      window.alert(error instanceof Error ? error.message : String(error)),
                    );
                }}
              />
            </label>
            {layer.element.animationData ? (
              <p className="inspector-hint">
                {layer.element.animationData.w} × {layer.element.animationData.h} ·{' '}
                {layer.element.animationData.fr} fps ·{' '}
                {Math.max(0, layer.element.animationData.op - layer.element.animationData.ip)}{' '}
                frames
              </p>
            ) : (
              <p className="inspector-hint">Import a self-contained Bodymovin/Lottie JSON file.</p>
            )}
            <label className="inspector-row">
              <span>Speed</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={layer.element.speed}
                onChange={(event) => setElement({ speed: Math.max(0, Number(event.target.value)) })}
              />
            </label>
            <p className="inspector-hint">
              Playback loops continuously. Expressions and external image/font paths are disabled.
            </p>
          </>
        )}

        {layer.element.type === 'image' && (
          <>
            {composition.assets.length > 0 && (
              <label className="inspector-row">
                <span>Resources</span>
                <select
                  value={composition.assets.find((a) => a.dataUri === imageSrc)?.id ?? ''}
                  onChange={(e) => {
                    const asset = composition.assets.find((a) => a.id === e.target.value);
                    if (asset) setElement({ src: asset.dataUri });
                  }}
                >
                  <option value="">Choose an imported image…</option>
                  {composition.assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="inspector-row inspector-row-stacked">
              <span>Source URL</span>
              <input
                type="text"
                placeholder="https://…"
                value={layer.element.src ?? ''}
                onChange={(e) => setElement({ src: e.target.value || null })}
              />
            </label>
          </>
        )}
      </div>
    </Panel>
  );
}
