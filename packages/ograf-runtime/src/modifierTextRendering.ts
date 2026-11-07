import type { Element, LayerModifier } from '@ograf-editor/scene-model';

/** A max-width modifier owns fitting; the authored text-sizing choice remains untouched. */
export function prepareModifierTextElement(
  element: Element,
  modifiers: readonly LayerModifier[] | undefined,
): Element {
  return element.type === 'text' &&
    modifiers?.some((modifier) => modifier.enabled && modifier.type === 'max-text-width')
    ? { ...element, autoFit: 'auto-size', overflowPolicy: 'visible' }
    : element;
}

export interface ModifierTextFit {
  scaleX: number;
  scaleY: number;
  fontSize: number;
}

/** Fits only the glyph surface, so backgrounds, outline masks and selection geometry stay intact. */
export function applyModifierTextFit(host: HTMLElement, fit?: ModifierTextFit): void {
  if (!fit || typeof host.querySelectorAll !== 'function') return;
  for (const content of host.querySelectorAll<HTMLElement>('[data-ograf-modifier-text]')) {
    const baseline = Number(content.dataset.ografTextBaseline ?? 0);
    Object.assign(content.style, {
      display: 'block',
      position: 'absolute',
      left: '0',
      top: '0',
      width: 'max-content',
      height: 'max-content',
      minWidth: '0',
      minHeight: '0',
      maxWidth: 'none',
      maxHeight: 'none',
      whiteSpace: 'pre',
      overflow: 'visible',
      transformOrigin: '0 0',
      transform: `scale(${fit.scaleX}, ${fit.scaleY}) translateY(${baseline}px)`,
    });
    content.dataset.ografModifierScaleX = String(fit.scaleX);
    content.dataset.ografModifierScaleY = String(fit.scaleY);
    content.dataset.ografAppliedFontSize = String(fit.fontSize);
  }
}
