import {
  compositionWithShaderParameterFields,
  getElementMediaPaint,
  isMediaPaint,
  walkElementContents,
  LIVE_MEDIA_ELEMENT_TAG,
  type Composition,
  type FieldDefinition,
  type FieldValue,
} from '@ograf-editor/scene-model';
import { fieldExposedToOgraf, publicFieldValueForExport } from './compileDataSchema';

/** Pins every ElectroNode has; page inputs cannot take their names. */
export const NODOS_ELECTRONODE_PINS = ['URL', 'Resolution', 'ShowPreview', 'Output', 'Audio'];

export function nodosInputNameError(name: string): string | undefined {
  return !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name) ||
    ['__proto__', 'prototype', 'constructor', ...NODOS_ELECTRONODE_PINS].includes(name)
    ? `Invalid Nodos input name "${name}".`
    : undefined;
}

export type NodosInputContract =
  | {
      inputs: Array<{ name: string; type: string }>;
      wrapped: Record<string, WrappedArrays>;
      exposure: Record<string, PublicValueShape>;
      liveMediaElementTag: string;
    }
  | { error: string };

function nodosTypeName(field: FieldDefinition): string {
  if (field.nodosType) return field.nodosType;
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'color':
    case 'image-url':
    case 'file-path':
    case 'select':
      return 'string';
    case 'number':
    case 'percentage':
      return 'double';
    case 'integer':
    case 'duration-ms':
      return 'int';
    case 'boolean':
      return 'bool';
    case 'object':
    case 'gradient':
      return 'nos.Dict';
    case 'select-multiple':
      return '[string]';
    case 'array': {
      const items = field.items ? nodosTypeName(field.items) : 'string';
      return items.startsWith('[') ? '[nos.Dict]' : `[${items}]`;
    }
  }
}

/** Validate defaults before publishing a page whose native values travel as JSON. */
function validateNodosDefault(
  field: FieldDefinition | null,
  value: FieldValue,
): string | undefined {
  if (!field || value === null) return undefined;
  if ((field.type === 'integer' || field.type === 'duration-ms') && !Number.isSafeInteger(value))
    return `Nodos field "${field.key}" needs a safe JSON integer.`;
  const entries: Array<[FieldDefinition | null, FieldValue]> =
    field.type === 'array' && Array.isArray(value)
      ? value.map((item) => [field.items, item])
      : field.type === 'object' && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value).map(([key, item]) => [
            field.properties.find((property) => property.key === key) ?? null,
            item as FieldValue,
          ])
        : [];
  for (const [child, item] of entries) {
    const error = validateNodosDefault(child, item);
    if (error) return error;
  }
  return undefined;
}

/** Where a field's value holds wrapped inner arrays, for the page to unwrap them; null where it holds none. */
type WrappedArrays =
  { items: WrappedArrays | null; wrapped: boolean } | { properties: Record<string, WrappedArrays> };
export function wrappedArrays(field: FieldDefinition | null): WrappedArrays | null {
  if (!field || !fieldExposedToOgraf(field)) return null;
  if (field?.type === 'array') {
    if (field.items && !fieldExposedToOgraf(field.items)) return null;
    const items = wrappedArrays(field.items);
    const wrapped = field.items?.type === 'array';
    return items || wrapped ? { items, wrapped } : null;
  }
  if (field?.type === 'object') {
    const properties = Object.fromEntries(
      field.properties.flatMap((property) => {
        const inner = wrappedArrays(property);
        return inner ? [[property.key, inner]] : [];
      }),
    );
    return Object.keys(properties).length ? { properties } : null;
  }
  return null;
}

/** Native structs return every member, including defaults for fields omitted from the preset. */
type PublicValueShape =
  | false
  | { properties?: Record<string, PublicValueShape>; items?: PublicValueShape; integer?: true };
export function publicValueShape(field: FieldDefinition): PublicValueShape | undefined {
  if (!fieldExposedToOgraf(field)) return false;
  if (field.type === 'integer' || field.type === 'duration-ms') return { integer: true };
  if (field.type === 'array' && field.items) {
    const items = publicValueShape(field.items);
    return items === undefined ? undefined : { items };
  }
  if (field.type === 'object') {
    const properties = Object.fromEntries(
      field.properties.flatMap((child) => {
        const shape = publicValueShape(child);
        return shape === undefined ? [] : [[child.key, shape]];
      }),
    );
    if (Object.keys(properties).length) return { properties };
  }
  return undefined;
}

