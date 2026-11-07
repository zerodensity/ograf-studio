import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useMovableDialog } from '../components/useMovableDialog';
import { ColorInput } from '../components/ColorInput';
import {
  addEffect,
  updateEffect,
  removeEffect,
  getEffectStack,
  effectEnabled,
  effectParams,
  EFFECT_CATALOG,
  EFFECT_TYPES,
  EFFECT_BLEND_MODES,
  getElementFill,
  getLayerTransformAtFrame,
  computeKeyframeFrames,
  getTotalFrames,
  normalizeCanvasCrop,
  valueAtSourcePath,
  isGradientPaint,
  createCornerRadii,
  type ComponentDefinition,
  type Composition,
  type Element,
  type FieldDefinition,
  type FieldValue,
  type Layer,
  type LayerTransform,
  type EffectType,
  type EffectPatch,
  type EffectBlendMode,
  type Paint,
} from '@ograf-editor/scene-model';
import {
  EditorWindowContext,
  isDomElement,
  useEditorWindow,
  type EditorWindow,
} from '../layout/EditorWindow';
import { useProjectStore } from '../state/projectStore';
import { revealPaneOnFirstUse } from '../state/firstUsePanes';
import { useCropToolStore } from '../state/cropToolStore';
import { captureAgentPng } from '../state/agentCapture';
import { openShaderResourceEditor } from '../state/shaderEditorRequest';
import { PaintEditor } from './PaintEditor';
import { FONT_OPTIONS } from './fontOptions';
import { ClockTimerEditor } from './ClockTimerEditor';
import './ComponentEditorDialog.css';

