import { useEffect, useState, type ReactNode } from 'react';
import {
  getLayerPropertyValueAtFrame,
  modifierParameterSpec,
  modifierProperty,
  type Composition,
  type GeometryReference,
  type Layer,
  type LayerModifier,
  type LayerModifierType,
  type ModifierValueSource,
} from '@ograf-editor/scene-model';
import { Panel } from './Panel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { containerModifierDefaults } from '../state/modifierContainerDefaults';
import {
  addModifier,
  copyModifier,
  deleteModifier,
  editLayerModifier,
  exposeModifierNumber,
  modifierDrivenProperties,
  moveModifier,
  resetModifier,
  setModifierNumber,
} from '../state/modifiersEditing';
import './ModifiersPanel.css';

const LABELS: Record<LayerModifierType, string> = {
  'max-text-width': 'Max Text Width',
  'auto-size': 'Auto Size',
  'auto-follow': 'Auto Follow',
  'hide-empty': 'Hide When Empty',
  'grid-arrange': 'Grid Arrange',
  'radial-arrange': 'Radial Arrange',
  justify: 'Justify',
  'look-at': 'Look At',
};
/** Spline Path edits the layer's Motion Path link; it is listed here beside the modifiers. */
const SPLINE_PATH = 'spline-path';
type AddableType = LayerModifierType | typeof SPLINE_PATH;
const SPLINE_PATH_DESCRIPTION =
  'Move this object along a path layer. Animate Progress; optionally orient it to the path.';
const CONTAINER_TYPES: readonly LayerModifierType[] = ['grid-arrange', 'radial-arrange', 'justify'];
const DESCRIPTIONS: Record<LayerModifierType, string> = {
  'max-text-width': 'Keep short text unchanged; fit longer text within a maximum width.',
  'auto-size': 'Fit this object around another object or group, with padding.',
  'auto-follow': 'Keep this object attached to a reference edge or anchor.',
  'hide-empty': 'Hide this object or a group when text, an image, or a data value is empty.',
  'grid-arrange': 'Arrange this object’s child objects in rows and columns.',
  'radial-arrange': 'Arrange this object’s child objects around its center on a circle or arc.',
  justify: 'Align the combined bounds of this object’s visible children to its own box.',
  'look-at': 'Rotate this object so one of its sides always faces another object or group.',
};
const GRID_CORNERS = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};
const FOLLOW_ATTACHMENTS = {
  'Right of': { sourceAnchorX: 1, sourceAnchorY: 0.5, targetAnchorX: 0, targetAnchorY: 0.5 },
  'Left of': { sourceAnchorX: 0, sourceAnchorY: 0.5, targetAnchorX: 1, targetAnchorY: 0.5 },
  Below: { sourceAnchorX: 0, sourceAnchorY: 1, targetAnchorX: 0, targetAnchorY: 0 },
  Above: { sourceAnchorX: 0, sourceAnchorY: 0, targetAnchorX: 0, targetAnchorY: 1 },
  Center: { sourceAnchorX: 0.5, sourceAnchorY: 0.5, targetAnchorX: 0.5, targetAnchorY: 0.5 },
};

interface PickOption {
  value: string;
  label: string;
  detail?: string;
}
const referenceValue = (reference: GeometryReference) =>
  reference.kind === 'layer' ? `layer:${reference.layerId}` : `group:${reference.groupId}`;
function geometryReference(value: string): GeometryReference {
  return value.startsWith('group:')
    ? { kind: 'group', groupId: value.slice(6) }
    : { kind: 'layer', layerId: value.slice(6) };
}

