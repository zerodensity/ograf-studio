import { layerCropPolygon, type LayerCrop } from '@ograf-editor/scene-model';

/** Reveal state can change while a shader stack is parked at one lifecycle timestamp. */
export const REVEAL_CHANGED_EVENT = 'ograf-reveal-changed';
export type RevealInsets = [top: number, right: number, bottom: number, left: number];

/** Runtime layers own the metadata; Studio's inner content host may own it instead. */
export function revealInsetsSignature(host: HTMLElement): string | undefined {
  if (host.dataset?.ografRevealInsets !== undefined) return host.dataset.ografRevealInsets;
  const content = Array.from(host.children ?? []).find(
    (child) =>
      child.classList?.contains('layer-content-host') ||
      (typeof child.className === 'string' &&
        child.className.split(/\s+/).includes('layer-content-host')),
  ) as HTMLElement | undefined;
  return content?.dataset?.ografRevealInsets;
}

/** Child wipes change a composited input but must not become a clip on the entire parent. */
export function revealSourceSignature(host: HTMLElement): string[] {
  return [host, ...Array.from(host.querySelectorAll?.<HTMLElement>('*') ?? [])].flatMap((element) =>
    [element.dataset?.ografRevealInsets, element.dataset?.ografLayerCrop].filter(
      (value): value is string => value !== undefined,
    ),
  );
}

function revealInsets(host: HTMLElement): RevealInsets | undefined {
  const serialized = revealInsetsSignature(host);
  if (!serialized) return undefined;
  try {
    const values: unknown = JSON.parse(serialized);
    if (
      !Array.isArray(values) ||
      values.length !== 4 ||
      values.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    )
      return undefined;
    return values.map((value) => Math.max(0, Math.min(1, value as number))) as RevealInsets;
  } catch {
    return undefined;
  }
}

/** Clip composited output on its wipe planes without changing the host's parent/matte clip. */
export function applyRevealToComposite(host: HTMLElement, output: HTMLCanvasElement): void {
  const insets = revealInsets(host);
  let clip = '';
  const content = Array.from(host.children ?? []).find((child) =>
    child.classList?.contains('layer-content-host'),
  ) as HTMLElement | undefined;
  const cropPoints = host.dataset?.ografLayerCrop ?? content?.dataset?.ografLayerCrop;
  if (cropPoints) {
    const crop: LayerCrop = { points: JSON.parse(cropPoints) };
    const points = layerCropPolygon(crop, insets);
    const width = Number.parseFloat(host.style.width) || host.clientWidth || 1;
    const height = Number.parseFloat(host.style.height) || host.clientHeight || 1;
    const paddingX = -(Number.parseFloat(output.style.left) || 0);
    const paddingY = -(Number.parseFloat(output.style.top) || 0);
    clip = points.length
      ? `polygon(${points.map((point) => `${paddingX + point.x * width}px ${paddingY + point.y * height}px`).join(', ')})`
      : 'inset(0% 100% 0% 0%)';
  } else if (insets?.some((value) => value > 0)) {
    const [top, right, bottom, left] = insets;
    if (top + bottom >= 1 || left + right >= 1) clip = 'inset(0% 100% 0% 0%)';
    else {
      const width = Number.parseFloat(host.style.width) || host.clientWidth || 1;
      const height = Number.parseFloat(host.style.height) || host.clientHeight || 1;
      const horizontalPadding = Math.max(0, -(Number.parseFloat(output.style.left) || 0));
      const verticalPadding = Math.max(0, -(Number.parseFloat(output.style.top) || 0));
      // Zero-inset sides keep their existing effect padding. Moving wipe planes use layer pixels.
      const t = top > 0 ? verticalPadding + top * height : 0;
      const r = right > 0 ? horizontalPadding + right * width : 0;
      const b = bottom > 0 ? verticalPadding + bottom * height : 0;
      const l = left > 0 ? horizontalPadding + left * width : 0;
      clip = `inset(${t}px ${r}px ${b}px ${l}px)`;
    }
  }
  if (clip) {
    output.style.clipPath = clip;
    output.dataset.ografRevealClip = 'true';
  } else if (output.dataset.ografRevealClip) {
    output.style.clipPath = '';
    delete output.dataset.ografRevealClip;
  }
}
