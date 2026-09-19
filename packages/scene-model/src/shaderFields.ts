import { createFieldDefinition } from './factory';
import {
  inspectShaderElement,
  inspectShaderSource,
  getElementShaderPaint,
  getElementShaderPaints,
  hasElementShaderPaint,
  migrateShaderBindingTarget,
  shaderPaintConflictsWithBinding,
} from './shader';
import {
  normalizeShaderParameterValue,
  shaderColorToHex,
  shaderParameterTarget,
} from './shaderParameters';
import type {
  Composition,
  FieldType,
  FieldValue,
  Layer,
  ShaderParameterValue,
  ShaderParameterDefinition,
  ShaderPaintSlot,
} from './types';

const copy = <T>(value: T): T => structuredClone(value);
const equal = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

function labelFor(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

function fieldTypeFor(parameter: ShaderParameterDefinition): FieldType {
  if (parameter.control === 'color') return 'color';
  if (parameter.control === 'toggle') return 'boolean';
  if (parameter.control === 'vector2') return 'object';
  return parameter.glslType === 'int' ? 'integer' : 'number';
}

export function shaderParameterFieldValue(
  parameter: ShaderParameterDefinition,
  value: ShaderParameterValue,
): FieldValue {
  if (parameter.control === 'color') return shaderColorToHex(value as number[]);
  if (parameter.control === 'vector2') {
    const vector = value as number[];
    return { x: vector[0]!, y: vector[1]! };
  }
  return value as number | boolean;
}

function parameterConstraints(parameter: ShaderParameterDefinition) {
  return {
    ...(parameter.min !== undefined ? { minimum: parameter.min } : {}),
    ...(parameter.max !== undefined ? { maximum: parameter.max } : {}),
    ...(parameter.step !== undefined ? { step: parameter.step } : {}),
  };
}

function uniqueIdentity(
  composition: Composition,
  layer: Layer,
  name: string,
  slot: ShaderPaintSlot,
) {
  const idBase = `shader-field:${layer.id}:${slot === 'stroke' ? 'stroke:' : ''}${name}`;
  const keyBase = `shader_${layer.id.replace(/[^a-zA-Z0-9_]/g, '_')}_${slot === 'stroke' ? 'stroke_' : ''}${name}`;
  let suffix = 0;
  while (
    composition.dataFields.some(
      (field) =>
        field.id === `${idBase}${suffix ? `:${suffix}` : ''}` ||
        field.key === `${keyBase}${suffix ? `_${suffix}` : ''}`,
    )
  )
    suffix += 1;
  return {
    id: `${idBase}${suffix ? `:${suffix}` : ''}`,
    key: `${keyBase}${suffix ? `_${suffix}` : ''}`,
  };
}

function removeUnusedGeneratedFields(composition: Composition): void {
  const used = new Set(composition.layers.flatMap((layer) => layer.bindings.map((b) => b.fieldId)));
  for (const collection of composition.runtimeCollections) used.add(collection.fieldId);
  composition.dataFields = composition.dataFields.filter(
    (field) => !field.generatedShaderParameter || used.has(field.id),
  );
}

/** Materialize source-marked parameters as ordinary editable fields and runtime bindings. */
function syncShaderPaintSlotFields(
  composition: Composition,
  layer: Layer,
  slot: ShaderPaintSlot,
): void {
  const shader = getElementShaderPaint(layer.element, slot);
  const prefix = shaderParameterTarget('', slot);
  layer.bindings = layer.bindings.map((binding) => ({
    ...binding,
    targetProperty: migrateShaderBindingTarget(binding.targetProperty),
  }));
  if (!shader) {
    layer.bindings = layer.bindings.filter((binding) => !binding.targetProperty.startsWith(prefix));
    removeUnusedGeneratedFields(composition);
    return;
  }
  const inspection = inspectShaderSource(shader.fragmentSource);
  if (!inspection.valid) throw new Error(inspection.errors.join(' '));
  // A whole-fill field/token would replace the shader before its own uniforms are resolved.
  // Keep the user-owned resources, but detach links belonging to the previous paint mode.
  const replacesShaderPaint = (property: string) =>
    shaderPaintConflictsWithBinding(layer.element, property);
  layer.bindings = layer.bindings.filter((binding) => !replacesShaderPaint(binding.targetProperty));
  layer.designTokenBindings = layer.designTokenBindings.filter(
    (binding) => !replacesShaderPaint(binding.targetProperty),
  );
  const names = new Set(inspection.parameters.map((parameter) => parameter.name));
  layer.bindings = layer.bindings.filter(
    (binding) =>
      !binding.targetProperty.startsWith(prefix) ||
      names.has(binding.targetProperty.slice(prefix.length)),
  );
  const parameters: Record<string, ShaderParameterValue> = {};
  for (const definition of inspection.parameters) {
    const targetProperty = shaderParameterTarget(definition.name, slot);
    const previousBinding = layer.bindings.find(
      (binding) => binding.targetProperty === targetProperty,
    );
    const boundField = composition.dataFields.find(
      (field) => field.id === previousBinding?.fieldId,
    );
    let field =
      boundField?.generatedShaderParameter?.layerId === layer.id &&
      boundField.generatedShaderParameter.name === definition.name &&
      (boundField.generatedShaderParameter.paintSlot ?? 'fill') === slot
        ? boundField
        : composition.dataFields.find(
            (candidate) =>
              candidate.generatedShaderParameter?.layerId === layer.id &&
              candidate.generatedShaderParameter.name === definition.name &&
              (candidate.generatedShaderParameter.paintSlot ?? 'fill') === slot,
          );
    const previous = field?.generatedShaderParameter;
    const changedType =
      previous &&
      (previous.glslType !== definition.glslType || previous.control !== definition.control);
    let value = changedType
      ? copy(definition.defaultValue)
      : normalizeShaderParameterValue(
          definition,
          shader.parameters?.[definition.name] ?? definition.defaultValue,
        );
    const parameterEdited = previous?.value !== undefined && !equal(value, previous.value);
    // A Data panel default edit updates the shader too. Explicit shader-control edits take precedence.
    if (
      field &&
      previous?.value !== undefined &&
      !changedType &&
      equal(value, previous.value) &&
      !equal(field.defaultValue, shaderParameterFieldValue(definition, previous.value))
    ) {
      const fieldValue = normalizeShaderParameterValue(definition, field.defaultValue);
      if (
        definition.control !== 'color' &&
        !equal(field.defaultValue, shaderParameterFieldValue(definition, fieldValue))
      ) {
        throw new Error(`Shader field default is outside its declared range: ${field.key}.`);
      }
      value = fieldValue;
    }
    parameters[definition.name] = copy(value);
    // An explicitly chosen ordinary field remains user-owned and retains its own schema/default.
    if (boundField && !boundField.generatedShaderParameter) continue;
    if (!field) {
      field = createFieldDefinition(fieldTypeFor(definition), {
        ...uniqueIdentity(composition, layer, definition.name, slot),
        label: `${layer.name}${slot === 'stroke' ? ' outline' : ''}: ${labelFor(definition.name)}`,
        description: `Shader parameter ${definition.name}, declared in the layer source.`,
      });
      composition.dataFields.push(field);
    }
    if (changedType || parameterEdited) {
      delete field.defaultTokenId;
    }
    field.type = fieldTypeFor(definition);
    field.defaultValue = shaderParameterFieldValue(definition, value);
    field.constraints = parameterConstraints(definition);
    field.options = [];
    field.fileExtensions = [];
    field.items = null;
    field.properties =
      definition.control === 'vector2'
        ? ['x', 'y'].map((axis, index) =>
            createFieldDefinition('number', {
              id: `${field!.id}:${axis}`,
              key: axis,
              label: axis.toUpperCase(),
              required: true,
              defaultValue: (value as number[])[index]!,
              constraints: parameterConstraints(definition),
            }),
          )
        : [];
    if (definition.control === 'vector2' || definition.control === 'color') field.constraints = {};
    field.generatedShaderParameter = {
      layerId: layer.id,
      paintSlot: slot,
      name: definition.name,
      glslType: definition.glslType,
      control: definition.control,
      value: copy(value),
    };
    layer.bindings = layer.bindings.filter((binding) => binding.targetProperty !== targetProperty);
    layer.bindings.push({ fieldId: field.id, targetProperty });
  }
  shader.parameters = parameters;
  removeUnusedGeneratedFields(composition);
}

/** Keep independently exposed fill and outline controls in separate field namespaces. */
export function syncShaderParameterFields(composition: Composition, layer: Layer): void {
  syncShaderPaintSlotFields(composition, layer, 'fill');
  syncShaderPaintSlotFields(composition, layer, 'stroke');
}

/** Reconcile copies, removed layers, imported projects, and changes to generated field defaults. */
export function syncCompositionShaderParameterFields(composition: Composition): void {
  for (const layer of composition.layers) syncShaderParameterFields(composition, layer);
  removeUnusedGeneratedFields(composition);
}

/** Compile without mutating the editable source, including projects created by older clients. */
export function compositionWithShaderParameterFields(composition: Composition): Composition {
  if (
    !composition.layers.some((layer) => hasElementShaderPaint(layer.element)) &&
    !composition.dataFields.some((field) => field.generatedShaderParameter)
  )
    return composition;
  const normalized = copy(composition);
  for (const layer of normalized.layers) {
    // Leave malformed sources intact so normal project validation reports their exact errors.
    if (
      getElementShaderPaints(layer.element).every(({ paint }) => inspectShaderElement(paint).valid)
    ) {
      syncShaderParameterFields(normalized, layer);
    }
  }
  removeUnusedGeneratedFields(normalized);
  return normalized;
}
