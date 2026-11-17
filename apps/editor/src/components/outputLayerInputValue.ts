import { isOutputLayer, resolveOutputLayer } from '@ograf-editor/scene-model';

const INTEGER_TEXT = /^[+-]?\d+$/;

/** Check text before conversion so fractions near the safe limit cannot round up. */
export function parseOutputLayerInput(text: string): number | null {
  if (!INTEGER_TEXT.test(text)) return null;
  const value = Number(text);
  return isOutputLayer(value) ? resolveOutputLayer(value) : null;
}
