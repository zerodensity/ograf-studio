import type { Composition, LogicFunctionDefinition } from './types';

export const MAX_LOGIC_FUNCTIONS = 8;
export const MAX_LOGIC_FUNCTION_SOURCE_BYTES = 128 * 1024;
export const MAX_LOGIC_FUNCTION_STATE_BYTES = 256 * 1024;
export const DEFAULT_LOGIC_FUNCTION_TIMEOUT_MS = 250;
export const LOGIC_FUNCTION_EVENT_TYPES = [
  'custom-action',
  'tick',
  'load',
  'play',
  'out',
  'data',
  'blur',
  'focus',
] as const;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

export function isLogicFunctionAlias(value: string): boolean {
  return (
    value.length <= 128 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !forbiddenKeys.has(value)
  );
}

/** Bounded JSON only: state is cloned across the Worker boundary and never carries capabilities. */
export function logicFunctionJsonErrors(
  value: unknown,
  maxBytes = MAX_LOGIC_FUNCTION_STATE_BYTES,
): string[] {
  const visiting = new Set<object>();
  let nodes = 0;
  const valid = (entry: unknown, depth: number): boolean => {
    if (++nodes > 32768 || depth > 32) return false;
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'string') return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (!entry || typeof entry !== 'object' || visiting.has(entry)) return false;
    if (
      !Array.isArray(entry) &&
      Object.getPrototypeOf(entry) !== Object.prototype &&
      Object.getPrototypeOf(entry) !== null
    )
      return false;
    visiting.add(entry);
    // Do not invoke accessors or silently drop symbols/extra array properties during validation.
    const properties = Object.getOwnPropertyDescriptors(entry);
    const keys = Reflect.ownKeys(properties);
    let result = true;
    if (Array.isArray(entry)) {
      const length = properties.length?.value;
      result = Number.isInteger(length) && length >= 0 && length <= 32768;
      if (result)
        for (let index = 0; index < length; index++) {
          const property = properties[String(index)];
          if (
            !property ||
            !Object.hasOwn(property, 'value') ||
            !property.enumerable ||
            !valid(property.value, depth + 1)
          ) {
            result = false;
            break;
          }
        }
      if (result)
        result = keys.every(
          (key) =>
            key === 'length' ||
            (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length),
        );
    } else
      result = keys.every((key) => {
        if (typeof key !== 'string' || forbiddenKeys.has(key)) return false;
        const property = properties[key]!;
        return (
          Object.hasOwn(property, 'value') &&
          property.enumerable &&
          valid(property.value, depth + 1)
        );
      });
    visiting.delete(entry);
    return result;
  };
  try {
    if (!valid(value, 0))
      return [
        'Function state must be bounded, finite JSON without cycles, accessors, sparse arrays or reserved object keys.',
      ];
  } catch {
    return ['Function state must be readable plain JSON without accessors.'];
  }
  if (utf8Bytes(JSON.stringify(value)) > maxBytes)
    return [`Function state exceeds ${maxBytes} UTF-8 bytes.`];
  return [];
}

function mappingErrors(value: unknown, label: string, maximum: number): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return [`${label} must be an alias-to-ID object.`];
  const entries = Object.entries(value);
  const errors: string[] = [];
  if (entries.length > maximum) errors.push(`${label} supports at most ${maximum} aliases.`);
  for (const [alias, target] of entries) {
    if (!isLogicFunctionAlias(alias))
      errors.push(`${label} alias ${alias} must be a safe JavaScript identifier.`);
    if (typeof target !== 'string' || !target.trim() || target.length > 256)
      errors.push(`${label} alias ${alias} needs a nonempty reference ID.`);
  }
  return errors;
}
function values(mapping: unknown): string[] {
  return mapping && typeof mapping === 'object' && !Array.isArray(mapping)
    ? Object.values(mapping).filter((value): value is string => typeof value === 'string')
    : [];
}
export function logicFunctionFieldIds(definition: LogicFunctionDefinition): string[] {
  return [...new Set([...values(definition.inputs), ...values(definition.outputs)])];
}
export function logicFunctionActionIds(definition: LogicFunctionDefinition): string[] {
  return [
    ...new Set([
      ...(Array.isArray(definition.actions) ? definition.actions : []),
      ...values(definition.emits),
    ]),
  ];
}
export function logicFunctionCueIds(definition: LogicFunctionDefinition): string[] {
  return [...new Set(values(definition.media))];
}

