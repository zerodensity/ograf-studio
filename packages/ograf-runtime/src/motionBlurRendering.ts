import {
  getLoopFrameAtElapsed,
  getTrackValueAtFrame,
  layerTransformBindingChannel,
  type LayerTransform,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
export interface MotionBlurSample {
  dx: number;
  dy: number;
  shutterAngle: number;
}
/** Frame-addressed forward difference, independent of playback order or elapsed wall clock. */
export function sampleMotionBlur(
  layer: CompiledLayer,
  frame: number,
  loopElapsedFrames: number | undefined,
  initial: LayerTransform,
): MotionBlurSample | undefined {
  const setting = layer.motionBlur;
  if (!setting?.enabled || !Number.isFinite(setting.shutterAngle) || setting.shutterAngle <= 0)
    return undefined;
  // A motion path overrides authored X/Y; do not blur using a velocity that is not visible.
  if (layer.motionPath) return undefined;
  const bound = new Set(
    (layer.bindings ?? (layer.binding ? [layer.binding] : [])).map((item) =>
      layerTransformBindingChannel(item.targetProperty),
    ),
  );
  const position = (property: 'x' | 'y', at: number, elapsed: number | undefined) => {
    const base = getTrackValueAtFrame(layer.animationTracks[property] ?? [], at, initial[property]);
    const keys = layer.loop?.tracks[property] ?? [];
    return layer.loop && elapsed !== undefined && keys.length
      ? getTrackValueAtFrame(keys, getLoopFrameAtElapsed(layer.loop, elapsed), base)
      : base;
  };
  const velocity = (property: 'x' | 'y') =>
    bound.has(property)
      ? 0
      : position(
          property,
          frame + 1,
          loopElapsedFrames === undefined ? undefined : loopElapsedFrames + 1,
        ) - position(property, frame, loopElapsedFrames);
  const dx = velocity('x'),
    dy = velocity('y');
  return Math.hypot(dx, dy) < 0.05
    ? undefined
    : { dx, dy, shutterAngle: Math.max(0, Math.min(360, setting.shutterAngle)) };
}
/** A bounded symmetric 9-tap convolution along the sampled movement vector. */
export function motionBlurKernel(sample: MotionBlurSample) {
  const length = Math.min(40, (Math.hypot(sample.dx, sample.dy) * sample.shutterAngle) / 360);
  const denominator = Math.max(Math.abs(sample.dx), Math.abs(sample.dy));
  const kernel = Array.from({ length: 81 }, () => 0);
  if (denominator > 0)
    for (let i = -4; i <= 4; i++) {
      const x = Math.round((i * sample.dx) / denominator) + 4,
        y = Math.round((i * sample.dy) / denominator) + 4;
      kernel[y * 9 + x] = 1;
    }
  return {
    kernel: kernel.join(' '),
    unit: Math.max(0.1, length / 8),
    padding: Math.ceil(length) + 3,
  };
}
const filters = new WeakMap<
  HTMLElement,
  {
    svg: SVGSVGElement;
    filter: SVGFilterElement;
    convolve: SVGElement;
    id: string;
    signature: string;
  }
>();
let nextId = 0;
/** Append to the existing effect filter; no canvas readback and no effect when the layer is still. */
export function applyMotionBlur(host: HTMLElement, sample: MotionBlurSample | undefined): void {
  let entry = filters.get(host);
  if (!sample) {
    if (entry) {
      entry.svg.remove();
      filters.delete(host);
    }
    return;
  }
  if (!entry) {
    const doc = host.ownerDocument,
      ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.dataset.ografRuntimeAuxiliary = 'true';
    Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden' });
    const filter = doc.createElementNS(ns, 'filter');
    const id = `ograf-motion-${nextId++}`;
    filter.id = id;
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const convolve = doc.createElementNS(ns, 'feConvolveMatrix');
    convolve.setAttribute('order', '9');
    convolve.setAttribute('divisor', '9');
    convolve.setAttribute('edgeMode', 'none');
    filter.appendChild(convolve);
    svg.appendChild(filter);
    host.appendChild(svg);
    entry = { svg, filter, convolve, id, signature: '' };
    filters.set(host, entry);
  }
  if (entry.svg.parentNode !== host) host.appendChild(entry.svg);
  const kernel = motionBlurKernel(sample),
    width = Number.parseFloat(host.style.width) || host.clientWidth || 1,
    height = Number.parseFloat(host.style.height) || host.clientHeight || 1;
  const signature = JSON.stringify([kernel, width, height]);
  if (signature !== entry.signature) {
    entry.convolve.setAttribute('kernelMatrix', kernel.kernel);
    entry.convolve.setAttribute('kernelUnitLength', String(kernel.unit));
    entry.filter.setAttribute('x', String(-kernel.padding));
    entry.filter.setAttribute('y', String(-kernel.padding));
    entry.filter.setAttribute('width', String(width + 2 * kernel.padding));
    entry.filter.setAttribute('height', String(height + 2 * kernel.padding));
    entry.signature = signature;
  }
  const base = host.style.filter;
  host.style.filter = `${base && base !== 'none' ? base + ' ' : ''}url("#${entry.id}")`;
}
