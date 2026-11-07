import {
  resolveAssetValue,
  applyElementDataValue,
  resolveElementAssetReferences,
  type Composition,
  type FieldDefinition,
  type FieldValue,
} from '@ograf-editor/scene-model';
import { resolvePreviewFieldValue } from './previewFieldValue';

function hasOwn(record: Record<string, FieldValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function tickerFeedLayer(composition: Pick<Composition, 'layers'> | undefined, fieldId: string) {
  return composition?.layers.find(
    (layer) =>
      layer.element.type === 'ticker' &&
      layer.bindings.some(
        (binding) =>
          binding.fieldId === fieldId &&
          binding.targetProperty === 'items' &&
          !binding.sourcePath?.length,
      ),
  );
}

function previewFieldValue(
  composition: Pick<Composition, 'layers'> | undefined,
  field: FieldDefinition,
  value: FieldValue | undefined,
): FieldValue {
  // A feed is an ordered replacement keyed by item ID. Merging defaults by array index can
  // attach a removed entry's optional artwork or animation to a newly inserted item.
  return value !== undefined && tickerFeedLayer(composition, field.id)
    ? value
    : resolvePreviewFieldValue(field, value)!;
}

/** Keeps the Preview & Export form compatible with the current field definition after schema edits. */
export function resolvePreviewFormValue(
  field: FieldDefinition,
  testValue: FieldValue | undefined,
): FieldValue {
  if (field.type === 'boolean') {
    const value = resolvePreviewFieldValue(field, testValue);
    if (typeof value === 'boolean') return value;
    // Values entered in the former text control may still be present in a live session.
    if (typeof value === 'string') {
      const literal = value.trim().toLowerCase();
      if (literal === 'true' || literal === 'false') return literal === 'true';
    }
    return field.defaultValue === true;
  }
  if (
    field.type === 'select' &&
    (typeof testValue !== 'string' || !field.options.some((option) => option.value === testValue))
  )
    return field.defaultValue;
  return resolvePreviewFieldValue(field, testValue)!;
}

export interface PreviewDataFormSession {
  sessionKey: string;
  fields: readonly FieldDefinition[];
  values: Record<string, FieldValue>;
}

/** Resolve before loading a preview so a newly selected template never receives the previous
 * template's values when both happen to use the same field keys. Schema edits also start a fresh
 * form; ordinary renders preserve the current operator input. Pass null to reset explicitly. */
export function resolvePreviewDataFormSession(
  current: PreviewDataFormSession | null,
  sessionKey: string,
  fields: readonly FieldDefinition[],
  testValuesByFieldId: Record<string, FieldValue>,
  composition?: Pick<Composition, 'layers'>,
): PreviewDataFormSession {
  if (current?.sessionKey === sessionKey && current.fields === fields) return current;
  return {
    sessionKey,
    fields,
    values: Object.fromEntries(
      fields.map((field) => [
        field.key,
        tickerFeedLayer(composition, field.id)
          ? previewFieldValue(composition, field, testValuesByFieldId[field.id])
          : resolvePreviewFormValue(field, testValuesByFieldId[field.id]),
      ]),
    ),
  };
}

function resolveFieldValue(
  composition: Composition,
  field: Composition['dataFields'][number],
  value: FieldValue,
): FieldValue {
  const ticker = tickerFeedLayer(composition, field.id);
  if (ticker) {
    const resolved = resolveElementAssetReferences(
      applyElementDataValue(ticker.element, 'items', value),
      composition.assets,
    );
    if (resolved.type === 'ticker') return resolved.items as unknown as FieldValue;
  }
  if (field.type === 'boolean') return resolvePreviewFormValue(field, value);
  if (field.type === 'image-url' && typeof value === 'string') {
    return resolveAssetValue(value, composition.assets);
  }
  if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, FieldValue>;
    return Object.fromEntries(
      Object.entries(record).map(([key, childValue]) => {
        const child = field.properties.find((property) => property.key === key);
        return [key, child ? resolveFieldValue(composition, child, childValue) : childValue];
      }),
    );
  }
  if (field.type === 'array' && field.items && Array.isArray(value)) {
    return value.map((item) => resolveFieldValue(composition, field.items!, item));
  }
  return value;
}

/** Builds the data payload used by in-editor runtime previews. Test values win over declared field
 * defaults, and editor-only `asset:<id>` image values become browser-loadable data URIs. */
export function buildPreviewDataFromTestValues(
  composition: Composition,
  testValuesByFieldId: Record<string, FieldValue>,
): Record<string, FieldValue> {
  return Object.fromEntries(
    composition.dataFields.map((field) => {
      const value = previewFieldValue(composition, field, testValuesByFieldId[field.id]);
      return [field.key, resolveFieldValue(composition, field, value)];
    }),
  );
}

/** Resolves a key-addressed data form before it is sent to the in-browser Graphic instance. */
export function resolvePreviewDataRecord(
  composition: Composition,
  valuesByFieldKey: Record<string, FieldValue>,
): Record<string, FieldValue> {
  return Object.fromEntries(
    composition.dataFields.map((field) => {
      const value = hasOwn(valuesByFieldKey, field.key)
        ? valuesByFieldKey[field.key]!
        : field.defaultValue;
      return [field.key, resolveFieldValue(composition, field, value)];
    }),
  );
}

/** Narrow JSON received from the runtime before it enters the typed operator form. */
export function resolveRuntimePreviewDataRecord(
  composition: Composition,
  data: Record<string, unknown>,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  const seen = new Set<object>();
  let visited = 0;
  const isValue = (value: unknown, depth = 0): value is FieldValue => {
    if (++visited > 4096 || depth > 16) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || seen.has(value)) return false;
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false;
    seen.add(value);
    const valid = Object.values(value).every((child) => isValue(child, depth + 1));
    seen.delete(value);
    return valid;
  };
  for (const field of composition.dataFields) {
    const value = data[field.key];
    if (Object.hasOwn(data, field.key) && isValue(value)) values[field.key] = value;
  }
  return resolvePreviewDataRecord(composition, values);
}

/** Standalone form defaults must not overwrite a named state's editorial preset on first Take. */
export function resolveStatePresetPreviewData(
  composition: Composition,
  preset: Record<string, unknown> | undefined,
  formData: Record<string, FieldValue> = {},
  testValuesByFieldId: Record<string, FieldValue> = {},
): Record<string, FieldValue> {
  const base = resolvePreviewDataRecord(composition, {});
  if (!preset)
    return resolvePreviewDataRecord(composition, {
      ...buildPreviewDataFromTestValues(composition, testValuesByFieldId),
      ...formData,
    });
  const explicit = Object.fromEntries(
    composition.dataFields.flatMap((field) => {
      if (
        Object.hasOwn(formData, field.key) &&
        JSON.stringify(formData[field.key]) !== JSON.stringify(base[field.key])
      )
        return [[field.key, formData[field.key]!]];
      if (Object.hasOwn(testValuesByFieldId, field.id))
        return [[field.key, testValuesByFieldId[field.id]!]];
      return [];
    }),
  );
  return resolveRuntimePreviewDataRecord(composition, { ...base, ...preset, ...explicit });
}
