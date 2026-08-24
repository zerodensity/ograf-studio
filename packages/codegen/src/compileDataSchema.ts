import type {
  Composition,
  CustomActionDefinition,
  FieldDefinition,
  FieldType,
} from '@ograf-editor/scene-model';

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
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  multipleOf?: number;
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
      return 'array';
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
  }
}

function propertyFor(field: FieldDefinition): JSONSchemaProperty {
  const property: JSONSchemaProperty = {
    type: schemaTypeFor(field.type),
    title: field.label,
    default: field.defaultValue,
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
  if (field.type === 'color') property.pattern = '^#[0-9a-f]{6}$';
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
