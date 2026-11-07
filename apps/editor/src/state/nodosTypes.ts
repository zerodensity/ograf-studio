import { create } from 'zustand';
import {
  createFieldDefinition,
  isNodosTypeName,
  type FieldDefinition,
  type FieldType,
  type FieldValue,
} from '@ograf-editor/scene-model';
import { requestNodosTypes } from './agentBridge';

/** A field's type in a Nodos struct or table, with kinds named as in FlatBuffers' reflection.BaseType. */
export interface NodosFieldType {
  base: string;
  element: string;
  object?: string;
  enum?: string;
  fixedLength: number;
}

export interface NodosObjectType {
  name: string;
  isStruct: boolean;
  attributes: Record<string, string>;
  fields: { name: string; type: NodosFieldType; deprecated: boolean; dynamic: boolean }[];
}

export interface NodosEnumType {
  name: string;
  isUnion: boolean;
  values: string[];
}

/** The structs, tables and enums of a Nodos engine, as Studio's server reads them from it. */
export interface NodosTypeList {
  objects: NodosObjectType[];
  enums: NodosEnumType[];
}

export type NodosTypesResult = ({ ok: true } & NodosTypeList) | { ok: false; message: string };

/** The engine types a data field can take, by name, and why there are none when Nodos could not be reached. */
export const useNodosTypes = create<{
  address: string | null;
  objects: Map<string, NodosObjectType>;
  enums: Map<string, NodosEnumType>;
  /** Sorted, the types a field can take. */
  choices: string[];
  message: string;
}>(() => ({ address: null, objects: new Map(), enums: new Map(), choices: [], message: '' }));

const INTEGERS = new Set(['Byte', 'UByte', 'Short', 'UShort', 'Int', 'UInt', 'Long', 'ULong']);
const INTEGER_RANGES: Record<string, readonly [number, number]> = {
  Byte: [-128, 127],
  UByte: [0, 255],
  Short: [-32768, 32767],
  UShort: [0, 65535],
  Int: [-2147483648, 2147483647],
  UInt: [0, 4294967295],
  // Studio's portable JSON numbers cannot exactly represent the rest of a 64-bit integer range.
  Long: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ULong: [0, Number.MAX_SAFE_INTEGER],
};
const SCALARS = new Set([...INTEGERS, 'Bool', 'Float', 'Double', 'String']);
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_TYPE_DEPTH = 16;
const MAX_EXPANDED_FIELDS = 4096;
const MAX_FIXED_ITEMS = 100;
let requestVersion = 0;
let selectedAddress: string | null = null;

/** Whether an OGraf field can hold the type's values: no unions, dynamic fields or resources such as textures. */
function isFieldShaped(
  type: NodosFieldType,
  objects: Map<string, NodosObjectType>,
  enums: Map<string, NodosEnumType>,
  seen = new Set<string>(),
  budget = { remaining: MAX_EXPANDED_FIELDS },
  weight = 1,
): boolean {
  if (!type) return false;
  const collection = type.base === 'Vector' || type.base === 'Array';
  if (
    type.base === 'Array' &&
    (!Number.isInteger(type.fixedLength) ||
      type.fixedLength < 1 ||
      type.fixedLength > MAX_FIXED_ITEMS)
  )
    return false;
  const expandedWeight = weight * (type.base === 'Array' ? type.fixedLength : 1);
  if ((budget.remaining -= expandedWeight) < 0) return false;
  const kind = collection ? type.element : type.base;
  if (type.enum && (!INTEGERS.has(kind) || !enums.has(type.enum))) return false;
  if (SCALARS.has(kind)) return true;
  if (kind !== 'Obj') return false;
  const object = type.object ? objects.get(type.object) : undefined;
  return !!object && isObjectFieldShaped(object, objects, enums, seen, budget, expandedWeight);
}
function isObjectFieldShaped(
  object: NodosObjectType,
  objects: Map<string, NodosObjectType>,
  enums: Map<string, NodosEnumType>,
  seen = new Set<string>(),
  budget = { remaining: MAX_EXPANDED_FIELDS },
  weight = 1,
): boolean {
  if (seen.has(object.name) || seen.size >= MAX_TYPE_DEPTH) return false;
  seen.add(object.name);
  const fields = object.fields.filter((field) => !field.deprecated);
  const shaped =
    !('resource' in object.attributes) &&
    fields.length > 0 &&
    new Set(fields.map((field) => field.name)).size === fields.length &&
    fields.every(
      (field) =>
        typeof field.name === 'string' &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name) &&
        !RESERVED_KEYS.has(field.name) &&
        !field.dynamic &&
        isFieldShaped(field.type, objects, enums, seen, budget, weight),
    );
  seen.delete(object.name);
  return shaped;
}

