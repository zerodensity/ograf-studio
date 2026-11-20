export const OUTPUT_LAYER_ERROR =
  'Output layer must be a safe integer between -9007199254740991 and 9007199254740991.';

export function isOutputLayer(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

/** Host-compatible fallback for absent or invalid imported manifest metadata. */
export function resolveOutputLayer(value: unknown): number {
  return isOutputLayer(value) ? value || 0 : 0;
}

/** Authored values must be valid before any document state is changed. */
export function requireOutputLayer(value: unknown): number {
  if (!isOutputLayer(value)) throw new Error(OUTPUT_LAYER_ERROR);
  return value || 0;
}