export function validateLogicFunctionDefinitions(
  definitions: unknown,
  composition: Pick<Composition, 'dataFields' | 'customActions' | 'mediaCues'>,
): string[] {
  if (definitions === undefined) return [];
  if (!Array.isArray(definitions)) return ['Functions must be an array.'];
  const errors: string[] = [];
  if (definitions.length > MAX_LOGIC_FUNCTIONS)
    errors.push(`A composition supports at most ${MAX_LOGIC_FUNCTIONS} functions.`);
  const ids = new Set<string>(),
    names = new Set<string>(),
    writers = new Set<string>();
  const fields = new Set(composition.dataFields.map((field) => field.id));
  const actions = new Set(composition.customActions.map((action) => action.actionId));
  const cues = new Set(composition.mediaCues.map((cue) => cue.id));
  for (const [index, raw] of definitions.entries()) {
    const label = `Function ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    const definition = raw as LogicFunctionDefinition;
    if (
      Object.keys(raw).some(
        (key) =>
          ![
            'type',
            'version',
            'id',
            'name',
            'enabled',
            'pointer',
            'source',
            'inputs',
            'outputs',
            'actions',
            'emits',
            'media',
            'initialState',
            'timeoutMs',
          ].includes(key),
      )
    )
      errors.push(`${label} contains unsupported settings.`);
    if (definition.type !== 'javascript' || definition.version !== 1)
      errors.push(`${label} must use javascript version 1.`);
    for (const [key, seen] of [
      ['id', ids],
      ['name', names],
    ] as const) {
      const value = definition[key];
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > 128 ||
        (key === 'id' && forbiddenKeys.has(value))
      )
        errors.push(`${label} requires a nonempty safe ${key} of at most 128 characters.`);
      else {
        const identity = key === 'name' ? value.trim().toLowerCase() : value;
        if (seen.has(identity)) errors.push(`${label} repeats ${key} ${value}.`);
        seen.add(identity);
      }
    }
    if (typeof definition.enabled !== 'boolean') errors.push(`${label} enabled must be a boolean.`);
    if (definition.pointer !== undefined && typeof definition.pointer !== 'boolean')
      errors.push(`${label} pointer must be a boolean.`);
    if (
      typeof definition.source !== 'string' ||
      !definition.source.trim() ||
      utf8Bytes(definition.source) > MAX_LOGIC_FUNCTION_SOURCE_BYTES
    )
      errors.push(
        `${label} source must be a nonempty function expression of at most ${MAX_LOGIC_FUNCTION_SOURCE_BYTES} UTF-8 bytes.`,
      );
    for (const key of ['inputs', 'outputs'] as const)
      errors.push(...mappingErrors(definition[key], `${label} ${key}`, 128));
    for (const key of ['emits', 'media'] as const)
      if (definition[key] !== undefined)
        errors.push(...mappingErrors(definition[key], `${label} ${key}`, 64));
    for (const fieldId of logicFunctionFieldIds(definition))
      if (!fields.has(fieldId)) errors.push(`${label} references missing data field ${fieldId}.`);
    for (const fieldId of values(definition.outputs)) {
      if (writers.has(fieldId))
        errors.push(`${label} output field ${fieldId} has more than one function writer.`);
      writers.add(fieldId);
    }
    if (
      !Array.isArray(definition.actions) ||
      definition.actions.length > 128 ||
      definition.actions.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256)
    )
      errors.push(`${label} actions must contain at most 128 custom-action IDs.`);
    else if (new Set(definition.actions).size !== definition.actions.length)
      errors.push(`${label} listens to a custom action more than once.`);
    for (const actionId of logicFunctionActionIds(definition))
      if (!actions.has(actionId))
        errors.push(`${label} references missing custom action ${actionId}.`);
    for (const cueId of logicFunctionCueIds(definition))
      if (!cues.has(cueId)) errors.push(`${label} references missing media cue ${cueId}.`);
    if (definition.initialState !== undefined)
      errors.push(
        ...logicFunctionJsonErrors(definition.initialState).map((error) => `${label}: ${error}`),
      );
    if (
      definition.timeoutMs !== undefined &&
      (!Number.isInteger(definition.timeoutMs) ||
        definition.timeoutMs < 16 ||
        definition.timeoutMs > 1000)
    )
      errors.push(`${label} timeoutMs must be an integer from 16 through 1000.`);
  }
  return errors;
}

export function assertLogicFunctionReferenceRemovable(
  composition: Pick<Composition, 'functions'>,
  kind: 'field' | 'action' | 'cue',
  id: string,
): void {
  const owner = (Array.isArray(composition.functions) ? composition.functions : []).find(
    (definition) =>
      definition &&
      (kind === 'field'
        ? logicFunctionFieldIds(definition)
        : kind === 'action'
          ? logicFunctionActionIds(definition)
          : logicFunctionCueIds(definition)
      ).includes(id),
  );
  if (owner)
    throw new Error(
      `Cannot remove or rename ${kind} ${id}: it is used by function ${owner.name || owner.id}. Remove or reconfigure the function first.`,
    );
}
