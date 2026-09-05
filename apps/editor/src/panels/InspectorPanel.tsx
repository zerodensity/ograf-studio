import { useEditorWindow } from '../layout/EditorWindow';
import { TRANSFORM_HELP } from './propertyHelp';
import { PropertyRow } from '../components/PropertyRow';
import { EffectStackEditor } from './EffectStackEditor';
import { ImageSourceEditor } from './ImageSourceEditor';
import { LayerLightingEditor } from './LayerLightingEditor';
import { getEffectStack, EFFECT_CATALOG, effectProperty } from '@ograf-editor/scene-model';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { LayerMaskEditor } from './LayerMaskEditor';
import { TilingPatternEditor } from './TilingPatternEditor';
import { usePathEditStore } from '../state/pathEditStore';
import { pathConversionError } from '@ograf-editor/scene-model';
import {
  getLayerTransformAtFrame,
  useActiveComposition,
  useProjectStore,
  type ElementFields,
} from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { bindableProperties } from '../state/dataBinding';
import type {
  BlendMode,
  CornerRadii,
  DesignTokenTargetProperty,
  DesignTokenType,
  LayerTransform,
  TextElement,
} from '@ograf-editor/scene-model';
import {
  BLEND_MODES,
  createCornerRadii,
  findLayerKeyframeAtFrame,
  getLayerPropertyValueAtFrame,
  getPaintAtFrame,
  listFieldLeafPaths,
  getResolvedLayerAnimationTracks,
  inspectLottieAnimationData,
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
import { moveLayerToZOrder } from '../state/layerZOrder';
import './InspectorPanel.css';

const TRANSFORM_FIELDS: { key: keyof LayerTransform; label: string; step?: number }[] = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'W' },
  { key: 'height', label: 'H' },
  { key: 'rotation', label: 'Rotation' },
];

