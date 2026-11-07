import { useEffect, useRef, useState } from 'react';
import {
  getElementFill,
  type Composition,
  type Layer,
  type LayerTransform,
  type TextElement,
  type RectangleElement,
  type EllipseElement,
  type PathElement,
} from '@ograf-editor/scene-model';
import { getLayerTransformAtFrame } from '../state/projectStore';
import { applySharedTransform } from '../state/multiTransformEditing';
import { PropertyRow } from '../components/PropertyRow';
import { ColorInput } from '../components/ColorInput';
import { applySharedTextColor, applySharedTextProperty } from '../state/multiTextEditing';
import {
  isSharedShape,
  applySharedShapeColor,
  applySharedShapeStroke,
  applySharedCorner,
  applySharedElementScalar,
} from '../state/multiShapeEditing';
import { FONT_OPTIONS } from './fontOptions';
import { Panel } from './Panel';
import { EffectStackEditor } from './EffectStackEditor';
import { LayerMotionEditor } from './LayerMotionEditor';
import './MultiSelectionProperties.css';

function Value({
  label,
  value,
  disabled,
  onCommit,
  min,
  max,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const cancel = useRef(false);
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  return (
    <PropertyRow
      className="inspector-row"
      help={`Set ${label.toLowerCase()} for the selected layers.`}
    >
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        placeholder={value === null ? 'Mixed' : undefined}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          const next = Number(draft);
          if (
            !cancel.current &&
            draft.trim() &&
            Number.isFinite(next) &&
            (value === null || value !== next)
          )
            onCommit(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)));
          else setDraft(value === null ? '' : String(value));
          cancel.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancel.current = true;
            setDraft(value === null ? '' : String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </PropertyRow>
  );
}

