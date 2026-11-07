import {
  createFieldDefinition,
  getLayerTransformAtFrame,
  layerTransformBindingChannel,
  effectParameterSpec,
  effectParameterValue,
  getElementShaderPaint,
  inspectShaderSource,
  isGradientPaint,
  resolveShaderParameters,
  modifierParameterValue,
  parseModifierProperty,
  shaderParameterFieldValue,
  type FieldDefinition,
  type FieldConstraints,
  type FieldType,
  type FieldValue,
  type Layer,
  type LayerBinding,
} from '@ograf-editor/scene-model';
import { bindableProperties } from './dataBinding';

interface FieldSeed {
  type: FieldType;
  defaultValue: FieldValue;
  options?: Array<{ value: string; label: string }>;
  vector?: { x: number; y: number };
  constraints?: FieldConstraints;
}

function fieldSeed(layer: Layer, target: string, frame = 0): FieldSeed | null {
  const transformChannel = layerTransformBindingChannel(target);
  if (transformChannel)
    return {
      type: 'number',
      defaultValue:
        transformChannel === 'opacity'
          ? 1
          : getLayerTransformAtFrame(layer, frame)[transformChannel],
      ...(transformChannel === 'opacity'
        ? { constraints: { minimum: 0, maximum: 1 } }
        : transformChannel === 'width' || transformChannel === 'height'
          ? { constraints: { minimum: 0 } }
          : {}),
    };
  if (parseModifierProperty(target)) {
    const value = modifierParameterValue(layer, target);
    return value === undefined ? null : { type: 'number', defaultValue: value };
  }
  const { element, effects } = layer;
  if (element.type === 'ticker') {
    if (target === 'items')
      return {
        type: 'array',
        defaultValue: structuredClone(element.items) as unknown as FieldValue,
      };
    const nested = /^items\.([^.]+)\.(.+)$/.exec(target);
    if (nested) {
      const item = element.items.find((candidate) => candidate.id === nested[1]);
      if (item && (nested[2] === 'width' || nested[2] === 'height'))
        return {
          type: 'number',
          defaultValue: item[nested[2]] ?? layer.keyframes[0]?.transform.height ?? 72,
        };
      return item
        ? fieldSeed(
            { ...layer, element: item.element, effects: item.effects ?? effects },
            nested[2]!,
          )
        : null;
    }
    if (['speedPixelsPerSecond', 'gap', 'entryFade', 'exitFade', 'fadeSoftness'].includes(target))
      return { type: 'number', defaultValue: element[target as 'speedPixelsPerSecond'] };
    if (target === 'updatePolicy')
      return {
        type: 'select',
        defaultValue: element.updatePolicy ?? 'next-appearance',
        options: [
          { value: 'next-appearance', label: 'Next appearance' },
          { value: 'immediate', label: 'Immediately' },
        ],
      };
    if (target === 'direction' || target === 'textDirection')
      return {
        type: 'select',
        defaultValue: element[target],
        options: (target === 'direction' ? ['left', 'right'] : ['auto', 'ltr', 'rtl']).map(
          (value) => ({ value, label: value }),
        ),
      };
  }
  if (target === 'clock.manualValue' && element.type === 'text' && element.clock) {
    const value = element.clock.manualValue;
    return { type: typeof value === 'number' ? 'number' : 'text', defaultValue: value };
  }
  if (target.startsWith('clock.') && element.type === 'text' && element.clock) {
    const { clock } = element;
    if (target === 'clock.timeZone') return { type: 'text', defaultValue: clock.timeZone };
    if (target === 'clock.format') return { type: 'text', defaultValue: clock.format };
    if (target === 'clock.showAmPm') return { type: 'boolean', defaultValue: clock.showAmPm };
    if (target === 'clock.initialValueMs')
      return { type: 'duration-ms', defaultValue: clock.initialValueMs };
    if (target === 'clock.hourCycle')
      return {
        type: 'select',
        defaultValue: clock.hourCycle,
        options: [
          { value: '24', label: '24-hour' },
          { value: '12', label: '12-hour' },
        ],
      };
    if (target === 'clock.endBehavior')
      return {
        type: 'select',
        defaultValue: clock.endBehavior,
        options: [
          { value: 'stop', label: 'Stop' },
          { value: 'continue', label: 'Continue into overtime' },
          { value: 'loop', label: 'Loop' },
        ],
      };
  }
  if (target === 'content' && element.type === 'text') {
    const content = element.runs.length
      ? element.runs.map((run) => run.text).join('')
      : element.content;
    return { type: content.includes('\n') ? 'textarea' : 'text', defaultValue: content };
  }
  if (target === 'src' && element.type === 'image') {
    return { type: 'image-url', defaultValue: element.src ?? '' };
  }
  if (target === 'data' && element.type === 'chart') {
    return { type: 'textarea', defaultValue: JSON.stringify(element.data) };
  }
  if (target === 'fill' && 'fill' in element) {
    if (typeof element.fill === 'string') {
      return { type: 'color', defaultValue: element.fill };
    }
    if (isGradientPaint(element.fill)) {
      return { type: 'gradient', defaultValue: structuredClone(element.fill) };
    }
    return null;
  }
  if (target === 'color' && element.type === 'text') {
    return { type: 'color', defaultValue: element.color };
  }
  if (target === 'strokeColor' && 'strokeColor' in element) {
    return { type: 'color', defaultValue: element.strokeColor };
  }
  if (target === 'dropShadowColor') {
    return { type: 'color', defaultValue: effects.dropShadowColor };
  }
  const gradientStop = /^fill\.stops\[(\d+)\]\.color$/.exec(target);
  if (gradientStop && 'fill' in element && isGradientPaint(element.fill)) {
    const stop = element.fill.stops[Number(gradientStop[1])];
    return stop ? { type: 'color', defaultValue: stop.color } : null;
  }
  const effectSpec = effectParameterSpec(effects, target);
  if (effectSpec) {
    const value = effectParameterValue(effects, target) ?? effectSpec.default;
    return {
      type: typeof effectSpec.default === 'number' ? 'number' : 'color',
      defaultValue: value,
    };
  }
  const shaderTarget = /^(fill|strokePaint)\.parameters\.(.+)$/.exec(target);
  if (shaderTarget) {
    const paint = getElementShaderPaint(
      element,
      shaderTarget[1] === 'strokePaint' ? 'stroke' : 'fill',
    );
    const definition = paint
      ? inspectShaderSource(paint.fragmentSource).parameters.find(
          (candidate) => candidate.name === shaderTarget[2],
        )
      : undefined;
    if (!paint || !definition) return null;
    const current = resolveShaderParameters(paint)[definition.name] ?? definition.defaultValue;
    const defaultValue = shaderParameterFieldValue(definition, current);
    if (definition.control === 'vector2') {
      const vector = defaultValue as { x: number; y: number };
      return {
        type: 'object',
        defaultValue: vector,
        vector,
      };
    }
    return {
      type:
        definition.control === 'color'
          ? 'color'
          : definition.control === 'toggle'
            ? 'boolean'
            : definition.glslType === 'int'
              ? 'integer'
              : 'number',
      defaultValue,
    };
  }
  return null;
}

