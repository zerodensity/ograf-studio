import { applyElementDataValue, readElementDataValue } from './boundPaint';
import { effectParameterValue, parseEffectProperty, withEffectParameter } from './effectStack';
import { modifierParameterValue, parseModifierProperty, withModifierParameter } from './modifiers';
import { fieldDefinitionAtPath, valueAtSourcePath } from './fieldSchema';
import { layerTransformBindingChannel, layerTransformBindingValueError } from './transformBindings';
import { isGradientPaint, validatePaint } from './paint';
import { getElementShaderPaint, inspectShaderSource } from './shader';
import { shaderParameterFieldValue } from './shaderFields';
import { SHADER_PARAMETER_TARGET } from './shaderParameters';
import type {
  Composition,
  Element,
  FieldDefinition,
  FieldValue,
  Layer,
  LayerBinding,
  LayerEffects,
  ShaderParameterValue,
  LayerTransform,
} from './types';

export interface DesignerBindingPreviewReset {
  fieldId: string;
  /** Absolute field-value path; array prototype edits include the first item index. */
  sourcePath: string[];
}

/** Copy JSON values without structuredClone, which cannot copy Immer draft proxies. */
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) as T;
  }
  return value;
}

const equal = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

function targetValue(
  element: Element,
  effects: LayerEffects,
  property: string,
  modifiers?: Layer['modifiers'],
): unknown {
  if (parseModifierProperty(property))
    return modifierParameterValue({ modifiers: modifiers ?? [] }, property);
  if (parseEffectProperty(property)) return effectParameterValue(effects, property);
  if (Object.hasOwn(effects, property))
    return (effects as unknown as Record<string, unknown>)[property];
  if (property === 'fill' && element.type === 'text') return element.fill ?? element.color;
  return readElementDataValue(element, property);
}

function exposedValue(element: Element, property: string, value: unknown): unknown {
  if (element.type === 'image' && property === 'src' && value === null) return '';
  const target = SHADER_PARAMETER_TARGET.exec(property);
  if (!target) return value;
  const paint = getElementShaderPaint(element, target[1] === 'strokePaint' ? 'stroke' : 'fill');
  const parameter = paint
    ? inspectShaderSource(paint.fragmentSource).parameters.find((item) => item.name === target[2])
    : undefined;
  return parameter ? shaderParameterFieldValue(parameter, value as ShaderParameterValue) : value;
}

function validValue(field: FieldDefinition, value: unknown): value is FieldValue {
  const constraints = field.constraints;
  switch (field.type) {
    case 'number':
    case 'integer':
    case 'duration-ms':
    case 'percentage':
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      if ((field.type === 'integer' || field.type === 'duration-ms') && !Number.isInteger(value))
        return false;
      if (field.type === 'duration-ms' && value < 0) return false;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return false;
      break;
    case 'gradient':
      if (!isGradientPaint(value) || validatePaint(value).length) return false;
      break;
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      if (
        !field.properties.every((property) =>
          Object.hasOwn(record, property.key)
            ? validValue(property, record[property.key])
            : !property.required,
        )
      )
        return false;
      break;
    }
    case 'array':
    case 'select-multiple':
      if (!Array.isArray(value)) return false;
      if (constraints.minItems !== undefined && value.length < constraints.minItems) return false;
      if (constraints.maxItems !== undefined && value.length > constraints.maxItems) return false;
      if (
        field.type === 'select-multiple'
          ? !value.every(
              (item) => typeof item === 'string' && field.options.some((o) => o.value === item),
            )
          : !field.items || !value.every((item) => validValue(field.items!, item))
      )
        return false;
      break;
    default:
      if (typeof value !== 'string') return false;
      if (field.type === 'select' && !field.options.some((option) => option.value === value))
        return false;
  }
  if (typeof value === 'string') {
    if (constraints.minLength !== undefined && value.length < constraints.minLength) return false;
    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) return false;
    if (constraints.pattern) {
      try {
        if (!new RegExp(constraints.pattern).test(value)) return false;
      } catch {
        return false;
      }
    }
  }
  if (typeof value === 'number') {
    if (constraints.minimum !== undefined && value < constraints.minimum) return false;
    if (constraints.maximum !== undefined && value > constraints.maximum) return false;
  }
  return true;
}