/** Only properties common to the whole selection are shown for mixed layer types. */
export function MultiSelectionProperties({
  layers,
  frame,
  composition,
}: {
  layers: Layer[];
  frame: number;
  composition: Composition;
}) {
  const unlockedLayers = layers.filter((layer) => !layer.isLocked);
  const poses = unlockedLayers.map((layer) => getLayerTransformAtFrame(layer, frame));
  const shared = (key: keyof LayerTransform): number | null => {
    const value = poses[0]?.[key];
    return value !== undefined && poses.every((pose) => Math.abs(pose[key] - value) < 0.000001)
      ? value
      : null;
  };
  const fields: Array<{ key: keyof LayerTransform; label: string }> = [
    { key: 'x', label: 'X' },
    { key: 'y', label: 'Y' },
    { key: 'width', label: 'Width' },
    { key: 'height', label: 'Height' },
    { key: 'rotation', label: 'Rotation' },
    { key: 'opacity', label: 'Opacity' },
  ];
  const allText = layers.every((layer) => layer.element.type === 'text');
  const editableText = layers.filter((layer) => !layer.isLocked && layer.element.type === 'text');
  const textElements = editableText.map((layer) => layer.element as TextElement);
  const textIds = editableText.map((layer) => layer.id);
  const commonText = <K extends keyof TextElement>(key: K): TextElement[K] | null => {
    const value = textElements[0]?.[key];
    return value !== undefined && textElements.every((item) => item[key] === value) ? value : null;
  };
  const currentFont = commonText('fontFamily');
  const fontOptions = [
    ...new Map(
      [
        ...FONT_OPTIONS,
        ...composition.assets
          .filter((asset) => asset.kind === 'font')
          .map((asset) => ({
            label: asset.fontFamily || asset.name,
            value: asset.fontFamily || asset.name,
          })),
        ...textElements.map((element) => ({
          label: element.fontFamily,
          value: element.fontFamily,
        })),
      ].map((option) => [option.value, option]),
    ).values(),
  ];
  const textPaints = textElements.map((element) => getElementFill(element));
  const solidColors =
    textPaints.length > 0 && textPaints.every((paint) => typeof paint === 'string');
  const commonColor =
    solidColors && textPaints.every((paint) => paint === textPaints[0])
      ? (textPaints[0] as string)
      : null;
  const allShapes = layers.every(isSharedShape);
  const shapes = layers.filter((layer) => !layer.isLocked && isSharedShape(layer));
  const shapeIds = shapes.map((layer) => layer.id);
  const shapeElements = shapes.map(
    (layer) => layer.element as RectangleElement | EllipseElement | PathElement,
  );
  const paints = shapeElements.map(getElementFill);
  const solidShapePaints = paints.length > 0 && paints.every((paint) => typeof paint === 'string');
  const sharedShape = <K extends 'strokeColor' | 'strokeWidth'>(key: K) => {
    const value = shapeElements[0]?.[key];
    return value !== undefined && shapeElements.every((element) => element[key] === value)
      ? value
      : null;
  };
  const elementType = layers[0]?.element.type;
  const sameType = elementType && layers.every((layer) => layer.element.type === elementType);
  const editableElements = layers.filter((layer) => !layer.isLocked);
  const elementIds = editableElements.map((layer) => layer.id);
  const commonScalar = (key: string): string | number | boolean | null => {
    const elements = editableElements.map(
      (layer) => layer.element as unknown as Record<string, unknown>,
    );
    const value = elements[0]?.[key];
    return (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') &&
      elements.every((element) => element[key] === value)
      ? value
      : null;
  };
  const commitScalar = (key: string, value: string | number | boolean) => {
    if (elementType) applySharedElementScalar(elementIds, elementType, key, value);
  };
  return (
    <Panel title="Properties">
      <div className="multi-selection-properties">
        <strong>{layers.length} layers selected</strong>
        <p>Common properties · different values are marked Mixed.</p>
        <h4>Transform</h4>
        {unlockedLayers.length < layers.length && (
          <p>Locked layers are skipped when editing transforms.</p>
        )}
        {fields.map(({ key, label }) => (
          <Value
            key={key}
            label={label}
            value={shared(key)}
            disabled={!unlockedLayers.length}
            onCommit={(value) =>
              applySharedTransform(
                unlockedLayers.map((layer) => layer.id),
                frame,
                key,
                value,
                label,
              )
            }
          />
        ))}
        {allText && (
          <>
            <h4>Text</h4>
            {editableText.length < layers.length && (
              <p>Locked layers are skipped when editing text.</p>
            )}
            <PropertyRow
              className="inspector-row"
              help="Set the font family for unlocked selected text layers."
            >
              <span>Font</span>
              <select
                aria-label="Text font"
                disabled={!textIds.length}
                value={currentFont ?? ''}
                onChange={(event) =>
                  applySharedTextProperty(textIds, 'fontFamily', event.currentTarget.value)
                }
              >
                {currentFont === null && (
                  <option value="" disabled>
                    Mixed
                  </option>
                )}
                {fontOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </PropertyRow>
            <Value
              label="Text size"
              value={commonText('fontSize')}
              min={1}
              disabled={!textIds.length}
              onCommit={(value) => applySharedTextProperty(textIds, 'fontSize', value)}
            />
            <Value
              label="Text weight"
              value={commonText('fontWeight')}
              min={100}
              max={900}
              disabled={!textIds.length}
              onCommit={(value) => applySharedTextProperty(textIds, 'fontWeight', value)}
            />
            {solidColors ? (
              <PropertyRow
                className="inspector-row"
                help="Set the solid text color for unlocked selected layers."
              >
                <span>Color{commonColor === null ? ' · Mixed' : ''}</span>
                <ColorInput
                  label="Text color"
                  value={commonColor ?? (textPaints[0] as string)}
                  disabled={!textIds.length}
                  onChange={(color) => applySharedTextColor(textIds, frame, color)}
                />
              </PropertyRow>
            ) : (
              textIds.length > 0 && (
                <p>Mixed or non-solid fills: select one object to edit its paint.</p>
              )
            )}
            <PropertyRow className="inspector-row" help="Align text horizontally in each box.">
              <span>Align</span>
              <select
                aria-label="Text alignment"
                value={commonText('textAlign') ?? ''}
                disabled={!textIds.length}
                onChange={(event) =>
                  applySharedTextProperty(
                    textIds,
                    'textAlign',
                    event.currentTarget.value as TextElement['textAlign'],
                  )
                }
              >
                {commonText('textAlign') === null && (
                  <option value="" disabled>
                    Mixed
                  </option>
                )}
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </PropertyRow>
            <PropertyRow className="inspector-row" help="Align text vertically in each box.">
              <span>Vertical</span>
              <select
                aria-label="Text vertical alignment"
                value={commonText('verticalAlign') ?? ''}
                disabled={!textIds.length}
                onChange={(event) =>
                  applySharedTextProperty(
                    textIds,
                    'verticalAlign',
                    event.currentTarget.value as TextElement['verticalAlign'],
                  )
                }
              >
                {commonText('verticalAlign') === null && (
                  <option value="" disabled>
                    Mixed
                  </option>
                )}
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </PropertyRow>
          </>
        )}
        {allShapes && (
          <>
            <h4>Shape</h4>
            {shapes.length < layers.length && <p>Locked layers are skipped when editing shapes.</p>}
            {solidShapePaints ? (
              <PropertyRow className="inspector-row" help="Set the solid fill of selected shapes.">
                <span>Fill{paints.every((paint) => paint === paints[0]) ? '' : ' · Mixed'}</span>
                <ColorInput
                  label="Shape fill"
                  value={paints[0] as string}
                  onChange={(color) => applySharedShapeColor(shapeIds, frame, color)}
                />
              </PropertyRow>
            ) : (
              shapeIds.length > 0 && (
                <p>Mixed or non-solid fills: select one object to edit its paint.</p>
              )
            )}
            {shapeIds.length > 0 && (
              <PropertyRow
                className="inspector-row"
                help="Set the outline color for selected shapes."
              >
                <span>Stroke{sharedShape('strokeColor') === null ? ' · Mixed' : ''}</span>
                <ColorInput
                  label="Shape stroke color"
                  value={sharedShape('strokeColor') ?? shapeElements[0]!.strokeColor}
                  onChange={(color) => applySharedShapeStroke(shapeIds, 'strokeColor', color)}
                />
              </PropertyRow>
            )}
            <Value
              label="Stroke width"
              value={sharedShape('strokeWidth')}
              min={0}
              disabled={!shapeIds.length}
              onCommit={(value) => applySharedShapeStroke(shapeIds, 'strokeWidth', value)}
            />
            {shapeElements.length > 0 &&
              layers.every((layer) => layer.element.type === 'rectangle') &&
              (['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const).map((corner) => {
                const rectangles = shapeElements as RectangleElement[];
                const first = rectangles[0]!.borderRadius[corner];
                return (
                  <Value
                    key={corner}
                    label={`${corner} radius`}
                    value={
                      rectangles.every((item) => item.borderRadius[corner] === first) ? first : null
                    }
                    min={0}
                    disabled={!shapeIds.length}
                    onCommit={(value) => applySharedCorner(shapeIds, corner, value)}
                  />
                );
              })}
          </>
        )}
        {sameType &&
          ['image', 'image-sequence', 'lottie', 'ticker', 'chart', 'audio'].includes(
            elementType,
          ) && (
            <>
              <h4>
                {elementType === 'ticker' ? 'Ticker' : elementType === 'chart' ? 'Chart' : 'Media'}
              </h4>
              {editableElements.length < layers.length && <p>Locked layers are skipped.</p>}
              {(elementType === 'image' || elementType === 'image-sequence') && (
                <PropertyRow className="inspector-row" help="Set how each source fits its frame.">
                  <span>Fit</span>
                  <select
                    aria-label="Media fit"
                    disabled={!elementIds.length}
                    value={String(commonScalar('fit') ?? '')}
                    onChange={(event) => commitScalar('fit', event.currentTarget.value)}
                  >
                    {commonScalar('fit') === null && (
                      <option value="" disabled>
                        Mixed / default
                      </option>
                    )}
                    <option value="contain">Contain</option>
                    <option value="cover">Cover</option>
                    <option value="fill">Fill</option>
                  </select>
                </PropertyRow>
              )}
              {elementType === 'image-sequence' && (
                <Value
                  label="Sequence FPS"
                  min={1}
                  value={commonScalar('fps') as number | null}
                  disabled={!elementIds.length}
                  onCommit={(value) => commitScalar('fps', value)}
                />
              )}
              {elementType === 'lottie' && (
                <Value
                  label="Lottie speed"
                  min={0}
                  value={commonScalar('speed') as number | null}
                  disabled={!elementIds.length}
                  onCommit={(value) => commitScalar('speed', value)}
                />
              )}
              {elementType === 'audio' && (
                <Value
                  label="Volume"
                  min={0}
                  max={1}
                  value={commonScalar('volume') as number | null}
                  disabled={!elementIds.length}
                  onCommit={(value) => commitScalar('volume', value)}
                />
              )}
              {elementType === 'chart' && (
                <>
                  <Value
                    label="Chart font size"
                    min={1}
                    value={commonScalar('fontSize') as number | null}
                    disabled={!elementIds.length}
                    onCommit={(value) => commitScalar('fontSize', value)}
                  />
                  {editableElements.length > 0 && (
                    <PropertyRow
                      className="inspector-row"
                      help="Set label color for selected charts."
                    >
                      <span>Label color{commonScalar('textColor') === null ? ' · Mixed' : ''}</span>
                      <ColorInput
                        label="Chart label color"
                        value={
                          (commonScalar('textColor') ??
                            (editableElements[0]!.element as { textColor: string })
                              .textColor) as string
                        }
                        onChange={(color) => commitScalar('textColor', color)}
                      />
                    </PropertyRow>
                  )}
                </>
              )}
              {(elementType === 'audio' ||
                elementType === 'image-sequence' ||
                elementType === 'chart') &&
                (elementType === 'chart'
                  ? ([
                      ['showLegend', 'Legend'],
                      ['showGrid', 'Grid'],
                    ] as const)
                  : ([['loop', 'Loop']] as const)
                ).map(([key, label]) => (
                  <PropertyRow
                    key={key}
                    className="inspector-row"
                    help={`Set ${label.toLowerCase()} for selected layers.`}
                  >
                    <span>{label}</span>
                    <select
                      aria-label={label}
                      disabled={!elementIds.length}
                      value={commonScalar(key) === null ? '' : String(commonScalar(key))}
                      onChange={(event) => commitScalar(key, event.currentTarget.value === 'true')}
                    >
                      {commonScalar(key) === null && (
                        <option value="" disabled>
                          Mixed
                        </option>
                      )}
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                  </PropertyRow>
                ))}
              {elementType === 'ticker' && (
                <>
                  <Value
                    label="Ticker speed"
                    min={0}
                    value={commonScalar('speedPixelsPerSecond') as number | null}
                    disabled={!elementIds.length}
                    onCommit={(value) => commitScalar('speedPixelsPerSecond', value)}
                  />
                  <Value
                    label="Ticker gap"
                    min={0}
                    value={commonScalar('gap') as number | null}
                    disabled={!elementIds.length}
                    onCommit={(value) => commitScalar('gap', value)}
                  />
                  <PropertyRow
                    className="inspector-row"
                    help="Set the direction of selected tickers."
                  >
                    <span>Direction</span>
                    <select
                      aria-label="Ticker direction"
                      disabled={!elementIds.length}
                      value={String(commonScalar('direction') ?? '')}
                      onChange={(event) => commitScalar('direction', event.currentTarget.value)}
                    >
                      {commonScalar('direction') === null && (
                        <option value="" disabled>
                          Mixed
                        </option>
                      )}
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </PropertyRow>
                </>
              )}
            </>
          )}
        <EffectStackEditor layer={layers[0]!} frame={frame} groupLayers={layers} />
        <h4>Animate In / Out</h4>
        <LayerMotionEditor
          composition={composition}
          layer={layers[0]!}
          layerIds={layers.map((layer) => layer.id)}
        />
      </div>
    </Panel>
  );
}
