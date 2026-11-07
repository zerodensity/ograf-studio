import type { FieldDefinition, FieldObjectValue, FieldValue } from '@ograf-editor/scene-model';

function isRecord(value: FieldValue | undefined): value is FieldObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Fill cleared preview leaves from the current default without extending preview arrays. */
function mergePreviewValue(
  defaultValue: FieldValue | undefined,
  previewValue: FieldValue | undefined,
): FieldValue | undefined {
  if (previewValue === undefined) return defaultValue;
  if (Array.isArray(previewValue)) {
    if (!Array.isArray(defaultValue)) return previewValue;
    let result = previewValue;
    for (let index = 0; index < previewValue.length; index += 1) {
      const value = mergePreviewValue(defaultValue[index], previewValue[index]);
      if (value !== previewValue[index]) {
        if (result === previewValue) result = [...previewValue];
        result[index] = value!;
      }
    }
    return result;
  }
  if (!isRecord(previewValue) || !isRecord(defaultValue)) return previewValue;
  let result = previewValue;
  for (const key of Object.keys(defaultValue)) {
    const current = Object.hasOwn(previewValue, key) ? previewValue[key] : undefined;
    const value = mergePreviewValue(defaultValue[key], current);
    if (!Object.hasOwn(previewValue, key) || value !== current) {
      if (result === previewValue) result = { ...previewValue };
      result[key] = value!;
    }
  }
  return result;
}

/** Preview edits can be partial so authored defaults remain visible after undo and redo. */
export function resolvePreviewFieldValue(
  field: FieldDefinition | undefined,
  previewValue: FieldValue | undefined,
): FieldValue | undefined {
  return mergePreviewValue(field?.defaultValue, previewValue);
}

/**
 * Clear one absolute source-path override, preserving siblings and array lengths.
 * An empty path clears the whole field; ['0', 'title'] clears the first item's title.
 */
export function clearPreviewPath(
  previewValue: FieldValue | undefined,
  sourcePath: readonly string[],
): FieldValue | undefined {
  if (!sourcePath.length) return undefined;
  if (previewValue === undefined || previewValue === null || typeof previewValue !== 'object')
    return undefined;
  const [key, ...remaining] = sourcePath;
  if (!Object.hasOwn(previewValue, key!)) return previewValue;
  const record = previewValue as Record<string, FieldValue>;
  const next = clearPreviewPath(record[key!], remaining);
  if (remaining.length && next === record[key!]) return previewValue;
  const result = Array.isArray(previewValue) ? [...previewValue] : { ...previewValue };
  if (next === undefined) delete (result as Record<string, FieldValue>)[key!];
  else (result as Record<string, FieldValue>)[key!] = next;
  return result;
}