/** Disable/disconnect invalidates pending responses as well as the visible old engine catalog. */
export function clearNodosTypes(message = ''): void {
  requestVersion++;
  selectedAddress = null;
  useNodosTypes.setState({
    address: null,
    objects: new Map(),
    enums: new Map(),
    choices: [],
    message,
  });
}

/** Fetches the types of the Nodos engine at `address` for data fields to choose from. */
export async function loadNodosTypes(address: string): Promise<void> {
  const nextAddress = address.trim();
  if (!nextAddress) {
    clearNodosTypes();
    return;
  }
  const version = ++requestVersion;
  selectedAddress = nextAddress;
  useNodosTypes.setState({
    address: nextAddress,
    objects: new Map(),
    enums: new Map(),
    choices: [],
    message: 'Loading Nodos types…',
  });
  try {
    const result = await requestNodosTypes(nextAddress);
    if (version !== requestVersion || selectedAddress !== nextAddress) return;
    if (result.ok) setNodosTypes(result, nextAddress);
    else useNodosTypes.setState({ message: result.message });
  } catch (error) {
    if (version === requestVersion && selectedAddress === nextAddress)
      useNodosTypes.setState({ message: error instanceof Error ? error.message : String(error) });
  }
}

/** Takes the engine's types, as Studio's server sends them whenever the engine does. */
export function setNodosTypes(types: NodosTypeList, address: string): void {
  if (selectedAddress === null || address.trim() !== selectedAddress) return;
  // A pushed update is newer than an outstanding type-list response from this engine.
  requestVersion++;
  const objects = new Map(
    (Array.isArray(types.objects) ? types.objects : [])
      .filter(
        (object) =>
          object &&
          isNodosTypeName(object.name) &&
          object.attributes &&
          typeof object.attributes === 'object' &&
          !Array.isArray(object.attributes) &&
          Array.isArray(object.fields) &&
          object.fields.every(
            (field) =>
              field &&
              typeof field.name === 'string' &&
              field.type &&
              typeof field.type === 'object',
          ),
      )
      .map((object) => [object.name, object]),
  );
  const enums = new Map(
    (Array.isArray(types.enums) ? types.enums : [])
      .filter(
        (entry) =>
          entry &&
          !entry.isUnion &&
          isNodosTypeName(entry.name) &&
          Array.isArray(entry.values) &&
          entry.values.length > 0 &&
          entry.values.length <= MAX_EXPANDED_FIELDS &&
          entry.values.every((value) => typeof value === 'string' && !!value) &&
          new Set(entry.values).size === entry.values.length,
      )
      .map((entry) => [entry.name, entry]),
  );
  // nos.Dict is what a plain object becomes anyway.
  const choices = [
    ...[...objects.values()]
      .filter((object) => object.name !== 'nos.Dict' && isObjectFieldShaped(object, objects, enums))
      .map((object) => object.name),
    ...enums.keys(),
  ].sort();
  useNodosTypes.setState({ address: selectedAddress, objects, enums, choices, message: '' });
}

