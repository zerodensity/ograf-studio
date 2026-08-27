import { resolveAssetValue, type Composition, type FieldValue } from '@ograf-editor/scene-model';

function hasOwn(record: Record<string, FieldValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function resolveFieldValue(
  composition: Composition,
  field: Composition['dataFields'][number],
  value: FieldValue,
): FieldValue {
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
      const value = hasOwn(testValuesByFieldId, field.id)
        ? testValuesByFieldId[field.id]!
        : field.defaultValue;
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
