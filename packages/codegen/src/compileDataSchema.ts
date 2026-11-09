import {
  compositionWithShaderParameterFields,
  fieldExposedToOgraf,
  clockTimerActionId,
  type Composition,
  type CustomActionDefinition,
  type FieldDefinition,
  type FieldType,
  type FieldValue,
} from '@ograf-editor/scene-model';
import type { CompiledDataExposure } from '@ograf-editor/ograf-types';

export { fieldExposedToOgraf } from '@ograf-editor/scene-model';

/** Keep public defaults as selective as their property schema. */
export function publicFieldValueForExport(field: FieldDefinition, value: FieldValue): FieldValue {
  const result = fieldValueForExport(field, value);
  if (field.type === 'array' && field.items && Array.isArray(result))
    return result.map((item) => publicFieldValueForExport(field.items!, item));
  if (field.type === 'object' && result && typeof result === 'object' && !Array.isArray(result)) {
    const values = result as Record<string, FieldValue>;
    for (const child of field.properties) {
      if (!fieldExposedToOgraf(child)) delete values[child.key];
      else if (Object.hasOwn(values, child.key))
        values[child.key] = publicFieldValueForExport(child, values[child.key]!);
    }
  }
  return result;
}

export function compileDataExposure(
  fields: readonly FieldDefinition[],
): Record<string, CompiledDataExposure> | undefined {
  const policy = (field: FieldDefinition): CompiledDataExposure | undefined => {
    if (!fieldExposedToOgraf(field))
      return { exposed: false, defaultValue: fieldValueForExport(field, field.defaultValue) };
    const properties = field.type === 'object' ? compileDataExposure(field.properties) : undefined;
    const items = field.type === 'array' && field.items ? policy(field.items) : undefined;
    return properties || items
      ? { exposed: true, ...(properties ? { properties } : {}), ...(items ? { items } : {}) }
      : undefined;
  };
  const entries = fields.flatMap((field) => {
    const value = policy(field);
    return value ? [[field.key, value] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function publicDataForExport(
  composition: Composition,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const fields = compositionWithShaderParameterFields(composition).dataFields;
  const result = structuredClone(data);
  for (const field of fields) {
    if (!fieldExposedToOgraf(field)) delete result[field.key];
    else if (Object.hasOwn(result, field.key))
      result[field.key] = publicFieldValueForExport(field, result[field.key] as FieldValue);
  }
  return result;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  title: string;
  description?: string;
  default?: FieldDefinition['defaultValue'];
  format?: string;
  enum?: Array<string | number>;
  gddType?: string;
  gddOptions?: { labels?: Record<string, string>; extensions?: string[] };
  properties?: Record<string, Omit<JSONSchemaProperty, 'title'> & { title?: string }>;
  items?: Omit<JSONSchemaProperty, 'title'> & { title?: string };
  required?: string[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  multipleOf?: number;
  /** Authoring ownership preserved when recovering an editable shader from its package. */
  v_ografShaderParameter?: FieldDefinition['generatedShaderParameter'];
}

/** Shaped to slot directly into an OGraf manifest's `schema` field. */
export interface DataJSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required: string[];
}

function schemaTypeFor(type: FieldType): JSONSchemaProperty['type'] {
  switch (type) {
    case 'number':
    case 'percentage':
      return 'number';
    case 'integer':
    case 'duration-ms':
      return 'integer';
    case 'boolean':
      return 'boolean';
    case 'gradient':
      return 'object';
    case 'select-multiple':
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    case 'text':
    case 'textarea':
    case 'color':
    case 'image-url':
    case 'file-path':
    case 'select':
      return 'string';
  }
}

function gddTypeFor(type: FieldType): string {
  switch (type) {
    case 'text':
      return 'single-line';
    case 'textarea':
      return 'multi-line';
    case 'color':
      return 'color-rrggbb';
    case 'image-url':
      return 'file-path/image-path';
    case 'file-path':
      return 'file-path';
    case 'select':
      return 'select';
    case 'select-multiple':
      return 'select-multiple';
    case 'percentage':
      return 'percentage';
    case 'duration-ms':
      return 'duration-ms';
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'gradient':
      return 'gradient';
    case 'object':
      return 'object';
    case 'array':
      return 'array';
  }
}

/** GDD color values are canonical lowercase hex; preserve the editable source and other data. */
export function fieldValueForExport(field: FieldDefinition, value: FieldValue): FieldValue {
  if (field.type === 'color' && typeof value === 'string') {
    return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ? value.toLowerCase() : value;
  }
  if (field.type === 'array' && field.items && Array.isArray(value)) {
    return value.map((item) => fieldValueForExport(field.items!, item));
  }
  if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const result = structuredClone(value) as Record<string, FieldValue>;
    for (const child of field.properties) {
      if (Object.hasOwn(result, child.key))
        result[child.key] = fieldValueForExport(child, result[child.key]!);
    }
    return result;
  }
  return structuredClone(value);
}

function propertyFor(field: FieldDefinition): JSONSchemaProperty {
  const property: JSONSchemaProperty = {
    type: schemaTypeFor(field.type),
    title: field.label,
    default: publicFieldValueForExport(field, field.defaultValue),
    gddType: gddTypeFor(field.type),
  };
  if (field.description.trim()) property.description = field.description.trim();
  const { constraints } = field;
  if (constraints.minLength !== undefined) property.minLength = constraints.minLength;
  if (constraints.maxLength !== undefined) property.maxLength = constraints.maxLength;
  if (constraints.minimum !== undefined) property.minimum = constraints.minimum;
  if (constraints.maximum !== undefined) property.maximum = constraints.maximum;
  if (constraints.pattern) property.pattern = constraints.pattern;
  if (constraints.step !== undefined) property.multipleOf = constraints.step;
  if (constraints.minItems !== undefined) property.minItems = constraints.minItems;
  if (constraints.maxItems !== undefined) property.maxItems = constraints.maxItems;
  if (field.type === 'color') {
    const alpha = field.generatedShaderParameter?.glslType === 'vec4';
    property.pattern = alpha ? '^#[0-9a-f]{8}$' : '^#[0-9a-f]{6}$';
    if (alpha) property.gddType = 'color-rrggbbaa';
  }
  if (field.generatedShaderParameter)
    property.v_ografShaderParameter = structuredClone(field.generatedShaderParameter);
  if (field.type === 'file-path' || field.type === 'image-url') {
    property.gddOptions = field.fileExtensions.length ? { extensions: field.fileExtensions } : {};
  }
  if (field.type === 'select' || field.type === 'select-multiple') {
    const values = field.options.map((option) => option.value);
    const labels = Object.fromEntries(field.options.map((option) => [option.value, option.label]));
    property.gddOptions = { labels };
    if (field.type === 'select') property.enum = values;
    else property.items = { type: 'string', enum: values };
  }
  if (field.type === 'gradient') {
    property.properties = {
      type: { type: 'string', enum: ['linear', 'radial', 'conic'] },
      angle: { type: 'number' },
      stops: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          properties: {
            offset: { type: 'number', minimum: 0, maximum: 1 },
            color: { type: 'string' },
            opacity: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['offset', 'color', 'opacity'],
        },
      },
    };
    property.required = ['type', 'angle', 'stops'];
  }
  if (field.type === 'object') {
    property.properties = Object.fromEntries(
      field.properties.filter(fieldExposedToOgraf).map((child) => [child.key, propertyFor(child)]),
    );
    property.required = field.properties
      .filter((child) => fieldExposedToOgraf(child) && child.required)
      .map((child) => child.key);
  }
  if (field.type === 'array' && field.items) {
    property.items = propertyFor(field.items);
  }
  return property;
}

/** Composition's Field Definitions -> the JSON Schema an OGraf manifest's `schema` describes. */
export function compileDataSchema(composition: Composition): DataJSONSchema {
  composition = compositionWithShaderParameterFields(composition);
  const properties: Record<string, JSONSchemaProperty> = {};
  const required: string[] = [];
  for (const field of composition.dataFields) {
    if (!fieldExposedToOgraf(field)) continue;
    properties[field.key] = propertyFor(field);
    if (field.required) required.push(field.key);
  }
  return { type: 'object', properties, required };
}

export interface CompiledCustomAction {
  id: string;
  name: string;
  description?: string;
}

function compileCustomAction(action: CustomActionDefinition): CompiledCustomAction {
  return {
    id: action.actionId,
    name: action.name,
    ...(action.description ? { description: action.description } : {}),
  };
}

/** Composition's Custom Action Definitions -> an OGraf manifest's `customActions[]`. */
export function compileCustomActions(composition: Composition): CompiledCustomAction[] {
  const actions = composition.customActions.map(compileCustomAction);
  for (const layer of composition.layers) {
    if (layer.isGuide || layer.element.type !== 'text' || !layer.element.clock) continue;
    for (const command of ['start', 'pause', 'reset', 'restart'] as const) {
      const id = clockTimerActionId(layer.id, command);
      if (actions.some((action) => action.id === id)) continue;
      actions.push({
        id,
        name: `${layer.name}: ${command[0]!.toUpperCase()}${command.slice(1)}`,
        description: `${command[0]!.toUpperCase()}${command.slice(1)} the ${layer.name} timer.`,
      });
    }
  }
  return actions;
}
