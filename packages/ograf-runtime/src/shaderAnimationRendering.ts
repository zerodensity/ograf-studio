import {
  applyShaderAnimationValues,
  hasElementShaderPaint,
  sampleShaderAnimationValues,
  type Element,
  type LayerAnimationTracks,
} from '@ograf-editor/scene-model';
import { updateShaderPaintUniforms } from './shaderPaintRendering';
import { updateShaderParameters } from './shaderRendering';

interface ShaderAnimationBase {
  element: Element;
  lastSample?: string;
}
const bases = new WeakMap<HTMLElement, ShaderAnimationBase>();

/** The baseline is authored paint plus current data, never a previously animated sample. */
export function rememberShaderAnimationBase(container: HTMLElement, element: Element): void {
  if (hasElementShaderPaint(element)) bases.set(container, { element });
  else bases.delete(container);
}

export function forgetShaderAnimationBase(container: HTMLElement): void {
  bases.delete(container);
}

export function applyShaderPaintTracks(
  container: HTMLElement,
  tracks: LayerAnimationTracks,
  frame: number,
): void {
  const base = bases.get(container);
  if (!base) return;
  const values = sampleShaderAnimationValues(base.element, tracks, frame);
  const signature = JSON.stringify(values);
  if (signature === base.lastSample) return;
  if (base.lastSample === undefined && Object.keys(values).length === 0) {
    base.lastSample = signature;
    return;
  }
  const animated = applyShaderAnimationValues(base.element, values);
  const updated =
    animated.type === 'shader'
      ? updateShaderParameters(container, animated)
      : updateShaderPaintUniforms(container, animated);
  if (updated) base.lastSample = signature;
}
