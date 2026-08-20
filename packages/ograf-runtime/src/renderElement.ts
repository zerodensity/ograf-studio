import {
  getPaintAtFrame,
  paintToCss,
  type Element,
  type LayerAnimationTracks,
  type Paint,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';

const textFitObservers = new WeakMap<HTMLElement, ResizeObserver>();

/** Smallest legible fraction of the authored text size used by shrink-to-fit. */
export const SHRINK_TO_FIT_MIN_RATIO = 0.5;

/** Disconnects shrink-to-fit observation before a renderer discards a content host. */
export function disposeElementContent(container: HTMLElement): void {
  textFitObservers.get(container)?.disconnect();
  textFitObservers.delete(container);
  container.replaceChildren();
  delete container.dataset.ografBasePaint;
}

function rememberPaint(container: HTMLElement, paint: Paint): void {
  container.dataset.ografBasePaint = JSON.stringify(paint);
}

/** Re-evaluates gradient-stop tracks against the currently rendered authored/data-bound paint. */
export function applyAnimatedPaint(
  container: HTMLElement,
  tracks: LayerAnimationTracks,
  frame: number,
): void {
  const serialized = container.dataset?.ografBasePaint;
  const content = container.firstElementChild as HTMLElement | null;
  if (!serialized || !content) return;
  const paint = JSON.parse(serialized) as Paint;
  content.style.background = paintToCss(getPaintAtFrame(paint, tracks, frame));
}

function applyContentBaseStyle(el: HTMLElement | SVGElement): void {
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.boxSizing = 'border-box';
  el.style.pointerEvents = 'none';
  el.style.userSelect = 'none';
}

/**
 * Vanilla-DOM equivalent of the editor's LayerNode content rendering — no framework at runtime.
 * `frameIndex` only matters for `image-sequence` (which frame of the flipbook to show); every
 * other element type ignores it.
 */
export function renderElementContent(
  container: HTMLElement,
  element: Element,
  frameIndex = 0,
): void {
  disposeElementContent(container);
  switch (element.type) {
    case 'rectangle': {
      const content = document.createElement('div');
      applyContentBaseStyle(content);
      content.style.background = paintToCss(element.fill);
      rememberPaint(container, element.fill);
      content.style.borderRadius = `${element.borderRadius}px`;
      if (element.strokeWidth > 0) {
        content.style.border = `${element.strokeWidth}px solid ${element.strokeColor}`;
      }
      container.appendChild(content);
      break;
    }
    case 'ellipse': {
      const content = document.createElement('div');
      applyContentBaseStyle(content);
      content.style.background = paintToCss(element.fill);
      rememberPaint(container, element.fill);
      content.style.borderRadius = '50%';
      if (element.strokeWidth > 0) {
        content.style.border = `${element.strokeWidth}px solid ${element.strokeColor}`;
      }
      container.appendChild(content);
      break;
    }
    case 'text': {
      const content = document.createElement('div');
      applyContentBaseStyle(content);
      content.style.color = element.color;
      content.style.fontFamily = element.fontFamily;
      content.style.fontSize = `${element.fontSize}px`;
      content.style.fontWeight = String(element.fontWeight);
      content.style.textAlign = element.textAlign;
      content.style.whiteSpace = element.autoFit === 'auto-size' ? 'pre' : 'pre-wrap';
      // Shrink-to-fit changes glyph size, not the authored line grid. Keeping the line height in
      // pixels prevents subsequent lines/baselines from moving vertically as longer data forces a
      // smaller fitted font. Other modes retain normal proportional line-height behavior.
      content.style.lineHeight =
        element.autoFit === 'shrink-to-fit' ? `${element.fontSize * 1.2}px` : '1.2';
      content.style.overflow = element.autoFit === 'shrink-to-fit' ? 'hidden' : 'visible';
      content.textContent = element.content;
      container.appendChild(content);
      if (element.autoFit === 'shrink-to-fit') {
        const fit = () => {
          if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
          const floor = Math.max(1, element.fontSize * SHRINK_TO_FIT_MIN_RATIO);
          let lower = floor;
          let upper = Math.max(floor, element.fontSize);
          content.style.fontSize = `${floor}px`;
          const fitsAtFloor =
            content.scrollWidth <= container.clientWidth + 0.5 &&
            content.scrollHeight <= container.clientHeight + 0.5;
          if (!fitsAtFloor) {
            content.style.fontSize = `${Math.floor(floor * 10) / 10}px`;
            content.dataset.ografShrinkRatio = String(SHRINK_TO_FIT_MIN_RATIO);
            content.dataset.ografShrinkDegenerate = 'true';
            return;
          }
          for (let iteration = 0; iteration < 12; iteration++) {
            const candidate = (lower + upper) / 2;
            content.style.fontSize = `${candidate}px`;
            if (
              content.scrollWidth <= container.clientWidth + 0.5 &&
              content.scrollHeight <= container.clientHeight + 0.5
            ) {
              lower = candidate;
            } else {
              upper = candidate;
            }
          }
          const applied = Math.floor(lower * 10) / 10;
          content.style.fontSize = `${applied}px`;
          content.dataset.ografShrinkRatio = String(applied / element.fontSize);
          content.dataset.ografShrinkDegenerate = 'false';
        };
        fit();
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(fit);
          observer.observe(container);
          textFitObservers.set(container, observer);
        }
      }
      break;
    }
    case 'image': {
      if (element.src) {
        const img = document.createElement('img');
        applyContentBaseStyle(img);
        img.style.objectFit = 'contain';
        img.src = element.src;
        img.alt = '';
        img.draggable = false;
        container.appendChild(img);
      }
      break;
    }
    case 'path': {
      const SVG_NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(SVG_NS, 'svg');
      applyContentBaseStyle(svg);
      svg.setAttribute('viewBox', `0 0 ${element.viewBoxWidth} ${element.viewBoxHeight}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', element.d);
      path.setAttribute('fill', element.fill);
      path.setAttribute('stroke', element.strokeWidth > 0 ? element.strokeColor : 'none');
      path.setAttribute('stroke-width', String(element.strokeWidth));
      svg.appendChild(path);
      container.appendChild(svg);
      break;
    }
    case 'image-sequence': {
      const src =
        element.frames.length > 0 ? element.frames[frameIndex % element.frames.length] : undefined;
      if (src) {
        const img = document.createElement('img');
        applyContentBaseStyle(img);
        img.style.objectFit = 'contain';
        img.src = src;
        img.alt = '';
        img.draggable = false;
        container.appendChild(img);
      }
      break;
    }
  }
}

/**
 * The element a compiled layer should render with, given runtime data — mirrors the editor's
 * design-time `resolveEffectiveElement` (apps/editor/src/state/dataBinding.ts), adapted to the
 * compiled descriptor's shape (data keyed by field `key`, not `fieldId`). All current bindable
 * properties are string-typed, so the override always stringifies.
 */
export function resolveBoundElement(layer: CompiledLayer, data: Record<string, unknown>): Element {
  if (!layer.binding) return layer.element;
  const value = data[layer.binding.dataKey];
  if (value === undefined) return layer.element;
  const resolvedValue =
    layer.binding.targetProperty === 'fill' && value && typeof value === 'object'
      ? value
      : String(value);
  return { ...layer.element, [layer.binding.targetProperty]: resolvedValue } as Element;
}