function convertValue(field: FieldDefinition, value: unknown): FieldValue | undefined {
  let converted = value;
  if (['text', 'textarea', 'color', 'image-url', 'file-path', 'select'].includes(field.type)) {
    if (typeof value === 'number' || typeof value === 'boolean') converted = String(value);
  } else if (['number', 'integer', 'duration-ms', 'percentage'].includes(field.type)) {
    if (typeof value === 'string' && value.trim()) converted = Number(value);
  } else if (field.type === 'boolean' && (value === 'true' || value === 'false')) {
    converted = value === 'true';
  }
  return validValue(field, converted) ? converted : undefined;
}

function replaceAtPath(value: FieldValue, path: readonly string[], next: FieldValue): FieldValue {
  if (!path.length) return copy(next);
  const [key, ...rest] = path;
  if (Array.isArray(value)) {
    const result = copy(value);
    const index = Number(key);
    result[index] = replaceAtPath(result[index] ?? {}, rest, next);
    return result;
  }
  const record = value && typeof value === 'object' ? value : {};
  const current = (record as Record<string, FieldValue>)[key!];
  return { ...copy(record), [key!]: replaceAtPath(current ?? {}, rest, next) };
}

/** Update the schema defaults as well as the root sample, preserving every untouched sibling. */
function writeDefault(field: FieldDefinition, path: readonly string[], next: FieldValue): void {
  field.defaultValue = replaceAtPath(field.defaultValue, path, next);
  delete field.defaultTokenId;
  if (!path.length) {
    if (field.type === 'object' && next && typeof next === 'object' && !Array.isArray(next)) {
      for (const property of field.properties) {
        if (Object.hasOwn(next, property.key))
          writeDefault(property, [], (next as Record<string, FieldValue>)[property.key]!);
      }
    } else if (field.type === 'array' && field.items && Array.isArray(next) && next.length) {
      writeDefault(field.items, [], next[0]!);
    }
    return;
  }
  if (field.type === 'array' && field.items) {
    writeDefault(field.items, path.slice(1), next);
  } else if (field.type === 'object') {
    const child = field.properties.find((property) => property.key === path[0]);
    if (child) writeDefault(child, path.slice(1), next);
  }
}

function rootDefault(field: FieldDefinition): FieldValue {
  if (field.type === 'array' && Array.isArray(field.defaultValue) && !field.defaultValue.length) {
    return [copy(field.items?.defaultValue ?? {})];
  }
  return field.defaultValue;
}

function mapsValue(value: unknown): value is NonNullable<LayerBinding['valueMap']>[string] {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (isGradientPaint(value) && validatePaint(value).length === 0)
  );
}

function writeMapping(
  binding: LayerBinding,
  key: string,
  value: NonNullable<LayerBinding['valueMap']>[string],
): void {
  binding.valueMap = { ...binding.valueMap, [key]: copy(value) };
}

function preservesTarget(layer: Layer, property: string, value: FieldValue, expected: unknown) {
  try {
    if (parseModifierProperty(property))
      return equal(
        modifierParameterValue(withModifierParameter(layer, property, value), property),
        expected,
      );
    const element = applyElementDataValue(layer.element, property, value);
    const effects = parseEffectProperty(property)
      ? withEffectParameter(layer.effects, property, value)
      : property === 'dropShadowColor'
        ? { ...layer.effects, dropShadowColor: String(value) }
        : layer.effects;
    const resolved = targetValue(element, effects, property);
    return (
      equal(resolved, expected) ||
      (layer.element.type === 'image' && property === 'src' && expected === null && resolved === '')
    );
  } catch {
    return false;
  }
}

/**
 * Commit a designer's property edits to the defaults behind its existing data bindings. Mapped
 * controls edit the active option's output. Returned paths tell the editor which transient test
 * values to release so the new authored defaults (and later undo) remain visible.
 */