/** Full names wrap in both the selected value and the searchable choice list. */
export function ModifierReferencePicker({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  options: PickOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const matches = options.filter((option) =>
    `${option.label} ${option.detail ?? ''}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  );
  return (
    <div className="modifier-picker">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        className="modifier-picker-selected"
        onClick={() => setOpen(!open)}
      >
        <span>
          {selected?.label ?? (value ? 'Missing reference — choose another' : 'Choose reference…')}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="modifier-picker-popover">
          <input
            type="search"
            value={filter}
            placeholder="Search objects or groups…"
            aria-label={`Search ${label.toLowerCase()}`}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          />
          <div role="listbox" aria-label={label} className="modifier-picker-options">
            {matches.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.detail && <small>{option.detail}</small>}
              </button>
            ))}
            {!matches.length && <p className="modifier-muted">No matching references.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function modifierGeometryOptions(composition: Composition, excludeLayerId?: string): PickOption[] {
  const groups = new Map<string, Layer[]>();
  for (const layer of composition.layers) {
    if (layer.groupId) groups.set(layer.groupId, [...(groups.get(layer.groupId) ?? []), layer]);
  }
  return [
    ...composition.layers
      .filter((layer) => layer.id !== excludeLayerId)
      .map((layer) => ({
        value: `layer:${layer.id}`,
        label: layer.name,
        detail: layer.element.type,
      })),
    ...[...groups]
      .filter(([, members]) => !members.some((layer) => layer.id === excludeLayerId))
      .map(([groupId, members]) => ({
        value: `group:${groupId}`,
        label: members.map((layer) => layer.name).join(' + '),
        detail: `Group · ${members.length} objects`,
      })),
  ];
}

function valueSource(value: string, composition: Composition): ModifierValueSource {
  if (value.startsWith('field:')) return { kind: 'field', fieldId: value.slice(6), sourcePath: [] };
  const layer = composition.layers.find((candidate) => candidate.id === value.slice(6));
  return {
    kind: 'layer',
    layerId: value.slice(6),
    property: layer?.element.type === 'text' ? 'content' : 'src',
  };
}
function sourceOptions(composition: Composition): PickOption[] {
  return [
    ...composition.layers
      .filter((layer) => ['text', 'image'].includes(layer.element.type))
      .map((layer) => ({
        value: `layer:${layer.id}`,
        label: layer.name,
        detail: layer.element.type,
      })),
    ...composition.dataFields.map((field) => ({
      value: `field:${field.id}`,
      label: field.label || field.key,
      detail: `Data · ${field.key}`,
    })),
  ];
}
const sourceValue = (source: ModifierValueSource) =>
  source.kind === 'field' ? `field:${source.fieldId}` : `layer:${source.layerId}`;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="modifier-row">
      <span className="modifier-row-label">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function ModifierSourcePath({
  source,
  onChange,
}: {
  source: Extract<ModifierValueSource, { kind: 'field' }>;
  onChange: (source: ModifierValueSource) => void;
}) {
  const committed = source.sourcePath.join('.');
  const [draft, setDraft] = useState(committed);
  useEffect(() => setDraft(committed), [committed]);
  return (
    <input
      type="text"
      aria-label="Nested data value path"
      placeholder="Optional: team.subtitle"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parts = draft
          .split('.')
          .map((part) => part.trim())
          .filter(Boolean);
        onChange({ ...source, sourcePath: parts });
        setDraft(parts.join('.'));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function ModifierNumber({
  layer,
  modifier,
  parameter,
  label,
  act,
}: {
  layer: Layer;
  modifier: LayerModifier;
  parameter: string;
  label: string;
  act: (mutation: () => void) => void;
}) {
  const frame = useTimelineStore((state) => state.currentFrame);
  const property = modifierProperty(modifier, parameter);
  const spec = modifierParameterSpec(layer, property);
  const value = getLayerPropertyValueAtFrame(layer, property, frame);
  const display = String(Number(value.toFixed(4)));
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  if (!spec) return null;
  const binding = layer.bindings.find((entry) => entry.targetProperty === property);
  const keys = layer.animationTracks[property];
  return (
    <Row label={label}>
      <div className="modifier-number-control">
        <input
          type="number"
          aria-label={`${modifier.name}: ${label}`}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber))
              act(() =>
                setModifierNumber(layer.id, modifier.id, parameter, event.target.valueAsNumber),
              );
          }}
          onBlur={() => setDraft(display)}
        />
        <button
          type="button"
          className={keys?.length ? 'is-linked' : undefined}
          aria-label={`Animate ${label}`}
          title="Select this property in the Timeline; Auto-keyframe also applies to numeric edits."
          onClick={() => {
            useSelectionStore.getState().selectLayerProperty(layer.id, property);
            usePaneRequestStore.getState().reveal('timeline');
          }}
        >
          ◇
        </button>
        <button
          type="button"
          className={binding ? 'is-linked' : undefined}
          aria-label={`Create data control for ${label}`}
          title={
            binding ? 'Data binding exists — open Data' : 'Create a Data field and bind this value'
          }
          onClick={() =>
            act(() => {
              exposeModifierNumber(layer.id, modifier.id, parameter);
              usePaneRequestStore.getState().reveal('data');
            })
          }
        >
          ↗
        </button>
      </div>
    </Row>
  );
}

function ModifierControls({
  layer,
  modifier,
  composition,
  act,
}: {
  layer: Layer;
  modifier: LayerModifier;
  composition: Composition;
  act: (mutation: () => void) => void;
}) {
  const patch = (params: Record<string, unknown>) =>
    act(() => editLayerModifier(layer.id, modifier.id, { params }));
  const number = (parameter: string, label: string) => (
    <ModifierNumber
      key={parameter}
      layer={layer}
      modifier={modifier}
      parameter={parameter}
      label={label}
      act={act}
    />
  );
  const checkbox = (parameter: string, label: string, value: boolean) => (
    <label className="modifier-check">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => patch({ [parameter]: event.target.checked })}
      />
      {label}
    </label>
  );
  const geometry = (value: GeometryReference, parameter = 'source', exclude = layer.id) => (
    <ModifierReferencePicker
      label={parameter === 'source' ? 'Reference object or group' : 'Object or group to hide'}
      value={referenceValue(value)}
      options={modifierGeometryOptions(composition, exclude)}
      onChange={(value) => patch({ [parameter]: geometryReference(value) })}
    />
  );
  const choice = <Value extends string>(
    parameter: string,
    label: string,
    value: Value,
    options: Record<Value, string>,
  ) => (
    <Row label={label}>
      <select
        aria-label={`${modifier.name}: ${label}`}
        value={value}
        onChange={(event) => patch({ [parameter]: event.target.value })}
      >
        {Object.entries<string>(options).map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </Row>
  );
  const childCount = composition.layers.filter((entry) => entry.parentId === layer.id).length;
  const childrenNote = (
    <p className="modifier-muted">
      {childCount
        ? `Uses ${childCount} child object${childCount === 1 ? '' : 's'} in Scene order; hidden children are skipped and their own children move with them.`
        : 'This object has no child objects yet. Parent objects to it in the Scene Outliner.'}
    </p>
  );
  const advanced = (children: ReactNode) => (
    <details className="modifier-advanced">
      <summary>Advanced</summary>
      {children}
    </details>
  );
  switch (modifier.type) {
    case 'max-text-width':
      return (
        <>
          {number('maxWidth', 'Max Width')}
          <Row label="Fit">
            <select
              aria-label="Text fitting mode"
              value={modifier.params.mode}
              onChange={(event) => patch({ mode: event.target.value })}
            >
              <option value="squeeze">Squeeze horizontally</option>
              <option value="shrink">Shrink proportionally</option>
            </select>
          </Row>
          {advanced(number('minFontSize', 'Min Font Size'))}
        </>
      );
    case 'auto-size':
      return (
        <>
          <Row label="Fit around">{geometry(modifier.params.source)}</Row>
          <Row label="Resize">
            <div className="modifier-inline">
              {checkbox('width', 'Width', modifier.params.width)}
              {checkbox('height', 'Height', modifier.params.height)}
            </div>
          </Row>
          {number('paddingLeft', 'Padding Left')}
          {number('paddingRight', 'Padding Right')}
          {number('paddingTop', 'Padding Top')}
          {number('paddingBottom', 'Padding Bottom')}
          {advanced(
            <>
              <p className="modifier-muted">
                Anchor 0 = left/top, 0.5 = center, 1 = right/bottom. Size limits: 0 = off.
              </p>
              {number('anchorX', 'Anchor X')}
              {number('anchorY', 'Anchor Y')}
              {number('minWidth', 'Min Width')}
              {number('maxWidth', 'Max Width')}
              {number('minHeight', 'Min Height')}
              {number('maxHeight', 'Max Height')}
            </>,
          )}
        </>
      );
    case 'auto-follow':
      return (
        <>
          <Row label="Follow">{geometry(modifier.params.source)}</Row>
          <Row label="Attach">
            <select
              aria-label="Follow attachment"
              value={
                Object.entries(FOLLOW_ATTACHMENTS).find(([, values]) =>
                  Object.entries(values).every(
                    ([key, value]) => modifier.params[key as keyof typeof values] === value,
                  ),
                )?.[0] ?? 'Custom'
              }
              onChange={(event) => {
                const attachment =
                  FOLLOW_ATTACHMENTS[event.target.value as keyof typeof FOLLOW_ATTACHMENTS];
                if (attachment) patch(attachment);
              }}
            >
              <option value="Custom">Custom anchors</option>
              {Object.keys(FOLLOW_ATTACHMENTS).map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Axes">
            <div className="modifier-inline">
              {checkbox('axisX', 'Horizontal', modifier.params.axisX)}
              {checkbox('axisY', 'Vertical', modifier.params.axisY)}
            </div>
          </Row>
          {number('offsetX', 'Offset X')}
          {number('offsetY', 'Offset Y')}
          {advanced(
            <>
              <p className="modifier-muted">Anchor 0 = left/top, 0.5 = center, 1 = right/bottom.</p>
              {number('sourceAnchorX', 'Source X')}
              {number('sourceAnchorY', 'Source Y')}
              {number('targetAnchorX', 'Object X')}
              {number('targetAnchorY', 'Object Y')}
            </>,
          )}
        </>
      );
    case 'hide-empty':
      return (
        <>
          <Row label="Read">
            <ModifierReferencePicker
              label="Text, image or Data source"
              value={sourceValue(modifier.params.source)}
              options={sourceOptions(composition)}
              onChange={(value) => patch({ source: valueSource(value, composition) })}
            />
          </Row>
          <Row label="Hide">
            <ModifierReferencePicker
              label="Object or group to hide"
              value={modifier.params.target ? referenceValue(modifier.params.target) : ''}
              options={[
                { value: '', label: `This object: ${layer.name}` },
                ...modifierGeometryOptions(composition).filter(
                  (option) => option.value !== `layer:${layer.id}`,
                ),
              ]}
              onChange={(value) => patch({ target: value ? geometryReference(value) : undefined })}
            />
          </Row>
          <Row label="Empty value">
            <div className="modifier-inline">
              {checkbox('trimWhitespace', 'Trim spaces', modifier.params.trimWhitespace)}
              {checkbox('invert', 'Invert', modifier.params.invert)}
            </div>
          </Row>
          {modifier.params.source.kind === 'field' &&
            advanced(
              <Row label="Value path">
                <ModifierSourcePath
                  source={modifier.params.source}
                  onChange={(source) => patch({ source })}
                />
              </Row>,
            )}
          <p className="modifier-muted">
            Hidden objects are excluded from layouts with “Collapse hidden” enabled.
          </p>
        </>
      );
    case 'grid-arrange':
      return (
        <>
          {childrenNote}
          {number('columns', 'Columns')}
          {number('rows', 'Rows')}
          {number('spreadX', 'Spread X')}
          {number('spreadY', 'Spread Y')}
          {choice('startCorner', 'Start corner', modifier.params.startCorner, GRID_CORNERS)}
          {choice('direction', 'Fill', modifier.params.direction, {
            horizontal: 'Across rows first',
            vertical: 'Down columns first',
          })}
          <p className="modifier-muted">
            Rows 0 = as many as needed. Spread is the distance between neighbouring cells; children
            beyond Columns × Rows are hidden.
          </p>
        </>
      );
    case 'radial-arrange':
      return (
        <>
          {childrenNote}
          {number('count', 'Count')}
          {number('innerRadius', 'Inner Radius')}
          {number('startAngle', 'Start Angle')}
          {number('endAngle', 'End Angle')}
          <Row label="Orient">
            <div className="modifier-inline">
              {checkbox('orient', 'Point outward', modifier.params.orient)}
            </div>
          </Row>
          {number('baseRotation', 'Base Rotation')}
          {advanced(
            <>
              <p className="modifier-muted">
                Count 0 = every visible child. Angles: 0° = right, 90° = down. Rings spread items
                from Inner to Outer Radius.
              </p>
              {number('rings', 'Rings')}
              {number('outerRadius', 'Outer Radius')}
              {choice('arrangement', 'Arrangement', modifier.params.arrangement, {
                equal: 'Equal per ring',
                radiate: 'Radiate (spokes)',
              })}
              <Row label="Rings">
                <div className="modifier-inline">
                  {checkbox('startFromOuter', 'Start from outer', modifier.params.startFromOuter)}
                </div>
              </Row>
            </>,
          )}
        </>
      );
    case 'justify':
      return (
        <>
          {childrenNote}
          {choice('horizontal', 'Horizontal', modifier.params.horizontal, {
            none: 'None',
            left: 'Left',
            center: 'Center',
            right: 'Right',
          })}
          {choice('vertical', 'Vertical', modifier.params.vertical, {
            none: 'None',
            top: 'Top',
            center: 'Center',
            bottom: 'Bottom',
          })}
          {number('offsetX', 'Offset X')}
          {number('offsetY', 'Offset Y')}
          <p className="modifier-muted">
            Place Justify below Grid or Radial Arrange to re-center the arrangement when children
            are hidden.
          </p>
        </>
      );
    case 'look-at':
      return (
        <>
          <Row label="Look at">{geometry(modifier.params.source)}</Row>
          {choice('axis', 'Facing side', modifier.params.axis, {
            x: 'Right side (X axis)',
            y: 'Bottom side (Y axis)',
          })}
          <Row label="Flip">
            <div className="modifier-inline">
              {checkbox('flip', 'Face away', modifier.params.flip)}
            </div>
          </Row>
          {number('rotationOffset', 'Rotation Offset')}
          <p className="modifier-muted">
            Rotates around this object’s transform origin toward the reference’s center.
          </p>
        </>
      );
  }
}

/** The Motion Path link presented as the Spline Path modifier (Unreal Motion Design naming). */
function SplinePathCard({
  layer,
  composition,
  act,
}: {
  layer: Layer;
  composition: Composition;
  act: (mutation: () => void) => void;
}) {
  const link = layer.motionPath!;
  const setLink = useProjectStore((state) => state.setLayerMotionPath);
  const frame = useTimelineStore((state) => state.currentFrame);
  const keys = layer.animationTracks.motionPathProgress;
  const progress = getLayerPropertyValueAtFrame(layer, 'motionPathProgress', frame);
  const update = (patch: Partial<NonNullable<Layer['motionPath']>>) =>
    act(() => setLink(layer.id, { ...link, ...patch }));
  const numeric = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    limits: { min?: number; max?: number; step?: number; disabled?: boolean } = {},
  ) => (
    <Row label={label}>
      <input
        type="number"
        aria-label={`Spline Path: ${label}`}
        value={Number(value.toFixed(4))}
        min={limits.min}
        max={limits.max}
        step={limits.step ?? 1}
        disabled={limits.disabled}
        onChange={(event) => {
          if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber))
            onChange(event.target.valueAsNumber);
        }}
      />
    </Row>
  );
  return (
    <CollapsibleSection
      sectionId={`modifier-spline-path-${layer.id}`}
      title="Spline Path"
      className="modifier-card"
      actions={
        <div className="modifier-card-actions">
          <button
            type="button"
            title="Select Progress in the Timeline"
            aria-label="Animate Spline Path progress"
            className={keys?.length ? 'is-linked' : undefined}
            onClick={() => {
              useSelectionStore.getState().selectLayerProperty(layer.id, 'motionPathProgress');
              usePaneRequestStore.getState().reveal('timeline');
            }}
          >
            ◇
          </button>
          <button
            type="button"
            title="Remove"
            aria-label="Remove Spline Path"
            onClick={() => act(() => setLink(layer.id, null))}
          >
            ×
          </button>
        </div>
      }
    >
      <Row label="Path">
        <ModifierReferencePicker
          label="Spline path layer"
          value={link.sourceLayerId}
          options={pathOptions(composition, layer.id)}
          onChange={(value) => update({ sourceLayerId: value })}
        />
      </Row>
      {numeric(
        'Progress %',
        (keys?.length ? progress : link.progress) * 100,
        (value) => update({ progress: Math.max(0, Math.min(1, value / 100)) }),
        { min: 0, max: 100, step: 0.1, disabled: Boolean(keys?.length) },
      )}
      {keys?.length ? (
        <p className="modifier-muted">Progress is animated; edit its keys in the Timeline.</p>
      ) : null}
      <Row label="Orient">
        <label className="modifier-check">
          <input
            type="checkbox"
            checked={link.orientToPath}
            onChange={(event) => update({ orientToPath: event.target.checked })}
          />
          Follow path direction
        </label>
      </Row>
      {numeric(
        'Base Orientation',
        link.rotationOffset ?? 0,
        (value) => update({ rotationOffset: Math.max(-360, Math.min(360, value)) }),
        { min: -360, max: 360 },
      )}
      {numeric('Offset X', link.offsetX, (value) => update({ offsetX: value }))}
      {numeric('Offset Y', link.offsetY, (value) => update({ offsetY: value }))}
    </CollapsibleSection>
  );
}
function pathOptions(composition: Composition, excludeLayerId: string): PickOption[] {
  return composition.layers
    .filter((entry) => entry.id !== excludeLayerId && entry.element.type === 'path')
    .map((entry) => ({ value: entry.id, label: entry.name, detail: 'path' }));
}

type StarterType = 'auto-size' | 'hide-empty' | 'auto-follow' | 'grid-arrange';

/** Beginner-friendly entry points keep the normal, validated modifier implementation. */
function ModifierStarters({
  layer,
  composition,
  act,
}: {
  layer: Layer;
  composition: Composition;
  act: (mutation: () => void) => void;
}) {
  const [selected, setSelected] = useState<StarterType | null>(null);
  const [source, setSource] = useState('');
  const geometry = modifierGeometryOptions(composition, layer.id);
  const sources = sourceOptions(composition);
  const choices = selected === 'hide-empty' ? sources : geometry;
  const cards: Array<{ type: StarterType; label: string; description: string }> = [
    {
      type: 'auto-size',
      label: 'Panel follows text width',
      description: 'Fit the selected panel to a text object.',
    },
    {
      type: 'hide-empty',
      label: 'Hide when empty',
      description: 'Hide this object when text or data is empty.',
    },
    {
      type: 'auto-follow',
      label: 'Follow another layer',
      description: 'Keep this object attached to another object.',
    },
    {
      type: 'grid-arrange',
      label: 'Arrange in a row or grid',
      description: 'Arrange the selected container’s children.',
    },
  ];
  const choose = (type: StarterType) => {
    setSelected(type);
    if (type === 'grid-arrange') {
      setSource('');
      return;
    }
    const candidate =
      type === 'hide-empty'
        ? (sources.find((option) => option.value === `layer:${layer.id}`) ?? sources[0])
        : type === 'auto-size'
          ? (geometry.find((option) => option.detail === 'text') ?? geometry[0])
          : geometry[0];
    setSource(candidate?.value ?? '');
  };
  const add = () => {
    if (!selected || layer.isLocked) return;
    act(() => {
      if (selected === 'grid-arrange') {
        addModifier(
          layer.id,
          'grid-arrange',
          containerModifierDefaults(
            'grid-arrange',
            layer,
            composition,
            useTimelineStore.getState().currentFrame,
          ),
        );
      } else if (selected === 'hide-empty') {
        if (!source) throw new Error('Choose text, an image or a data field first.');
        addModifier(layer.id, 'hide-empty', { source: valueSource(source, composition) });
      } else {
        if (!source) throw new Error('Choose another object or group first.');
        const reference = geometryReference(source);
        if (selected === 'auto-size')
          addModifier(layer.id, 'auto-size', { source: reference, height: false });
        else addModifier(layer.id, 'auto-follow', { source: reference });
      }
      setSelected(null);
    });
  };
  return (
    <div className="modifier-starters">
      <p className="modifier-muted">Choose a starting point for this object.</p>
      <div className="modifier-starter-grid">
        {cards.map((card) => (
          <button
            key={card.type}
            type="button"
            className="modifier-starter"
            disabled={layer.isLocked}
            aria-pressed={selected === card.type}
            onClick={() => choose(card.type)}
          >
            <strong>{card.label}</strong>
            <span>{card.description}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="modifier-starter-setup">
          {selected === 'grid-arrange' ? (
            <p className="modifier-muted">
              Uses this object’s child layers. Add children first if needed.
            </p>
          ) : (
            <ModifierReferencePicker
              label="Starter source"
              value={source}
              options={choices}
              onChange={setSource}
            />
          )}
          <button type="button" disabled={selected !== 'grid-arrange' && !source} onClick={add}>
            Add {cards.find((card) => card.type === selected)?.label}
          </button>
        </div>
      )}
    </div>
  );
}

function AddModifier({
  layer,
  composition,
  act,
}: {
  layer: Layer;
  composition: Composition;
  act: (mutation: () => void) => void;
}) {
  const [type, setType] = useState<AddableType>(
    layer.element.type === 'text' ? 'max-text-width' : 'auto-size',
  );
  const [source, setSource] = useState('');
  const [open, setOpen] = useState(false);
  const isGeometry = type === 'auto-size' || type === 'auto-follow' || type === 'look-at';
  const isContainer = type !== SPLINE_PATH && CONTAINER_TYPES.includes(type);
  const ownValue = ['text', 'image'].includes(layer.element.type) ? `layer:${layer.id}` : '';
  const resolvedSource = source || (!isGeometry && type === 'hide-empty' ? ownValue : '');
  const ready =
    type === 'max-text-width'
      ? layer.element.type === 'text'
      : type === SPLINE_PATH
        ? Boolean(source) && !layer.motionPath
        : isContainer || Boolean(resolvedSource);
  return (
    <div className="modifier-add">
      <button
        type="button"
        disabled={layer.isLocked}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        + Add Modifier
      </button>
      {open && (
        <div className="modifier-add-body">
          <select
            aria-label="Modifier type"
            value={type}
            onChange={(event) => {
              setType(event.target.value as AddableType);
              setSource('');
            }}
          >
            {Object.entries(LABELS).map(([value, label]) => (
              <option
                key={value}
                value={value}
                disabled={value === 'max-text-width' && layer.element.type !== 'text'}
              >
                {label}
              </option>
            ))}
            <option value={SPLINE_PATH} disabled={Boolean(layer.motionPath)}>
              Spline Path
            </option>
          </select>
          <p className="modifier-muted">
            {type === SPLINE_PATH ? SPLINE_PATH_DESCRIPTION : DESCRIPTIONS[type]}
          </p>
          {type !== 'max-text-width' && !isContainer && (
            <ModifierReferencePicker
              label="New modifier source"
              value={resolvedSource}
              options={
                type === SPLINE_PATH
                  ? pathOptions(composition, layer.id)
                  : isGeometry
                    ? modifierGeometryOptions(composition, layer.id)
                    : sourceOptions(composition)
              }
              onChange={setSource}
            />
          )}
          {(isGeometry || type === SPLINE_PATH) && !resolvedSource && (
            <p className="modifier-muted">
              {type === SPLINE_PATH
                ? 'Draw or choose a path layer first; the object travels along it.'
                : 'Choose the object or group to reference before adding.'}
            </p>
          )}
          <button
            type="button"
            disabled={!ready}
            onClick={() =>
              act(() => {
                if (type === SPLINE_PATH) {
                  useProjectStore.getState().setLayerMotionPath(layer.id, {
                    sourceLayerId: source,
                    progress: 0,
                    orientToPath: true,
                    offsetX: 0,
                    offsetY: 0,
                    rotationOffset: 0,
                  });
                  setOpen(false);
                  return;
                }
                if (isContainer) {
                  addModifier(
                    layer.id,
                    type as LayerModifierType,
                    containerModifierDefaults(
                      type as LayerModifierType,
                      layer,
                      composition,
                      useTimelineStore.getState().currentFrame,
                    ),
                  );
                  setOpen(false);
                  return;
                }
                const params = isGeometry
                  ? { source: geometryReference(resolvedSource) }
                  : type === 'hide-empty'
                    ? { source: valueSource(resolvedSource, composition) }
                    : {
                        maxWidth: Math.max(
                          1,
                          getLayerPropertyValueAtFrame(
                            layer,
                            'width',
                            useTimelineStore.getState().currentFrame,
                          ),
                        ),
                      };
                addModifier(layer.id, type, params);
                setOpen(false);
              })
            }
          >
            Add {type === SPLINE_PATH ? 'Spline Path' : LABELS[type]}
          </button>
        </div>
      )}
    </div>
  );
}

export function ModifiersPanel() {
  const composition = useActiveComposition();
  const ids = useSelectionStore((state) => state.selectedLayerIds);
  const selectedId = useSelectionStore((state) => state.selectedLayerId);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const layer =
    ids.length === 1 ? composition.layers.find((entry) => entry.id === selectedId) : undefined;
  const act = (mutation: () => void) => {
    try {
      mutation();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const modifiers = layer?.modifiers ?? [];
  const driven = [
    ...modifierDrivenProperties(modifiers),
    ...(layer?.motionPath ? ['X/Y (Spline Path)'] : []),
  ];
  useEffect(() => setError(''), [layer?.id]);
  return (
    <Panel title="Smart layout">
      <div className="modifiers-pane">
        {!layer ? (
          <p className="modifier-empty">
            {ids.length > 1
              ? 'Select one object to edit its layout behaviors. Group references can control a complete group; behaviors are not attached to an arbitrary group member.'
              : 'Select an object to add responsive sizing, following, visibility or arrangement.'}
          </p>
        ) : (
          <>
            <div className="modifier-owner">
              <span>Selected object</span>
              <strong>{layer.name}</strong>
            </div>
            {layer.isLocked && (
              <p className="modifier-warning">
                This object is locked. Unlock it to edit modifiers.
              </p>
            )}
            <div className="modifier-toolbar">
              <input
                type="search"
                aria-label="Filter modifiers"
                value={filter}
                placeholder="Filter modifiers…"
                onChange={(event) => setFilter(event.target.value)}
              />
              <AddModifier key={layer.id} layer={layer} composition={composition} act={act} />
            </div>
            {driven.length > 0 && (
              <p className="modifier-driven">
                Driven: {driven.join(', ')}. Authored values are preserved when modifiers are
                disabled.
              </p>
            )}
            {error && (
              <p role="alert" className="modifier-error">
                {error}
              </p>
            )}
            <fieldset className="modifier-stack" disabled={layer.isLocked}>
              {modifiers.map((modifier, index) => {
                if (
                  !`${modifier.name} ${LABELS[modifier.type]} ${DESCRIPTIONS[modifier.type]}`
                    .toLowerCase()
                    .includes(filter.toLowerCase())
                )
                  return null;
                return (
                  <CollapsibleSection
                    key={modifier.id}
                    sectionId={`modifier-${modifier.id}`}
                    title={LABELS[modifier.type]}
                    className={`modifier-card${modifier.enabled ? '' : ' is-bypassed'}`}
                    actions={
                      <div className="modifier-card-actions">
                        <input
                          type="checkbox"
                          aria-label={`Enable ${modifier.name}`}
                          checked={modifier.enabled}
                          onChange={(event) =>
                            act(() =>
                              editLayerModifier(layer.id, modifier.id, {
                                enabled: event.target.checked,
                              }),
                            )
                          }
                        />
                        <button
                          type="button"
                          title="Move up"
                          aria-label={`Move ${modifier.name} up`}
                          disabled={index === 0}
                          onClick={() => act(() => moveModifier(layer.id, modifier.id, -1))}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="Move down"
                          aria-label={`Move ${modifier.name} down`}
                          disabled={index === modifiers.length - 1}
                          onClick={() => act(() => moveModifier(layer.id, modifier.id, 1))}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          title="Duplicate"
                          aria-label={`Duplicate ${modifier.name}`}
                          onClick={() =>
                            act(() => {
                              copyModifier(layer.id, modifier.id);
                            })
                          }
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          title="Reset settings and numeric animation; retain references"
                          aria-label={`Reset ${modifier.name}`}
                          onClick={() => act(() => resetModifier(layer.id, modifier.id))}
                        >
                          ↺
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          aria-label={`Remove ${modifier.name}`}
                          onClick={() => act(() => deleteModifier(layer.id, modifier.id))}
                        >
                          ×
                        </button>
                      </div>
                    }
                  >
                    <Row label="Name">
                      <input
                        aria-label="Modifier name"
                        value={modifier.name}
                        onChange={(event) =>
                          act(() =>
                            editLayerModifier(layer.id, modifier.id, { name: event.target.value }),
                          )
                        }
                      />
                    </Row>
                    <ModifierControls
                      layer={layer}
                      modifier={modifier}
                      composition={composition}
                      act={act}
                    />
                  </CollapsibleSection>
                );
              })}
            </fieldset>
            {layer.motionPath && 'spline path motion path'.includes(filter.toLowerCase()) && (
              <fieldset className="modifier-stack" disabled={layer.isLocked}>
                <SplinePathCard layer={layer} composition={composition} act={act} />
              </fieldset>
            )}
            {!modifiers.length && !layer.motionPath && (
              <ModifierStarters key={layer.id} layer={layer} composition={composition} act={act} />
            )}
            {modifiers.length > 0 &&
              !modifiers.some((modifier) =>
                `${modifier.name} ${LABELS[modifier.type]} ${DESCRIPTIONS[modifier.type]}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              ) && <p className="modifier-empty">No matching modifiers.</p>}
          </>
        )}
      </div>
    </Panel>
  );
}