/** The OGraf field a Nodos type's values fit, for one field of a struct or table. */
function fieldForType(key: string, type: NodosFieldType): FieldDefinition {
  const { objects, enums } = useNodosTypes.getState();
  const fixed =
    type.base === 'Array' ? { minItems: type.fixedLength, maxItems: type.fixedLength } : null;
  if (type.base === 'Vector' || type.base === 'Array') {
    const items = fieldForType('item', {
      ...type,
      base: type.element,
      element: 'None',
      fixedLength: 0,
    });
    return createFieldDefinition('array', {
      key,
      label: key,
      items,
      defaultValue: fixed
        ? Array.from({ length: type.fixedLength }, () => structuredClone(items.defaultValue))
        : [],
      ...(fixed ? { constraints: fixed } : {}),
    });
  }
  if (type.enum && enums.has(type.enum)) return selectField(key, enums.get(type.enum)!);
  if (type.base === 'Obj' && type.object && objects.has(type.object))
    return objectField(key, objects.get(type.object)!);
  const fieldType: FieldType =
    type.base === 'Bool'
      ? 'boolean'
      : INTEGERS.has(type.base)
        ? 'integer'
        : type.base === 'Float' || type.base === 'Double'
          ? 'number'
          : 'text';
  const range = INTEGER_RANGES[type.base];
  return createFieldDefinition(fieldType, {
    key,
    label: key,
    ...(range ? { constraints: { minimum: range[0], maximum: range[1], step: 1 } } : {}),
    ...(type.base === 'Float'
      ? { constraints: { minimum: -3.4028234663852886e38, maximum: 3.4028234663852886e38 } }
      : {}),
  });
}

function selectField(key: string, enumeration: NodosEnumType): FieldDefinition {
  const options = enumeration.values.map((value) => ({ value, label: value }));
  return createFieldDefinition('select', {
    key,
    label: key,
    options,
    defaultValue: options[0]?.value ?? '',
    nodosType: enumeration.name,
  });
}

function objectField(key: string, object: NodosObjectType): FieldDefinition {
  const properties = object.fields
    .filter((field) => !field.deprecated)
    .map((field) => fieldForType(field.name, field.type));
  const defaultValue: Record<string, FieldValue> = Object.fromEntries(
    properties.map((property) => [property.key, property.defaultValue]),
  );
  return createFieldDefinition('object', {
    key,
    label: key,
    properties,
    defaultValue,
    nodosType: object.name,
  });
}

function preserveExposure(field: FieldDefinition, previous: FieldDefinition | undefined): void {
  if (!previous) return;
  field.id = previous.id;
  if (previous.exposeToOgraf !== undefined) field.exposeToOgraf = previous.exposeToOgraf;
  for (const property of field.properties)
    preserveExposure(
      property,
      previous.properties.find((candidate) => candidate.key === property.key),
    );
  if (field.items) preserveExposure(field.items, previous.items ?? undefined);
}

/**
 * The structure a field takes from a Nodos type: a struct or table becomes an object of its fields, an enum a select
 * of its values. Fields keep their key and label; the rest follows the type.
 */
export function fieldStructureForNodosType(
  typeName: string,
  key: string,
  previous?: FieldDefinition,
): Pick<
  FieldDefinition,
  | 'type'
  | 'options'
  | 'constraints'
  | 'fileExtensions'
  | 'defaultValue'
  | 'properties'
  | 'items'
  | 'nodosType'
> {
  const { objects, enums, choices } = useNodosTypes.getState();
  if (!choices.includes(typeName))
    throw new Error(`Nodos type "${typeName}" is unavailable or is not supported as a data field.`);
  const field = enums.has(typeName)
    ? selectField(key, enums.get(typeName)!)
    : objectField(key, objects.get(typeName)!);
  preserveExposure(field, previous);
  return {
    type: field.type,
    options: field.options,
    constraints: field.constraints,
    fileExtensions: [],
    defaultValue: field.defaultValue,
    properties: field.properties,
    items: field.items,
    nodosType: typeName,
  };
}
