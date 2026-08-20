import { resolveAssetValue, type Composition, type FieldValue } from '@ograf-editor/scene-model';

function hasOwn(record: Record<string, FieldValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function resolveFieldValue(
  composition: Composition,
  field: Composition['dataFields'][number],
  value: FieldValue,
): FieldValue {
  return field.type === 'image-url' && typeof value === 'string'
    ? resolveAssetValue(value, composition.assets)
    : value;
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