export interface ComponentEditorTarget {
  compositionId: string;
  componentId: string;
  sourceLayerId?: string;
}
interface ComponentEditorRequest extends ComponentEditorTarget {
  projectId: string;
  owner: EditorWindow;
}
let request: ComponentEditorRequest | null = null;
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function closeComponentEditor() {
  request = null;
  notify();
}
export function openComponentEditor(target: ComponentEditorTarget, ownerDocument = document) {
  const owner = ownerDocument.defaultView as EditorWindow | null;
  if (!owner || owner.closed) return;
  revealPaneOnFirstUse('scene-tree');
  request = { ...target, projectId: useProjectStore.getState().project.id, owner };
  notify();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function previewComposition(
  composition: Composition,
  component: ComponentDefinition,
  frame: number,
): Composition {
  const source = { ...composition, ...component.context };
  const poses = component.layers
    .filter((layer) => layer.isVisible && !layer.isMaskOnly)
    .map((layer) => getLayerTransformAtFrame(layer, frame));
  const left = Math.max(0, Math.min(...poses.map((pose) => pose.x)) - 32);
  const top = Math.max(0, Math.min(...poses.map((pose) => pose.y)) - 32);
  const right = Math.max(1, Math.max(...poses.map((pose) => pose.x + pose.width)) + 32);
  const bottom = Math.max(1, Math.max(...poses.map((pose) => pose.y + pose.height)) + 32);
  const width = poses.length ? Math.max(source.width, Math.ceil(right)) : source.width;
  const height = poses.length ? Math.max(source.height, Math.ceil(bottom)) : source.height;
  return {
    ...source,
    width,
    height,
    layers: component.layers,
    dataFields: component.dataFields,
    assets: [
      ...new Map(
        [...composition.assets, ...(component.resources ?? [])].map((asset) => [asset.id, asset]),
      ).values(),
    ],
    patterns: [
      ...new Map(
        [...composition.patterns, ...(component.patterns ?? [])].map((pattern) => [
          pattern.id,
          pattern,
        ]),
      ).values(),
    ],
    components: [],
    runtimeCollections: [],
    mediaCues: component.context?.mediaCues ?? [],
    backgroundColor: 'transparent',
    backgroundPaint: undefined,
    crop: poses.length
      ? normalizeCanvasCrop(
          { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
          width,
          height,
        )
      : undefined,
  };
}

function ComponentPreview({
  composition,
  component,
  frame,
}: {
  composition: Composition;
  component: ComponentDefinition;
  frame: number;
}) {
  const project = useProjectStore((state) => state.project);
  const { window } = useEditorWindow();
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const timer = window.setTimeout(() => {
      const isolated = previewComposition(composition, component, frame);
      void captureAgentPng({
        target: 'composition',
        project: { ...project, mainCompositionId: isolated.id, compositions: [isolated] },
        compositionId: isolated.id,
        frame,
        maxDimension: 720,
        matte: 'checker',
      }).then(
        (result) => {
          if (current === generation.current) {
            setImage(`data:image/png;base64,${result.data}`);
            setError('');
          }
        },
        (cause: unknown) => {
          if (current === generation.current)
            setError(
              cause instanceof Error ? cause.message : 'The component preview could not render.',
            );
        },
      );
    }, 180);
    return () => {
      generation.current += 1;
      window.clearTimeout(timer);
    };
  }, [project, composition, component, frame, window]);
  return (
    <div className="component-editor-preview" aria-label="Component source preview">
      {image ? (
        <img src={image} alt="Preview of the component source" />
      ) : (
        <span>Preparing preview…</span>
      )}
      {error && <p role="status">{error}</p>}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}) {
  if (field.type === 'object') {
    const record: Record<string, FieldValue> =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, FieldValue>)
        : {};
    return (
      <fieldset className="component-field-object">
        <legend>{field.label || field.key}</legend>
        {field.properties.map((child) => (
          <FieldControl
            key={child.id}
            field={child}
            value={record[child.key] ?? child.defaultValue}
            onChange={(next) => onChange({ ...record, [child.key]: next })}
          />
        ))}
      </fieldset>
    );
  }
  if (field.type === 'array')
    return (
      <p className="component-editor-hint">
        {field.label || field.key}: {Array.isArray(value) ? value.length : 0} collection items
      </p>
    );
  if (field.type === 'boolean')
    return (
      <label className="component-field-checkbox">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        {field.label || field.key}
      </label>
    );
  if (field.type === 'gradient')
    return (
      <div>
        <p className="component-editor-hint">{field.label || field.key}</p>
        <PaintEditor
          value={isGradientPaint(value) ? value : undefined}
          allowShader={false}
          allowMedia={false}
          onChange={(next) => {
            if (next && isGradientPaint(next)) onChange(next);
          }}
        />
      </div>
    );
  if (field.type === 'select-multiple') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="component-field-object">
        <legend>{field.label || field.key}</legend>
        {field.options.map((option) => (
          <label className="component-field-checkbox" key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.currentTarget.checked
                    ? [...selected, option.value]
                    : selected.filter((item) => item !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    );
  }
  if (
    field.type === 'number' ||
    field.type === 'integer' ||
    field.type === 'duration-ms' ||
    field.type === 'percentage'
  )
    return (
      <label>
        {field.label || field.key}
        <input
          type="number"
          value={Number(value ?? 0)}
          min={field.constraints.minimum}
          max={field.constraints.maximum}
          step={field.constraints.step ?? (field.type === 'integer' ? 1 : 'any')}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onChange(field.type === 'integer' ? Math.round(next) : next);
          }}
        />
      </label>
    );
  if (field.type === 'select')
    return (
      <label>
        {field.label || field.key}
        <select
          value={String(value ?? '')}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  if (field.type === 'textarea')
    return (
      <label>
        {field.label || field.key}
        <textarea
          value={String(value ?? '')}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    );
  if (field.type === 'color')
    return (
      <label>
        {field.label || field.key}
        <ColorInput
          label={field.label || field.key}
          value={String(value ?? '')}
          alpha={field.generatedShaderParameter?.glslType === 'vec4'}
          onChange={onChange}
        />
      </label>
    );
  const text = String(value ?? '');
  return (
    <label>
      {field.label || field.key}
      <input type="text" value={text} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function SourceEffects({
  layer,
  onChange,
  onEditShader,
}: {
  layer: Layer;
  onChange: (patch: Partial<Omit<Layer, 'id' | 'componentLink'>>) => void;
  onEditShader: (effectId: string) => void;
}) {
  const [type, setType] = useState<EffectType>('glow');
  const [error, setError] = useState('');
  const effects = getEffectStack(layer.effects);
  const run = (change: (copy: Layer) => void) => {
    try {
      const copy = structuredClone(layer);
      change(copy);
      onChange({
        effects: copy.effects,
        animationTracks: copy.animationTracks,
        loop: copy.loop,
        bindings: copy.bindings,
        designTokenBindings: copy.designTokenBindings,
      });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The source effect could not be changed.');
    }
  };
  const update = (effectId: string, patch: EffectPatch) =>
    run((copy) => {
      updateEffect(copy, effectId, patch);
    });
  return (
    <section className="component-source-effects">
      <h3>Source effects</h3>
      <div className="component-editor-actions">
        <select
          aria-label="Component effect type"
          value={type}
          onChange={(event) => setType(event.currentTarget.value as EffectType)}
        >
          {EFFECT_TYPES.filter(
            (candidate) =>
              candidate !== 'backdrop-blur' ||
              layer.element.type === 'rectangle' ||
              layer.element.type === 'ellipse',
          ).map((candidate) => (
            <option key={candidate} value={candidate}>
              {EFFECT_CATALOG[candidate].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            run((copy) => {
              addEffect(copy, type, { blendMode: 'normal' });
            })
          }
        >
          Add effect
        </button>
      </div>
      {effects
        .filter(
          (effect) =>
            !effect.legacy ||
            (effect.legacy === 'blur'
              ? layer.effects.blur > 0
              : effectEnabled(effect, layer.effects)),
        )
        .map((effect) => (
          <div key={effect.id} className="component-source-effect">
            <div className="component-editor-actions">
              <label className="component-field-checkbox">
                <input
                  type="checkbox"
                  checked={effectEnabled(effect, layer.effects)}
                  onChange={(event) => update(effect.id, { enabled: event.currentTarget.checked })}
                />
                {effect.name}
              </label>
              <button
                type="button"
                aria-label={`Remove source effect ${effect.name}`}
                onClick={() =>
                  run((copy) => {
                    removeEffect(copy, effect.id);
                  })
                }
              >
                Remove
              </button>
            </div>
            <label>
              Blend
              <select
                value={effect.blendMode ?? 'normal'}
                onChange={(event) =>
                  update(effect.id, { blendMode: event.currentTarget.value as EffectBlendMode })
                }
              >
                {EFFECT_BLEND_MODES.filter(
                  (mode) => effect.type !== 'backdrop-blur' || mode === 'normal',
                ).map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === 'add' ? 'Add' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {effect.type === 'backdrop-blur' ? 'Blur amount %' : 'Effect opacity %'}
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round((effect.blendOpacity ?? 1) * 100)}
                onChange={(event) =>
                  update(effect.id, {
                    blendOpacity: Math.max(0, Math.min(1, Number(event.currentTarget.value) / 100)),
                  })
                }
              />
            </label>
            {Object.entries(EFFECT_CATALOG[effect.type].params).map(([key, spec]) => (
              <label key={key}>
                {spec.label}
                <input
                  aria-label={`${effect.name} ${spec.label}`}
                  type={typeof spec.default === 'number' ? 'number' : 'color'}
                  value={effectParams(effect, layer.effects)[key] ?? spec.default}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step ?? 'any'}
                  onChange={(event) =>
                    update(effect.id, {
                      params: {
                        [key]:
                          typeof spec.default === 'number'
                            ? Number(event.currentTarget.value)
                            : event.currentTarget.value,
                      },
                    })
                  }
                />
              </label>
            ))}
            {effect.type === 'shader' && (
              <button type="button" onClick={() => onEditShader(effect.id)}>
                Edit effect shader…
              </button>
            )}
          </div>
        ))}
      {error && (
        <p className="component-editor-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ComponentEditorDialog({
  target,
  composition,
  component,
}: {
  target: ComponentEditorRequest;
  composition: Composition;
  component: ComponentDefinition;
}) {
  const { document, window: ownerWindow } = useEditorWindow();
  const dialog = useRef<HTMLDialogElement>(null);
  const move = useMovableDialog(dialog);
  const croppingSource = useCropToolStore((state) => state.request?.kind === 'source');
  const sourceComposition = useMemo(
    () => ({ ...composition, ...component.context }),
    [composition, component.context],
  );
  const totalFrames = getTotalFrames(sourceComposition);
  const [selectedId, setSelectedId] = useState(
    target.sourceLayerId ?? component.layers[0]?.id ?? '',
  );
  const [frame, setFrame] = useState(
    () =>
      computeKeyframeFrames(sourceComposition).find(
        (item) =>
          sourceComposition.keyframes.find((key) => key.id === item.keyframeId)?.role === 'step',
      )?.frame ?? 0,
  );
  const [error, setError] = useState('');
  useEffect(() => setFrame((current) => Math.min(totalFrames, current)), [totalFrames]);
  const layer = component.layers.find((item) => item.id === selectedId) ?? component.layers[0];
  const updateLayer = useProjectStore((state) => state.updateComponentLayer);
  const updateField = useProjectStore((state) => state.updateComponentField);
  const rename = useProjectStore((state) => state.renameComponent);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current!;
    return () => {
      node.close();
      if (isDomElement(previous) && previous.isConnected) previous.focus();
    };
  }, [document]);
  useEffect(() => {
    const node = dialog.current!;
    // Keep the editor mounted while releasing the modal top layer for canvas crop handles.
    if (croppingSource) node.close();
    else if (!node.open) node.showModal();
  }, [croppingSource, document]);
  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The component source could not be changed.',
      );
    }
  };
  const editLayer = (patch: Partial<Omit<Layer, 'id' | 'componentLink'>>) => {
    if (layer) run(() => updateLayer(component.id, layer.id, patch));
  };
  const editElement = (patch: Partial<Element>) => {
    if (layer) editLayer({ element: { ...layer.element, ...patch } as Element });
  };
  const editPaint = (paint: Paint | undefined) => {
    if (!layer) return;
    const next = { ...layer.element };
    if (next.type === 'text') {
      if (paint === undefined) next.fill = undefined;
      else {
        next.fill = paint;
        if (typeof paint === 'string') next.color = paint;
      }
    } else if (next.type === 'image' || next.type === 'image-sequence' || next.type === 'lottie') {
      if (paint === undefined || typeof paint === 'string') next.fill = undefined;
      else Object.assign(next, { fill: paint });
    } else if ('fill' in next && paint !== undefined) {
      Object.assign(next, { fill: paint });
    }
    editLayer({ element: next });
  };
  const setDimension = (property: keyof LayerTransform, value: number) => {
    if (!layer || !Number.isFinite(value)) return;
    const delta = value - getLayerTransformAtFrame(layer, frame)[property];
    const clamp = (next: number) =>
      property === 'width' || property === 'height'
        ? Math.max(1, next)
        : property === 'opacity'
          ? Math.min(1, Math.max(0, next))
          : next;
    editLayer({
      keyframes: layer.keyframes.map((key) => ({
        ...key,
        transform: { ...key.transform, [property]: clamp(key.transform[property] + delta) },
      })),
      animationTracks: {
        ...layer.animationTracks,
        ...(layer.animationTracks[property]?.length
          ? {
              [property]: layer.animationTracks[property]!.map((key) => ({
                ...key,
                value: clamp(key.value + delta),
              })),
            }
          : {}),
      },
    });
  };
  const contentBinding = layer?.bindings.find((binding) => binding.targetProperty === 'content');
  const selectedImageSource = layer?.element.type === 'image' ? layer.element.src : null;
  const contentField = component.dataFields.find((field) => field.id === contentBinding?.fieldId);
  const textContent =
    layer?.element.type === 'text'
      ? String(
          contentField
            ? (valueAtSourcePath(contentField.defaultValue, contentBinding?.sourcePath) ??
                layer.element.content)
            : layer.element.content,
        )
      : '';
  const editText = (content: string) => {
    if (!layer || layer.element.type !== 'text') return;
    const element = layer.element;
    run(() => {
      updateLayer(component.id, layer.id, { element: { ...element, content, runs: [] } });
    });
  };
  const editShader = (slot: 'fill' | 'stroke' | 'effect', effectId?: string) => {
    if (!layer) return;
    if (slot === 'effect' && !effectId) {
      setError('Choose an effect shader to edit.');
      return;
    }
    const scope = {
      compositionId: composition.id,
      componentId: component.id,
      layerId: layer.id,
    };
    openShaderResourceEditor(
      slot === 'effect' ? { ...scope, slot: 'effect', effectId: effectId! } : { ...scope, slot },
      ownerWindow,
    );
  };
  const fontOptions = useMemo(
    () => [
      ...new Set([
        ...(layer?.element.type === 'text' ? [layer.element.fontFamily] : []),
        ...FONT_OPTIONS.map((font) => font.value),
        ...[...composition.assets, ...(component.resources ?? [])]
          .filter((asset) => asset.kind === 'font' && asset.fontFamily)
          .map((asset) => asset.fontFamily!),
      ]),
    ],
    [layer, composition.assets, component.resources],
  );
  return createPortal(
    <dialog
      ref={dialog}
      className="component-editor-dialog"
      {...move.dialogProps}
      aria-labelledby="component-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        closeComponentEditor();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header {...move.handleProps}>
        <div>
          <p className="component-editor-breadcrumb">
            {component.scope === 'set' ? 'Template Set' : 'Template'} / Resources / Components /
            Source
          </p>
          <h2 id="component-editor-title">Edit component</h2>
          <p>Source changes update linked instances. Their local overrides stay intact.</p>
        </div>
        <button type="button" aria-label="Close component editor" onClick={closeComponentEditor}>
          ×
        </button>
      </header>
      <label className="component-editor-name">
        Component name
        <input
          value={component.name}
          onChange={(event) => run(() => rename(component.id, event.currentTarget.value))}
        />
      </label>
      <div className="component-editor-body">
        <aside>
          <h3>Master layers</h3>
          {component.layers.map((child) => (
            <button
              key={child.id}
              type="button"
              className={child.id === layer?.id ? 'is-selected' : ''}
              onClick={() => setSelectedId(child.id)}
            >
              <span>{child.name}</span>
              <small>{child.element.type}</small>
            </button>
          ))}
        </aside>
        <div className="component-editor-work">
          <ComponentPreview composition={sourceComposition} component={component} frame={frame} />
          <label className="component-preview-frame">
            Preview frame
            <input
              type="range"
              min={0}
              max={getTotalFrames(sourceComposition)}
              step={1}
              value={frame}
              onChange={(event) => setFrame(Number(event.currentTarget.value))}
            />
            <input
              type="number"
              min={0}
              max={getTotalFrames(sourceComposition)}
              value={frame}
              onChange={(event) =>
                setFrame(
                  Math.max(
                    0,
                    Math.min(
                      getTotalFrames(sourceComposition),
                      Number(event.currentTarget.value) || 0,
                    ),
                  ),
                )
              }
            />
          </label>
          {layer && (
            <section className="component-editor-controls">
              <h3>{layer.name}</h3>
              <label>
                Source layer name
                <input
                  value={layer.name}
                  onChange={(event) => editLayer({ name: event.currentTarget.value })}
                />
              </label>
              <div className="component-source-dimensions">
                {(['x', 'y', 'width', 'height', 'rotation'] as const).map((property) => (
                  <label key={property}>
                    {property.charAt(0).toUpperCase() + property.slice(1)}
                    <input
                      type="number"
                      step="any"
                      min={property === 'width' || property === 'height' ? 1 : undefined}
                      value={getLayerTransformAtFrame(layer, frame)[property]}
                      onChange={(event) =>
                        setDimension(property, event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="component-editor-hint">
                Position and size changes apply across the source animation.
              </p>
              {layer.element.type === 'text' && (
                <>
                  {layer.element.clock ? (
                    <ClockTimerEditor
                      value={layer.element.clock}
                      onChange={(clock) => editElement({ clock })}
                      externalBinding={{
                        fieldId:
                          layer.bindings.find(
                            (binding) => binding.targetProperty === 'clock.manualValue',
                          )?.fieldId ?? null,
                        fields: component.dataFields
                          .filter((field) =>
                            ['text', 'textarea', 'number', 'integer', 'select'].includes(
                              field.type,
                            ),
                          )
                          .map((field) => ({ id: field.id, label: field.label || field.key })),
                        onChange: (fieldId) =>
                          run(() =>
                            useProjectStore
                              .getState()
                              .bindComponentClockValue(component.id, layer.id, fieldId),
                          ),
                        onCreate: () =>
                          run(() =>
                            useProjectStore
                              .getState()
                              .bindComponentClockValue(component.id, layer.id),
                          ),
                      }}
                    />
                  ) : (
                    <label>
                      Default text
                      <textarea
                        value={textContent}
                        onChange={(event) => editText(event.currentTarget.value)}
                      />
                    </label>
                  )}
                  <div className="component-source-dimensions">
                    <label>
                      Font
                      <select
                        value={layer.element.fontFamily}
                        onChange={(event) => editElement({ fontFamily: event.currentTarget.value })}
                      >
                        {fontOptions.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Size
                      <input
                        type="number"
                        min={1}
                        value={layer.element.fontSize}
                        onChange={(event) =>
                          editElement({ fontSize: Math.max(1, Number(event.currentTarget.value)) })
                        }
                      />
                    </label>
                    <label>
                      Weight
                      <select
                        value={layer.element.fontWeight}
                        onChange={(event) =>
                          editElement({ fontWeight: Number(event.currentTarget.value) })
                        }
                      >
                        {[300, 400, 500, 600, 700, 800, 900].map((weight) => (
                          <option key={weight} value={weight}>
                            {weight}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </>
              )}
              {layer.element.type === 'image' && (
                <label>
                  Image asset
                  <select
                    value={selectedImageSource ?? ''}
                    onChange={(event) => editElement({ src: event.currentTarget.value || null })}
                  >
                    <option value="">No image</option>
                    {selectedImageSource &&
                      ![...composition.assets, ...(component.resources ?? [])].some(
                        (asset) => `asset:${asset.id}` === selectedImageSource,
                      ) && <option value={selectedImageSource}>Current image source</option>}
                    {[
                      ...new Map(
                        [...composition.assets, ...(component.resources ?? [])]
                          .filter((asset) => asset.kind === 'image')
                          .map((asset) => [asset.id, asset]),
                      ).values(),
                    ].map((asset) => (
                      <option key={asset.id} value={`asset:${asset.id}`}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {[
                'rectangle',
                'ellipse',
                'path',
                'pattern',
                'text',
                'image',
                'image-sequence',
                'lottie',
              ].includes(layer.element.type) && (
                <PaintEditor
                  value={getElementFill(layer.element)}
                  onChange={editPaint}
                  media={
                    layer.element.type === 'image' ||
                    layer.element.type === 'image-sequence' ||
                    layer.element.type === 'lottie'
                  }
                  allowMedia={false}
                  onEditShader={() => editShader('fill')}
                />
              )}
              {layer.element.type === 'rectangle' && (
                <label>
                  Corner radius
                  <input
                    type="number"
                    min={0}
                    title="Sets all four source corner radii"
                    value={
                      typeof layer.element.borderRadius === 'number'
                        ? layer.element.borderRadius
                        : layer.element.borderRadius.topLeft
                    }
                    onChange={(event) =>
                      editElement({
                        borderRadius: createCornerRadii(
                          Math.max(0, Number(event.currentTarget.value)),
                        ),
                      })
                    }
                  />
                </label>
              )}
              <label>
                Parent
                <select
                  value={layer.parentId ?? ''}
                  onChange={(event) => editLayer({ parentId: event.currentTarget.value || null })}
                >
                  <option value="">No parent</option>
                  {component.layers
                    .filter((candidate) => {
                      const seen = new Set<string>([layer.id]);
                      let current: Layer | undefined = candidate;
                      while (current) {
                        if (seen.has(current.id)) return false;
                        seen.add(current.id);
                        current = current.parentId
                          ? component.layers.find((child) => child.id === current!.parentId)
                          : undefined;
                      }
                      return true;
                    })
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                </select>
              </label>
              {(layer.element.type === 'rectangle' ||
                layer.element.type === 'ellipse' ||
                layer.element.type === 'path') && (
                <label className="component-field-checkbox">
                  <input
                    type="checkbox"
                    checked={layer.clipChildren}
                    onChange={(event) => editLayer({ clipChildren: event.currentTarget.checked })}
                  />
                  Clip children to source bounds
                </label>
              )}
              {layer.element.type === 'text' && (
                <>
                  <label>
                    Outline width
                    <input
                      type="number"
                      min={0}
                      value={layer.element.strokeWidth}
                      onChange={(event) =>
                        editElement({ strokeWidth: Math.max(0, Number(event.currentTarget.value)) })
                      }
                    />
                  </label>
                  <PaintEditor
                    label="Outline"
                    value={layer.element.strokePaint ?? layer.element.strokeColor}
                    allowGradient={false}
                    allowMedia={false}
                    onEditShader={() => editShader('stroke')}
                    onChange={(paint) => {
                      if (typeof paint === 'string')
                        editElement({ strokeColor: paint, strokePaint: undefined });
                      else if (paint?.type === 'shader') editElement({ strokePaint: paint });
                    }}
                  />
                </>
              )}
              <SourceEffects
                layer={layer}
                onChange={editLayer}
                onEditShader={(id) => editShader('effect', id)}
              />
            </section>
          )}
          {component.dataFields.length > 0 && (
            <section className="component-editor-controls">
              <h3>Component fields</h3>
              <p className="component-editor-hint">
                These defaults belong to the source. Instance field overrides stay local.
              </p>
              {component.dataFields.map((field) => (
                <FieldControl
                  key={field.id}
                  field={field}
                  value={field.defaultValue}
                  onChange={(value) =>
                    run(() => updateField(component.id, field.id, { defaultValue: value }))
                  }
                />
              ))}
            </section>
          )}
        </div>
      </div>
      {error && (
        <p className="component-editor-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <span>Changes apply live and can be undone in the editor.</span>
        <button type="button" onClick={closeComponentEditor}>
          Done
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

/** One host in AppShell serves both the main editor and requests from detached panes. */
export function ComponentEditorDialogHost() {
  const current = useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
  const project = useProjectStore((state) => state.project);
  const activeCompositionId = useProjectStore((state) => state.activeCompositionId);
  const composition = project.compositions.find((item) => item.id === current?.compositionId);
  const component = composition?.components.find((item) => item.id === current?.componentId);
  useEffect(() => {
    if (
      current &&
      (current.projectId !== project.id ||
        current.owner.closed ||
        !component ||
        activeCompositionId !== current.compositionId)
    )
      closeComponentEditor();
  }, [current, project.id, component, activeCompositionId]);
  if (
    !current ||
    !composition ||
    !component ||
    current.projectId !== project.id ||
    current.owner.closed ||
    activeCompositionId !== current.compositionId
  )
    return null;
  return (
    <EditorWindowContext.Provider value={current.owner}>
      <ComponentEditorDialog
        key={`${current.projectId}/${current.compositionId}/${current.componentId}`}
        target={current}
        composition={composition}
        component={component}
      />
    </EditorWindowContext.Provider>
  );
}
