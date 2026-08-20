import type {
  Composition,
  CustomActionDefinition,
  FieldDefinition,
  FieldType,
} from '@ograf-editor/scene-model';

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  title: string;
  default?: FieldDefinition['defaultValue'];
  format?: string;
  enum?: string[];
  properties?: Record<string, Omit<JSONSchemaProperty, 'title'> & { title?: string }>;
  items?: Omit<JSONSchemaProperty, 'title'> & { title?: string };
  required?: string[];
  minItems?: number;
  minimum?: number;
  maximum?: number;
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
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'gradient':
      return 'object';
    case 'text':
    case 'textarea':
    case 'color':
    case 'image-url':
      return 'string';
  }
}

function formatFor(type: FieldType): string | undefined {
  return type === 'image-url' ? 'uri' : undefined;
}

function propertyFor(field: FieldDefinition): JSONSchemaProperty {
  const property: JSONSchemaProperty = {
    type: schemaTypeFor(field.type),
    title: field.label,
    default: field.defaultValue,
  };
  const format = formatFor(field.type);
  if (format) property.format = format;
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
  return property;
}

/** Composition's Field Definitions -> the JSON Schema an OGraf manifest's `schema` describes. */
export function compileDataSchema(composition: Composition): DataJSONSchema {
  const properties: Record<string, JSONSchemaProperty> = {};
  const required: string[] = [];
  for (const field of composition.dataFields) {
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
  return composition.customActions.map(compileCustomAction);
}
