// The drawer is the runtime's own. Its module needs no DOM to load, unlike the runtime's index,
// which defines the graphic's custom elements.
import {
  selfStyledCapture as drawFromMarkup,
  type SelfStyledCaptureOptions as MarkupCaptureOptions,
} from '@ograf-editor/ograf-runtime/src/selfStyledCapture';

export { selfStyledCaptureObstacle } from '@ograf-editor/ograf-runtime/src/selfStyledCapture';

export type SelfStyledCaptureOptions = Pick<
  MarkupCaptureOptions,
  'width' | 'height' | 'canvasWidth' | 'canvasHeight' | 'style' | 'fontEmbedCSS' | 'filter'
>;

/**
 * A capture tree with a layer mask was drawn through html-to-image before, which wrote every
 * element's computed style onto its copy. A masked tree keeps the text layout and the subpixel
 * placement that gave, so its frames still match the ones made then.
 */
function keepMaskedCaptureLayout(
  original: HTMLElement | SVGElement,
  copy: HTMLElement | SVGElement,
): void {
  const copyTextMetrics =
    original.style?.fontSize ||
    Array.from(original.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
  const copyLayerGeometry =
    original.hasAttribute('data-agent-capture-layer') || original instanceof SVGSVGElement;
  if (!copyTextMetrics && !copyLayerGeometry) return;
  const current = getComputedStyle(original);
  if (copyLayerGeometry) {
    // Keep the compatibility capture's resolved subpixel placement of masked SVG artwork.
    for (const name of [
      'left',
      'top',
      'width',
      'height',
      'transform',
      'transform-origin',
      'opacity',
    ])
      copy.style.setProperty(name, current.getPropertyValue(name));
  }
  if (copyTextMetrics) {
    // Masked captures used html-to-image's pixel font-size adjustment. Keep that text layout.
    const fontSize = current.fontSize;
    copy.style.fontSize =
      !current.cssText && fontSize.endsWith('px')
        ? `${Math.floor(Number.parseFloat(fontSize)) - 0.1}px`
        : fontSize;
    copy.style.lineHeight = current.lineHeight;
  }
}

/**
 * Draws a capture tree from its own markup, time after time, with the runtime's drawer. Check
 * `selfStyledCaptureObstacle` before each call.
 */
export function selfStyledCapture(
  root: HTMLElement,
  options: SelfStyledCaptureOptions,
): (signal?: AbortSignal) => Promise<HTMLCanvasElement> {
  const masked = Boolean(root.querySelector('[data-ograf-layer-mask-id]'));
  return drawFromMarkup(root, masked ? { ...options, adjust: keepMaskedCaptureLayout } : options);
}