function elementSectionLabel(type: string): string {
  return type
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

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
  'rectangle' | 'ellipse' | 'text' | 'path' | 'pattern',
  Array<{ property: DesignTokenTargetProperty; label: string; tokenType: DesignTokenType }>
> = {
  rectangle: [
    { property: 'fill', label: 'Fill', tokenType: 'color' },
    { property: 'strokeColor', label: 'Stroke', tokenType: 'color' },
    { property: 'strokeWidth', label: 'Stroke width', tokenType: 'number' },
    { property: 'borderRadius', label: 'Corner radius', tokenType: 'number' },
    { property: 'borderRadiusTopLeft', label: 'Radius · top left', tokenType: 'number' },
    { property: 'borderRadiusTopRight', label: 'Radius · top right', tokenType: 'number' },
    { property: 'borderRadiusBottomRight', label: 'Radius · bottom right', tokenType: 'number' },
    { property: 'borderRadiusBottomLeft', label: 'Radius · bottom left', tokenType: 'number' },
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
  pattern: [
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

function ZOrderControl({
  value,
  maximum,
  onChange,
}: {
  value: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const normalized = Math.max(1, Math.min(maximum, Math.round(parsed)));
    setDraft(String(normalized));
    onChange(normalized);
  };

  return (
    <PropertyRow
      help={
        'Stacking position of this layer. 1 is the back; the highest number is the front. Increasing the value places the layer above others.'
      }
      className="inspector-row"
    >
      <span>Z order</span>
      <div className="inspector-z-order-control">
        <input
          aria-label="Z order"
          type="number"
          min={1}
          max={maximum}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(String(value));
              event.currentTarget.blur();
            }
          }}
        />
        <small>of {maximum}</small>
      </div>
    </PropertyRow>
  );
}

function CornerRadiusEditor({
  value,
  onChange,
}: {
  value: CornerRadii;
  onChange: (value: CornerRadii) => void;
}) {
  const isUniform = new Set(Object.values(value)).size === 1;
  return (
    <>
      <PropertyRow
        help={
          'Corner radius in pixels for all four corners. Entering a value replaces any individual corner radii; Mixed means the corners currently differ.'
        }
        className="inspector-row"
      >
        <span>All corners</span>
        <input
          type="number"
          min={0}
          value={isUniform ? value.topLeft : ''}
          placeholder="Mixed"
          onChange={(event) => onChange(createCornerRadii(Number(event.target.value)))}
        />
      </PropertyRow>
      <div className="inspector-grid inspector-corner-grid">
        {(
          [
            ['topLeft', 'Top left'],
            ['topRight', 'Top right'],
            ['bottomLeft', 'Bottom left'],
            ['bottomRight', 'Bottom right'],
          ] as const
        ).map(([corner, label]) => (
          <PropertyRow
            help={`Radius of the ${label.toLowerCase()} corner in pixels. Zero keeps this corner square.`}
            className="inspector-row inspector-row-stacked"
            key={corner}
          >
            <span>{label}</span>
            <input
              type="number"
              min={0}
              value={value[corner]}
              onChange={(event) =>
                onChange({
                  ...value,
                  [corner]: Math.max(0, Number(event.target.value)),
                })
              }
            />
          </PropertyRow>
        ))}
      </div>
    </>
  );
}

export function InspectorPanel() {
  const { window } = useEditorWindow();
  const composition = useActiveComposition();
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const selectedLayerId = useSelectionStore((s) => s.selectedLayerId);
  const liveTransform = useSelectionStore((s) => s.liveTransform);
  const renameLayer = useProjectStore((s) => s.renameLayer);
  const reorderLayers = useProjectStore((s) => s.reorderLayers);
  const updateLayerTransform = useProjectStore((s) => s.updateLayerTransform);
  const updateLayerKeyframeEasing = useProjectStore((s) => s.updateLayerKeyframeEasing);
  const updateLayerElement = useProjectStore((s) => s.updateLayerElement);
  const updateLayerTextStroke = useProjectStore((s) => s.updateLayerTextStroke);
  const updateLayerPaint = useProjectStore((s) => s.updateLayerPaint);
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
  const lottieInspection = useMemo(
    () =>
      layer?.element.type === 'lottie' && layer.element.animationData
        ? inspectLottieAnimationData(layer.element.animationData)
        : null,
    [layer?.element],
  );

  // Standard design-tool behavior: with nothing selected, Properties edits the document itself
  // rather than showing a dead-end message.
  if (!layer) {
    return (
      <Panel title="Properties">
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
  const evaluatedPaint =
    layer.element.type === 'rectangle' ||
    layer.element.type === 'ellipse' ||
    layer.element.type === 'path' ||
    layer.element.type === 'pattern'
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
  const tokenTargets: Array<{
    property: DesignTokenTargetProperty;
    label: string;
    tokenType: DesignTokenType;
  }> = [
    ...(layer.element.type in DESIGN_TOKEN_TARGETS
      ? DESIGN_TOKEN_TARGETS[layer.element.type as keyof typeof DESIGN_TOKEN_TARGETS]
      : []),
    { property: 'dropShadowColor', label: 'Shadow colour', tokenType: 'color' },
  ];
  if ('fill' in layer.element && typeof layer.element.fill !== 'string') {
    tokenTargets.push(
      ...layer.element.fill.stops.map((_, index) => ({
        property: `fill.stops[${index}].color` as const,
        label: `Gradient stop ${index + 1} colour`,
        tokenType: 'color' as const,
      })),
    );
  }
  for (const effect of getEffectStack(layer.effects).filter((e) => !e.legacy))
    for (const [key, spec] of Object.entries(EFFECT_CATALOG[effect.type].params))
      tokenTargets.push({
        property: effectProperty(effect, key) as DesignTokenTargetProperty,
        label: `${effect.name} · ${spec.label}`,
        tokenType: typeof spec.default === 'number' ? 'number' : 'color',
      });
  const zOrder = composition.layers.findIndex((candidate) => candidate.id === layer.id) + 1;

  return (
    <Panel title="Properties">
      <div className="inspector">
        <PropertyRow
          help={
            "Name used to identify this layer in the editor and by authoring tools. Rename it here; edit a text layer's visible wording under Content."
          }
          className="inspector-row"
        >
          <span>Name</span>
          <input
            type="text"
            value={layer.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => renameLayer(layer.id, e.target.value)}
          />
        </PropertyRow>
        <ZOrderControl
          value={zOrder}
          maximum={composition.layers.length}
          onChange={(nextZOrder) =>
            reorderLayers(
              moveLayerToZOrder(
                composition.layers.map((candidate) => candidate.id),
                layer.id,
                nextZOrder,
              ),
            )
          }
        />
        <p className="inspector-hint">1 is back; {composition.layers.length} is front.</p>
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
            <PropertyRow help={TRANSFORM_HELP[key]!} className="inspector-row" key={key}>
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
            </PropertyRow>
          ))}
        </div>

        <PropertyRow
          help={
            'Layer opacity at the current timeline frame. 0% is fully transparent and 100% is fully opaque; lower values let the background show through.'
          }
          as="div"
          className="inspector-alpha-control"
        >
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
        </PropertyRow>

        {activeLayerKeyframe && (
          <PropertyRow
            help={
              'Easing used when the animation arrives at this layer keyframe. It changes the acceleration of the incoming transition without changing its duration.'
            }
            className="inspector-row"
          >
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
          </PropertyRow>
        )}

        {layer.element.type === 'image' && (
          <ImageSourceEditor key={`image-${layer.id}`} layer={layer} assets={composition.assets} />
        )}
        {layer.element.type !== 'image' && (
          <h3 className="inspector-section">{elementSectionLabel(layer.element.type)}</h3>
        )}
        {layer.element.type !== 'image' && layer.bindings.length > 0 && (
          <p className="inspector-hint">
            {layer.bindings
              .map(
                (binding) =>
                  bindableProperties(layer.element, layer.effects).find(
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
            <CornerRadiusEditor
              value={layer.element.borderRadius}
              onChange={(borderRadius) => setElement({ borderRadius })}
            />
          </>
        )}

        {layer.element.type === 'ellipse' && (
          <>
            <PaintEditor
              value={evaluatedPaint ?? layer.element.fill}
              onChange={(fill) => updateLayerPaint(layer.id, roundedFrame, fill)}
            />
            <PropertyRow
              help={
                'Color of the shape outline. The outline is visible when Stroke Width is greater than zero.'
              }
              className="inspector-row"
            >
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
            </PropertyRow>
            <PropertyRow
              help={'Thickness of the shape outline in pixels. Zero removes the outline.'}
              className="inspector-row"
            >
              <span>Stroke Width</span>
              <input
                type="number"
                value={layer.element.strokeWidth}
                onChange={(e) => setElement({ strokeWidth: Number(e.target.value) })}
              />
            </PropertyRow>
          </>
        )}

        {layer.element.type === 'text' && (
          <>
            <PropertyRow
              help={
                'Text displayed by this layer. A connected playback data field can replace this content at runtime.'
              }
              className="inspector-row inspector-row-stacked"
            >
              <span>Content</span>
              <textarea
                rows={3}
                value={layer.element.content}
                onChange={(e) => setTextElement({ content: e.target.value })}
              />
            </PropertyRow>
            <PropertyRow
              help={
                'Fill color of the text characters. A Brand Kit token or runtime color binding can control this value.'
              }
              className="inspector-row"
            >
              <span>Color</span>
              <input
                type="color"
                value={layer.element.color}
                onChange={(e) => setTextElement({ color: e.target.value })}
              />
            </PropertyRow>
            <PropertyRow
              help={
                'Color of the outline around the text characters. Use Stroke Width to set its thickness.'
              }
              className="inspector-row"
            >
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
            </PropertyRow>
            <PropertyRow
              help={
                'Thickness of the text outline in pixels. Zero removes the outline; larger values can improve separation from the background.'
              }
              className="inspector-row"
            >
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
            </PropertyRow>
            <PropertyRow
              help={
                'Authored font size in pixels. Text sizing modes may scale or reduce the displayed text to fit its box.'
              }
              className="inspector-row"
            >
              <span>Size</span>
              <input
                type="number"
                min={1}
                value={layer.element.fontSize}
                onChange={(e) => setTextElement({ fontSize: Math.max(1, Number(e.target.value)) })}
              />
            </PropertyRow>
            <PropertyRow
              help={
                'Font weight from 100 (thin) to 900 (heavy). The available visual weights depend on the chosen font.'
              }
              className="inspector-row"
            >
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
            </PropertyRow>
            <PropertyRow
              help={'Horizontal alignment of the text within its box: left, centered or right.'}
              className="inspector-row"
            >
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
            </PropertyRow>
            <PropertyRow
              help={
                'Typeface used by the graphic. Imported font resources and built-in choices are listed here.'
              }
              className="inspector-row"
            >
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
            </PropertyRow>
            <div
              className="inspector-font-preview"
              title={`Selected template font: ${layer.element.fontFamily}`}
            >
              Template font: {selectedFontFamily}
            </div>
            <div className="inspector-grid">
              <PropertyRow
                help={
                  'Distance between text baselines as a multiplier of font size. Larger values add more space between lines.'
                }
                className="inspector-row"
              >
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
              </PropertyRow>
              <PropertyRow
                help={
                  'Additional spacing between characters in pixels. Positive values spread characters out; negative values bring them closer.'
                }
                className="inspector-row"
              >
                <span>Tracking</span>
                <input
                  type="number"
                  step={0.1}
                  value={layer.element.letterSpacing}
                  onChange={(e) => setTextElement({ letterSpacing: Number(e.target.value) })}
                />
              </PropertyRow>
            </div>
            <div className="inspector-grid">
              <PropertyRow
                help={
                  'Vertical shift of the text baseline in pixels, for fine alignment with neighboring text or symbols.'
                }
                className="inspector-row"
              >
                <span>Baseline</span>
                <input
                  type="number"
                  step={0.5}
                  value={layer.element.baselineShift}
                  onChange={(e) => setTextElement({ baselineShift: Number(e.target.value) })}
                />
              </PropertyRow>
              <PropertyRow
                help={
                  'Smallest font size allowed by Shrink text to box. The text will not shrink below this size.'
                }
                className="inspector-row"
              >
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
              </PropertyRow>
            </div>
            <PropertyRow
              help={'Vertical alignment of text inside its box: top, middle or bottom.'}
              className="inspector-row"
            >
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
            </PropertyRow>
            <PropertyRow
              help={
                'Change how letter case is displayed: unchanged, uppercase, lowercase or capitalized. This does not require rewriting the source wording.'
              }
              className="inspector-row"
            >
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
            </PropertyRow>
            <PropertyRow
              help={
                'Choose how text fits its box. Auto size changes the box; Shrink reduces the font; Fit to width scales proportionally; Squeeze stretches characters; Fixed keeps the box.'
              }
              className="inspector-row"
            >
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
                <option value="squeeze">Squeeze</option>
                <option value="fixed">Fixed box</option>
              </select>
            </PropertyRow>
            <PropertyRow
              help={
                'Choose how text that exceeds the box is shown: visible outside it, clipped, or shortened with an ellipsis.'
              }
              className="inspector-row"
            >
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
            </PropertyRow>
            <p className="inspector-hint">
              Auto size changes the authored box. Shrink only reduces text to its minimum-size
              floor. Fit to width scales proportionally. Squeeze fills the box by deforming glyph
              width and height independently.
            </p>
          </>
        )}

        {['rectangle', 'ellipse', 'path'].includes(layer.element.type) && (
          <div className="inspector-row">
            <button
              type="button"
              disabled={Boolean(pathConversionError(layer))}
              title={
                pathConversionError(layer) ??
                'Convert to editable points and curves. Shape edits apply across the animation; conversion uses the current frame dimensions.'
              }
              onClick={() => usePathEditStore.getState().start(layer.id)}
            >
              Edit as path
            </button>
          </div>
        )}
        {layer.element.type === 'path' && (
          <>
            <p className="inspector-hint">
              Edit points on the canvas with Edit as path, or enter SVG commands below.
            </p>
            <PropertyRow
              help={
                "SVG path commands from a path's d attribute. These commands define the vector shape; paste path data rather than a complete SVG document."
              }
              className="inspector-row inspector-row-stacked"
            >
              <span>Path Data (d)</span>
              <textarea
                rows={3}
                value={layer.element.d}
                onChange={(e) => setElement({ d: e.target.value })}
              />
            </PropertyRow>
            <PaintEditor
              value={evaluatedPaint ?? layer.element.fill}
              onChange={(fill) => updateLayerPaint(layer.id, roundedFrame, fill)}
            />
            <PropertyRow
              help={
                'Rule for filling overlapping path contours. Even-odd commonly creates holes; Nonzero uses contour direction to decide which regions are filled.'
              }
              className="inspector-row"
            >
              <span>Fill rule</span>
              <select
                aria-label="Path fill rule"
                value={layer.element.fillRule}
                onChange={(e) => setElement({ fillRule: e.target.value as 'nonzero' | 'evenodd' })}
              >
                <option value="nonzero">Nonzero winding</option>
                <option value="evenodd">Even-odd holes</option>
              </select>
            </PropertyRow>
            <PropertyRow
              help={
                'Color of the vector path outline. Stroke Width determines whether and how strongly it is drawn.'
              }
              className="inspector-row"
            >
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
            </PropertyRow>
            <PropertyRow
              help={
                'Thickness of the vector path outline in pixels. Zero draws the fill without an outline.'
              }
              className="inspector-row"
            >
              <span>Stroke Width</span>
              <input
                type="number"
                value={layer.element.strokeWidth}
                onChange={(e) => setElement({ strokeWidth: Number(e.target.value) })}
              />
            </PropertyRow>
            <PropertyRow
              help={
                "Width of the path's internal SVG coordinate system. It maps the path coordinates into the layer's displayed width."
              }
              className="inspector-row"
            >
              <span>ViewBox W</span>
              <input
                type="number"
                value={layer.element.viewBoxWidth}
                onChange={(e) => setElement({ viewBoxWidth: Number(e.target.value) })}
              />
            </PropertyRow>
            <PropertyRow
              help={
                "Height of the path's internal SVG coordinate system. It maps the path coordinates into the layer's displayed height."
              }
              className="inspector-row"
            >
              <span>ViewBox H</span>
              <input
                type="number"
                value={layer.element.viewBoxHeight}
                onChange={(e) => setElement({ viewBoxHeight: Number(e.target.value) })}
              />
            </PropertyRow>
          </>
        )}
        {layer.element.type === 'pattern' && (
          <>
            <PropertyRow
              help={
                'Shared procedural pattern used by this layer. Editing that pattern updates all linked fills, outlines and masks.'
              }
              className="inspector-row"
            >
              <span>Shared pattern</span>
              <select
                aria-label="Shared pattern"
                value={layer.element.patternId}
                onChange={(e) => setElement({ patternId: e.target.value })}
              >
                {composition.patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </PropertyRow>
            <PaintEditor
              value={evaluatedPaint ?? layer.element.fill}
              onChange={(fill) => updateLayerPaint(layer.id, roundedFrame, fill)}
            />
            <PropertyRow
              help={
                'Color of the outlines around the repeated symbols. Outline width controls their thickness.'
              }
              className="inspector-row"
            >
              <span>Outline color</span>
              <input
                type="color"
                value={
                  layer.element.strokeColor === 'transparent'
                    ? '#000000'
                    : layer.element.strokeColor
                }
                onChange={(e) => setElement({ strokeColor: e.target.value })}
              />
            </PropertyRow>
            <PropertyRow
              help={
                "Thickness of the repeated symbols' outlines in pixels. Zero hides the outlines."
              }
              className="inspector-row"
            >
              <span>Outline width</span>
              <input
                type="number"
                min={0}
                value={layer.element.strokeWidth}
                onChange={(e) => setElement({ strokeWidth: Number(e.target.value) })}
              />
            </PropertyRow>
            {composition.patterns
              .filter((p) => layer.element.type === 'pattern' && p.id === layer.element.patternId)
              .map((p) => (
                <TilingPatternEditor key={p.id} pattern={p} frameRate={composition.frameRate} />
              ))}
          </>
        )}

        {layer.element.type === 'image-sequence' && (
          <>
            {composition.assets.length > 0 && (
              <PropertyRow
                help={
                  'Add an image resource as the next frame in this image sequence. Frame order determines the playback order.'
                }
                className="inspector-row"
              >
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
              </PropertyRow>
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
            <PropertyRow
              help={
                'Playback rate of the image sequence in frames per second. This is independent of the composition frame rate.'
              }
              className="inspector-row"
            >
              <span>FPS</span>
              <input
                type="number"
                value={layer.element.fps}
                onChange={(e) => setElement({ fps: Number(e.target.value) })}
              />
            </PropertyRow>
            <PropertyRow
              help={
                'Repeat the image sequence when it reaches its last frame. Disable to play the sequence without repetition.'
              }
              className="inspector-row"
            >
              <span>Loop</span>
              <input
                type="checkbox"
                checked={layer.element.loop}
                onChange={(e) => setElement({ loop: e.target.checked })}
              />
            </PropertyRow>
          </>
        )}

        {layer.element.type === 'lottie' && (
          <>
            <PropertyRow
              help={
                "Load or replace this layer's Lottie animation from a JSON file. Its existing layer placement remains editable."
              }
              className="inspector-row inspector-row-stacked"
            >
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
            </PropertyRow>
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
            <PropertyRow
              help={
                'Playback speed multiplier for this Lottie animation. 1 uses its original timing; larger values play it faster.'
              }
              className="inspector-row"
            >
              <span>Speed</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={layer.element.speed}
                onChange={(event) => setElement({ speed: Math.max(0, Number(event.target.value)) })}
              />
            </PropertyRow>
            <p className="inspector-hint">
              Light Canvas playback loops continuously. External image/font paths are rejected.
            </p>
            {lottieInspection?.warnings.map((warning) => (
              <p className="inspector-hint" key={warning}>
                Warning: {warning}
              </p>
            ))}
          </>
        )}
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
                <PropertyRow
                  help={`Link ${target.label.toLowerCase()} to a shared Brand Kit token. Editing the token updates this property on linked layers. Unlinked removes the connection while keeping the current value.`}
                  className="inspector-row"
                  key={target.property}
                >
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
                </PropertyRow>
              );
            })}
            {composition.designSystem.tokens.length === 0 && (
              <p className="inspector-hint">Create brand tokens in Brand Kit first.</p>
            )}
          </>
        )}
        <EffectStackEditor layer={layer} frame={roundedFrame} />
        <LayerLightingEditor key={`lighting-${layer.id}`} layer={layer} composition={composition} />

        <h3 className="inspector-section">Compositing</h3>
        <PropertyRow
          help={
            "Choose how this layer's colors combine with layers behind it. Normal draws it normally; other modes can lighten, darken or mix the result."
          }
          className="inspector-row"
        >
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
        </PropertyRow>

        <LayerMaskEditor composition={composition} layer={layer} key={layer.id} />
        <h3 className="inspector-section">Layout relationships</h3>
        <PropertyRow
          help={
            "Clip child layers at this parent layer's bounds. Use it to keep moving content inside a panel or lower-third background."
          }
          className="inspector-row inspector-checkbox-row"
        >
          <span>Clip children</span>
          <input
            type="checkbox"
            checked={layer.clipChildren}
            onChange={(event) => setLayerClipChildren(layer.id, event.target.checked)}
          />
        </PropertyRow>

        <PropertyRow
          help={
            'Lock this layer to protect it from selection-based edits and accidental moves. Unlock it before editing its transform or protected properties.'
          }
          className="inspector-row inspector-checkbox-row"
        >
          <span>Locked</span>
          <input
            type="checkbox"
            checked={layer.isLocked}
            onChange={() => toggleLayerLock(layer.id)}
          />
        </PropertyRow>
        <PropertyRow
          help={
            'Choose a parent layer to establish a layout relationship. Parent movement and resizing can move or resize this layer according to its constraints.'
          }
          className="inspector-row"
        >
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
        </PropertyRow>
        <div className="inspector-grid">
          <PropertyRow
            help={
              "Choose how the layer's horizontal position and width respond when its parent or canvas is resized: anchor an edge, stretch, center or scale."
            }
            className="inspector-row"
          >
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
          </PropertyRow>
          <PropertyRow
            help={
              "Choose how the layer's vertical position and height respond when its parent or canvas is resized: anchor an edge, stretch, center or scale."
            }
            className="inspector-row"
          >
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
          </PropertyRow>
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
                <PropertyRow
                  help={
                    'Data field that supplies a value during playback. Its default is used unless runtime data overrides it.'
                  }
                  className="inspector-row"
                >
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
                </PropertyRow>
                {(field?.type === 'object' || field?.type === 'array') && (
                  <PropertyRow
                    help={
                      'Choose the nested value inside an object or collection item that this binding reads.'
                    }
                    className="inspector-row"
                  >
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
                  </PropertyRow>
                )}
                <PropertyRow
                  help={
                    'Layer property controlled by the chosen data field, such as text, position or a gradient-stop color. Incoming playback data updates this property.'
                  }
                  className="inspector-row"
                >
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
                    {bindableProperties(layer.element, layer.effects)
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
                </PropertyRow>
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
              bindableProperties(layer.element, layer.effects).every((property) =>
                layer.bindings.some((binding) => binding.targetProperty === property.value),
              )
            }
            onClick={() => {
              const targetProperty = bindableProperties(layer.element, layer.effects).find(
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

        <h3 className="inspector-section">Semantic intent</h3>
        <PropertyRow
          help={
            "Describe the layer's purpose, such as headline, background or container. Style packs and design checks use this semantic role when styling or reviewing the scene."
          }
          className="inspector-row"
        >
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
        </PropertyRow>
        <PropertyRow
          help={
            'Comma-separated tags that help organize and find the layer. Authoring tools can use tags to target related layers.'
          }
          className="inspector-row"
        >
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
        </PropertyRow>
        <PropertyRow
          help={
            'Describe what this layer is meant to communicate or do. This is design guidance for authors and AI tools; it is not displayed in the graphic.'
          }
          className="inspector-row"
        >
          <span>Intent</span>
          <textarea
            value={layer.semantics.description}
            placeholder="What this layer means in the design"
            onChange={(event) => setLayerSemantics(layer.id, { description: event.target.value })}
          />
        </PropertyRow>
      </div>
    </Panel>
  );
}
