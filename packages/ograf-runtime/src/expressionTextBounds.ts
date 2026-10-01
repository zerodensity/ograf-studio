import type {
  ExpressionTextMeasurement,
  LayerTransform,
  TextElement,
} from '@ograf-editor/scene-model';
import { disposeElementContent, renderElementContent } from './renderElement';

const measurementCaches = new WeakMap<
  Document,
  {
    bounds: Map<string, ExpressionTextMeasurement>;
    fonts: FontFace[];
    statuses: string[];
  }
>();

/** Cache geometry only: moving/fading a layer does not change its local text bounds. */
function measurementCache(doc: Document) {
  let cache = measurementCaches.get(doc);
  if (!cache) {
    cache = { bounds: new Map(), fonts: [], statuses: [] };
    measurementCaches.set(doc, cache);
    const bounds = cache.bounds;
    doc.fonts?.addEventListener('loadingdone', () => bounds.clear());
    doc.fonts?.addEventListener('loadingerror', () => bounds.clear());
  }
  const fonts = doc.fonts ? Array.from(doc.fonts) : [];
  if (
    fonts.length !== cache.fonts.length ||
    fonts.some((font, i) => font !== cache.fonts[i] || font.status !== cache.statuses[i])
  ) {
    cache.bounds.clear();
    cache.fonts = fonts;
    cache.statuses = fonts.map((font) => font.status);
  }
  return cache.bounds;
}

/** Measure with the same font, wrapping and fitting code as playout, without touching live layers. */
export function measureExpressionText(
  element: TextElement,
  transform: LayerTransform,
): ExpressionTextMeasurement {
  if (typeof document === 'undefined' || !document.body)
    throw new Error('Text bounds require a browser renderer.');
  // Paint is excluded both from the key and the probe; it cannot change text layout.
  const { strokePaint: _strokePaint, fill: _fill, color: _color, ...text } = element;
  const cache = measurementCache(document);
  const key = JSON.stringify([text, Math.max(0, transform.width), Math.max(0, transform.height)]);
  const cached = cache.get(key);
  if (cached && document.fonts?.status !== 'loading') {
    cache.delete(key);
    cache.set(key, cached);
    return { ...cached };
  }
  const probe = document.createElement('div');
  Object.assign(probe.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: `${Math.max(0, transform.width)}px`,
    height: `${Math.max(0, transform.height)}px`,
  });
  document.body.appendChild(probe);
  try {
    // Paint does not affect layout; avoid creating shader/GPU resources for measurement.
    renderElementContent(probe, { ...text, fill: '#000000', color: '#000000' });
    const content = probe.firstElementChild;
    if (!content) throw new Error('Text content could not be measured.');
    const range = document.createRange();
    range.selectNodeContents(content);
    const bounds = range.getBoundingClientRect();
    const origin = probe.getBoundingClientRect();
    const strokeScale = (value: string | undefined) => {
      const scale = Number.parseFloat(value ?? '');
      return Number.isFinite(scale) && scale >= 0 ? scale : 1;
    };
    const dataset = (content as HTMLElement).dataset;
    const measured = {
      left: bounds.left - origin.left,
      top: bounds.top - origin.top,
      width: bounds.width,
      height: bounds.height,
      ...(element.autoFit === 'squeeze'
        ? {
            strokeScaleX: strokeScale(dataset?.ografSqueezeScaleX),
            strokeScaleY: strokeScale(dataset?.ografSqueezeScaleY),
          }
        : {}),
    };
    // Font loading may have started during measurement. Never retain fallback-font geometry.
    if (document.fonts?.status !== 'loading') {
      cache.set(key, measured);
      if (cache.size > 128) cache.delete(cache.keys().next().value!);
    }
    return { ...measured };
  } finally {
    disposeElementContent(probe);
    probe.remove();
  }
}