export function publicNodosComposition(composition: Composition): Composition {
  const normalized = compositionWithShaderParameterFields(composition);
  return { ...normalized, dataFields: normalized.dataFields.filter(fieldExposedToOgraf) };
}

export function nodosDataFields(composition: Composition): FieldDefinition[] {
  const ids = composition.nodosInputFieldIds;
  const selected = ids === undefined ? undefined : new Set(ids);
  return composition.dataFields.filter(
    (field) => fieldExposedToOgraf(field) && (selected === undefined || selected.has(field.id)),
  );
}

function reservedFieldError(fields: readonly FieldDefinition[]): string | undefined {
  const taken = fields.filter((field) => NODOS_ELECTRONODE_PINS.includes(field.key));
  return taken.length
    ? `Rename the data field${taken.length > 1 ? 's' : ''} ${taken.map((field) => `"${field.key}"`).join(', ')}: ` +
        `Nodos ElectroNodes already have pins named ${NODOS_ELECTRONODE_PINS.join(', ')}.`
    : undefined;
}

/** Host metadata is kept outside the OGraf manifest and its public data schema. */
export function buildNodosInputContract(
  composition: Composition,
  liveCompositions: readonly Composition[] = [composition],
): NodosInputContract {
  composition = compositionWithShaderParameterFields(composition);
  const fields = nodosDataFields(composition);
  const reserved = reservedFieldError(fields);
  if (reserved) return { error: reserved };
  const inputs = new Map<string, string>();
  const add = (name: string, type: string): string | undefined => {
    const nameError = nodosInputNameError(name);
    if (nameError) return nameError;
    if (inputs.has(name) && inputs.get(name) !== type)
      return `Nodos input "${name}" has conflicting types.`;
    inputs.set(name, type);
    if (inputs.size > 64) return 'A Nodos page supports at most 64 input slots.';
    return undefined;
  };
  for (const field of fields) {
    const error =
      validateNodosDefault(field, publicFieldValueForExport(field, field.defaultValue)) ??
      add(field.key, nodosTypeName(field));
    if (error) return { error };
  }
  const paints = liveCompositions.flatMap((source) => [
    source.backgroundPaint,
    ...source.layers
      .filter((layer) => !layer.isGuide)
      .flatMap((layer) =>
        walkElementContents(layer.element).map((element) =>
          element.type === 'ticker' ? element.background : getElementMediaPaint(element),
        ),
      ),
  ]);
  const liveTags = [
    ...paints.flatMap((paint) =>
      isMediaPaint(paint) && paint.source.kind === 'live' ? [paint.source.tag] : [],
    ),
    ...liveCompositions.flatMap((source) =>
      (source.mediaCues ?? []).flatMap((cue) =>
        cue.sources.flatMap((source) => (source.kind === 'live' ? [source.tag] : [])),
      ),
    ),
  ];
  for (const tag of liveTags) {
    const error = add(tag, 'nos.sys.vulkan.Texture');
    if (error) return { error };
  }
  return {
    inputs: [...inputs].map(([name, type]) => ({ name, type })),
    wrapped: Object.fromEntries(
      fields.flatMap((field) => {
        const shape = wrappedArrays(field);
        return shape ? [[field.key, shape]] : [];
      }),
    ),
    exposure: Object.fromEntries(
      fields.flatMap((field) => {
        const shape = publicValueShape(field);
        return shape === undefined ? [] : [[field.key, shape]];
      }),
    ),
    liveMediaElementTag: LIVE_MEDIA_ELEMENT_TAG,
  };
}

/** Required existing slots, exposed by the page when its URL is loaded in ElectroNode. */
export function buildNodosInputDeclarations(
  composition: Composition,
): Array<{ name: string; type: string }> {
  const contract = buildNodosInputContract(composition);
  if ('error' in contract) throw new Error(contract.error);
  return contract.inputs;
}