export function nextBindingProperty(layer: Layer): { value: string; label: string } | null {
  return (
    bindableProperties(layer.element, layer.effects, layer.modifiers).find(
      (property) =>
        !layer.bindings.some((binding) => binding.targetProperty === property.value) &&
        fieldSeed(layer, property.value) !== null,
    ) ?? null
  );
}

function uniqueFieldKey(layerName: string, target: string, fields: FieldDefinition[]): string {
  let base = (target ? `${layerName}_${target}` : layerName)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  if (!base || /^\d/.test(base)) base = `field_${base || 'value'}`;
  const used = new Set(fields.map((field) => field.key));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/** One authored field and one binding, ready to commit together as a single project edit. */
export function createNextBinding(
  layer: Layer,
  existingFields: FieldDefinition[],
  frame = 0,
): { field: FieldDefinition; binding: LayerBinding } | null {
  const property = nextBindingProperty(layer);
  if (!property) return null;
  const seed = fieldSeed(layer, property.value, frame);
  if (!seed) return null;
  const field = createFieldDefinition(seed.type, {
    key: uniqueFieldKey(layer.name, property.value, existingFields),
    label: `${layer.name}: ${property.label}`,
    defaultValue: seed.defaultValue,
    ...(seed.options ? { options: seed.options } : {}),
    ...(seed.constraints ? { constraints: seed.constraints } : {}),
    ...(seed.vector
      ? {
          properties: (['x', 'y'] as const).map((axis) =>
            createFieldDefinition('number', {
              key: axis,
              label: axis.toUpperCase(),
              required: true,
              defaultValue: seed.vector![axis],
            }),
          ),
        }
      : {}),
  });
  return { field, binding: { fieldId: field.id, targetProperty: property.value } };
}

/** The one property that makes a layer's content editable from playout, if it has one. */
export function playoutProperty(layer: Layer): { value: string; label: string } | null {
  if (layer.element.type === 'text' && layer.element.clock)
    return layer.element.clock.source === 'manual'
      ? { value: 'clock.manualValue', label: 'Clock / Timer value' }
      : null;
  if (layer.element.type === 'text') return { value: 'content', label: 'Text' };
  if (layer.element.type === 'image') return { value: 'src', label: 'Image' };
  if (layer.element.type === 'ticker') {
    const item =
      layer.element.items.find((candidate) => candidate.element.type === 'text') ??
      layer.element.items.find((candidate) => candidate.element.type === 'image');
    if (item)
      return {
        value: `items.${item.id}.${item.element.type === 'text' ? 'content' : 'src'}`,
        label: item.name ?? (item.element.type === 'text' ? 'Ticker text' : 'Ticker image'),
      };
  }
  return null;
}

/**
 * The field and binding behind "Editable in playout": named after the layer, seeded with its
 * current text or image, so switching it on doesn't change the graphic.
 */
export function createPlayoutBinding(
  layer: Layer,
  existingFields: FieldDefinition[],
): { field: FieldDefinition; binding: LayerBinding } | null {
  const property = playoutProperty(layer);
  const seed = property ? fieldSeed(layer, property.value) : null;
  if (!property || !seed) return null;
  const key = uniqueFieldKey(layer.name, '', existingFields);
  const field = createFieldDefinition(seed.type, {
    key,
    label: layer.name,
    defaultValue: seed.defaultValue,
  });
  return { field, binding: { fieldId: field.id, targetProperty: property.value } };
}