export function syncDesignerBindingDefaults(
  composition: Composition,
  layer: Layer,
  before: { element: Element; effects: LayerEffects; modifiers?: Layer['modifiers'] },
  editedProperties: readonly string[],
  previewValues: Record<string, FieldValue> = {},
): DesignerBindingPreviewReset[] {
  const resets: DesignerBindingPreviewReset[] = [];
  for (const binding of layer.bindings) {
    const property = binding.targetProperty;
    const exactEdit = editedProperties.some(
      (edited) =>
        edited === property ||
        (layer.element.type === 'text' &&
          ((edited === 'color' && property === 'fill') ||
            (edited === 'fill' && property === 'color'))),
    );
    const nestedEdit = editedProperties.some((edited) => property.startsWith(`${edited}.`));
    if (!exactEdit && !nestedEdit) continue;
    const next = targetValue(layer.element, layer.effects, property, layer.modifiers);
    if (next === undefined) continue;
    if (
      !exactEdit &&
      equal(next, targetValue(before.element, before.effects, property, before.modifiers))
    )
      continue;
    const field = composition.dataFields.find((candidate) => candidate.id === binding.fieldId);
    if (!field) continue;
    const path = binding.sourcePath ?? [];
    const leaf = fieldDefinitionAtPath(field, path, { fromArrayItem: field.type === 'array' });
    if (!leaf) continue;
    const root = Object.hasOwn(previewValues, field.id)
      ? previewValues[field.id]
      : field.defaultValue;
    const item = field.type === 'array' && Array.isArray(root) ? root[0] : root;
    const key = String(valueAtSourcePath(item, path));
    const exposed = exposedValue(layer.element, property, next);
    const converted = convertValue(leaf, exposed);
    if (
      binding.valueMap ||
      converted === undefined ||
      !preservesTarget(layer, property, converted, next)
    ) {
      if (mapsValue(exposed)) writeMapping(binding, key, exposed);
      continue;
    }
    const absolutePath = field.type === 'array' ? ['0', ...path] : [...path];
    const proposedDefault = replaceAtPath(rootDefault(field), absolutePath, converted);
    if (!validValue(field, proposedDefault)) {
      if (mapsValue(exposed)) writeMapping(binding, key, exposed);
      continue;
    }
    field.defaultValue = rootDefault(field);
    writeDefault(field, absolutePath, converted);
    if (!absolutePath.length && composition.designSystem.stylePackColors) {
      composition.designSystem.stylePackColors = composition.designSystem.stylePackColors
        .map((link) => {
          if (link.targetFieldId !== field.id) return link;
          const detached = { ...link };
          delete detached.targetFieldId;
          return detached;
        })
        .filter((link) => link.targetTokenId || link.targetFieldId || link.targets.length > 0);
    }
    if (
      !resets.some((reset) => reset.fieldId === field.id && equal(reset.sourcePath, absolutePath))
    )
      resets.push({ fieldId: field.id, sourcePath: absolutePath });
  }
  return resets;
}

/** Absolute data-owned geometry edits change their field/mapping, never invisible animation keys. */
export function syncDesignerTransformBindingDefaults(
  composition: Composition,
  layer: Layer,
  patch: Partial<LayerTransform>,
  previewValues: Record<string, FieldValue> = {},
): { patch: Partial<LayerTransform>; resets: DesignerBindingPreviewReset[] } {
  const authoredPatch = { ...patch };
  const resets: DesignerBindingPreviewReset[] = [];
  for (const binding of layer.bindings) {
    const channel = layerTransformBindingChannel(binding.targetProperty);
    // Alpha is multiplicative: its authored animation remains independently editable.
    if (!channel || channel === 'opacity' || patch[channel] === undefined) continue;
    const next = patch[channel]!;
    const error = layerTransformBindingValueError(binding.targetProperty, next);
    if (error) throw new Error(error);
    const field = composition.dataFields.find((candidate) => candidate.id === binding.fieldId);
    const path = binding.sourcePath ?? [];
    const leaf =
      field && fieldDefinitionAtPath(field, path, { fromArrayItem: field.type === 'array' });
    if (!field || !leaf)
      throw new Error(`Repair the data binding for ${binding.targetProperty} before editing it.`);
    const root = Object.hasOwn(previewValues, field.id)
      ? previewValues[field.id]
      : field.defaultValue;
    const item = field.type === 'array' && Array.isArray(root) ? root[0] : root;
    const key = String(valueAtSourcePath(item, path));
    const converted = convertValue(leaf, next);
    const absolutePath = field.type === 'array' ? ['0', ...path] : path;
    const canWrite =
      converted !== undefined &&
      !layerTransformBindingValueError(binding.targetProperty, converted) &&
      validValue(field, replaceAtPath(rootDefault(field), absolutePath, converted));
    if (binding.valueMap || !canWrite) writeMapping(binding, key, next);
    else {
      field.defaultValue = rootDefault(field);
      writeDefault(field, absolutePath, converted!);
      resets.push({ fieldId: field.id, sourcePath: [...absolutePath] });
    }
    delete authoredPatch[channel];
  }
  return { patch: authoredPatch, resets };
}
