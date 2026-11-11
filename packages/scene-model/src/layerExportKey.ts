export const MAX_LAYER_EXPORT_KEY_LENGTH = 64;

/** Validate the stored value. The authoring editor trims input before storing it. */
export function layerExportKeyError(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length > MAX_LAYER_EXPORT_KEY_LENGTH ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
  )
    return `An export key must start with a letter and contain up to ${MAX_LAYER_EXPORT_KEY_LENGTH} letters, numbers, underscores, or hyphens.`;
  return undefined;
}
