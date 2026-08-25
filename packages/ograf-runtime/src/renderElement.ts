import {
  getPaintAtFrame,
  getTrackValueAtFrame,
  lottieFrameAtTime,
  paintToCss,
  type Element,
  type LayerAnimationTracks,
  type Paint,
} from '@ograf-editor/scene-model';
import { valueAtSourcePath } from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_light_canvas.js';

interface MountedTextFit {
  observer?: ResizeObserver;
  fontSet?: FontFaceSet;
  onFontsLoaded?: () => void;
  probe?: HTMLElement;
}

const textFits = new WeakMap<HTMLElement, MountedTextFit>();
const textFitCallbacks = new WeakMap<HTMLElement, () => void>();
interface MountedLottie {
  animation: AnimationItem;
  width: number;
  height: number;
  desiredFrame: number;
}

const lottieAnimations = new WeakMap<HTMLElement, MountedLottie>();

/** Legacy default retained for migrated projects; each text element now carries an absolute floor. */
export const SHRINK_TO_FIT_MIN_RATIO = 0.5;

export interface FittedFontSizeResult {
  fontSize: number;
  ratio: number;
  degenerate: boolean;
}

export function findFittedFontSize(options: {
  mode: 'shrink-to-fit' | 'fit-to-width';
  authoredFontSize: number;
  minFontSize: number;
  fits: (fontSize: number) => boolean;
}): FittedFontSizeResult {
  const authored = Math.max(0.1, options.authoredFontSize);
  const floor =
    options.mode === 'shrink-to-fit' ? Math.min(authored, Math.max(1, options.minFontSize)) : 0.1;
  const rounded = (value: number) => Math.max(0.1, Math.floor(value * 10) / 10);
  if (!options.fits(floor)) {
    const fontSize = rounded(floor);
    return { fontSize, ratio: fontSize / authored, degenerate: true };
  }

  let lower = floor;
  let upper = Math.max(floor, authored);
  if (options.mode === 'fit-to-width' && options.fits(upper)) {
    lower = upper;
    while (upper < 16_384) {
      const candidate = Math.min(16_384, upper * 2);
      if (options.fits(candidate)) {
        lower = candidate;
        upper = candidate;
        if (candidate === 16_384) break;
      } else {
        upper = candidate;
        break;
      }
    }
  }

  if (lower !== upper) {
    for (let iteration = 0; iteration < 16; iteration++) {
      const candidate = (lower + upper) / 2;
      if (options.fits(candidate)) lower = candidate;
      else upper = candidate;
    }
  }
  const fontSize = rounded(lower);
  return { fontSize, ratio: fontSize / authored, degenerate: false };
}

/** Disconnects text-fitting observation before a renderer discards a content host. */
export function disposeElementContent(container: HTMLElement): void {
  lottieAnimations.get(container)?.animation.destroy();
  lottieAnimations.delete(container);
  const mountedFit = textFits.get(container);
  mountedFit?.observer?.disconnect();
  if (mountedFit?.fontSet && mountedFit.onFontsLoaded) {
    mountedFit.fontSet.removeEventListener('loadingdone', mountedFit.onFontsLoaded);
  }
  mountedFit?.probe?.remove();
  textFits.delete(container);
  textFitCallbacks.delete(container);
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
  const directChild = container.firstElementChild as HTMLElement | null;
  const renderHost = directChild?.classList?.contains('layer-content-host')
    ? directChild
    : container;
  const serialized = renderHost.dataset?.ografBasePaint;
  const content = renderHost.firstElementChild as HTMLElement | null;
  if (!content) return;
  if (serialized) {
    const paint = JSON.parse(serialized) as Paint;
    content.style.background = paintToCss(getPaintAtFrame(paint, tracks, frame));
  }
  const strokeTrack = tracks.strokeWidth ?? [];
  if (strokeTrack.length > 0) {
    const fallback = strokeTrack[0]?.value ?? 0;
    content.style.webkitTextStrokeWidth = `${Math.max(
      0,
      getTrackValueAtFrame(strokeTrack, frame, fallback),
    )}px`;
    content.style.paintOrder = 'stroke fill';
    textFitCallbacks.get(renderHost)?.();
  }
}

export function applyTextStrokeStyle(
  style: CSSStyleDeclaration,
  strokeColor: string,
  strokeWidth: number,
): void {
  style.webkitTextStrokeColor = strokeColor;
  style.webkitTextStrokeWidth = `${Math.max(0, strokeWidth)}px`;
  style.paintOrder = 'stroke fill';
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
 * `frameIndex` only matters for `image-sequence` (which frame of the flipbook to show). Lottie is
 * mounted paused at its in-point and is subsequently driven by `renderAnimatedElementAtTime`.
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
      applyTextStrokeStyle(content.style, element.strokeColor, element.strokeWidth);
      content.style.fontFamily = element.fontFamily;
      content.style.fontSize = `${element.fontSize}px`;
      content.style.fontWeight = String(element.fontWeight);
      content.style.textAlign = element.textAlign;
      content.style.letterSpacing = `${element.letterSpacing}px`;
      content.style.textTransform = element.textTransform;
      content.style.display = 'flex';
      content.style.flexDirection = 'column';
      content.style.justifyContent =
        element.verticalAlign === 'middle'
          ? 'center'
          : element.verticalAlign === 'bottom'
            ? 'flex-end'
            : 'flex-start';
      content.style.transform = `translateY(${element.baselineShift}px)`;
      content.style.whiteSpace =
        element.autoFit === 'auto-size' || element.autoFit === 'fit-to-width'
          ? 'pre'
          : element.overflowPolicy === 'ellipsis'
            ? 'nowrap'
            : 'pre-wrap';
      // Shrink-to-fit changes glyph size, not the authored line grid. Keeping the line height in
      // pixels prevents subsequent lines/baselines from moving vertically as longer data forces a
      // smaller fitted font. Other modes retain normal proportional line-height behavior.
      content.style.lineHeight =
        element.autoFit === 'shrink-to-fit'
          ? `${element.fontSize * element.lineHeight}px`
          : String(element.lineHeight);
      content.style.overflow =
        element.autoFit === 'shrink-to-fit' ||
        element.autoFit === 'fit-to-width' ||
        element.overflowPolicy !== 'visible'
          ? 'hidden'
          : 'visible';
      content.style.textOverflow = element.overflowPolicy === 'ellipsis' ? 'ellipsis' : 'clip';
      content.textContent = element.content;
      container.appendChild(content);
      if (element.autoFit === 'shrink-to-fit' || element.autoFit === 'fit-to-width') {
        const fitMode = element.autoFit;
        const mounted: MountedTextFit = {};
        if (fitMode === 'fit-to-width') {
          const probe = content.cloneNode(true) as HTMLElement;
          Object.assign(probe.style, {
            position: 'fixed',
            left: '-100000px',
            top: '0',
            visibility: 'hidden',
            pointerEvents: 'none',
            transform: 'none',
            zIndex: '-1',
          });
          (document.body ?? document.documentElement).appendChild(probe);
          mounted.probe = probe;
        }
        const fit = () => {
          if (textFitCallbacks.get(container) !== fit) return;
          if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
          if (element.content.length === 0) {
            content.style.fontSize = `${element.fontSize}px`;
            content.dataset.ografAppliedFontSize = String(element.fontSize);
            content.dataset.ografFitRatio = '1';
            content.dataset.ografFitDegenerate = 'false';
            return;
          }
          const strokeExpansion = Math.max(
            0,
            Number.parseFloat(content.style.webkitTextStrokeWidth) || element.strokeWidth,
          );
          const fits = (fontSize: number) => {
            if (fitMode === 'shrink-to-fit') {
              content.style.fontSize = `${fontSize}px`;
              return (
                content.scrollWidth + strokeExpansion <= container.clientWidth + 0.5 &&
                content.scrollHeight + strokeExpansion <= container.clientHeight + 0.5
              );
            }
            const probe = mounted.probe;
            if (!probe) return false;
            probe.style.width = `${container.clientWidth}px`;
            probe.style.height = `${container.clientHeight}px`;
            probe.style.fontSize = `${fontSize}px`;
            probe.style.webkitTextStrokeWidth = content.style.webkitTextStrokeWidth;
            const range = document.createRange();
            range.selectNodeContents(probe);
            const bounds = range.getBoundingClientRect();
            range.detach();
            const availableHeight = Math.max(
              0,
              container.clientHeight - Math.abs(element.baselineShift),
            );
            return (
              bounds.width + strokeExpansion <= container.clientWidth + 0.5 &&
              bounds.height + strokeExpansion <= availableHeight + 0.5
            );
          };
          const result = findFittedFontSize({
            mode: fitMode,
            authoredFontSize: element.fontSize,
            minFontSize: element.minFontSize,
            fits,
          });
          content.style.fontSize = `${result.fontSize}px`;
          content.dataset.ografAppliedFontSize = String(result.fontSize);
          content.dataset.ografFitRatio = String(result.ratio);
          content.dataset.ografFitDegenerate = String(result.degenerate);
          if (fitMode === 'shrink-to-fit') {
            content.dataset.ografShrinkRatio = String(result.ratio);
            content.dataset.ografShrinkDegenerate = String(result.degenerate);
          }
        };
        textFitCallbacks.set(container, fit);
        textFits.set(container, mounted);
        fit();
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(fit);
          observer.observe(container);
          mounted.observer = observer;
        }
        if (typeof document !== 'undefined' && document.fonts) {
          const onFontsLoaded = () => fit();
          document.fonts.addEventListener('loadingdone', onFontsLoaded);
          void document.fonts.ready.then(fit);
          mounted.fontSet = document.fonts;
          mounted.onFontsLoaded = onFontsLoaded;
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
    case 'lottie': {
      if (!element.animationData) break;
      const content = document.createElement('div');
      applyContentBaseStyle(content);
      content.style.overflow = 'hidden';
      container.appendChild(content);
      // The light canvas build excludes the expression engine. Clone because lottie-web mutates
      // parts of animationData while preparing a composition, and project state is immutable input.
      const animation = lottie.loadAnimation({
        container: content,
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData: JSON.parse(
          JSON.stringify(element.animationData),
        ) as typeof element.animationData,
        rendererSettings: {
          clearCanvas: true,
          preserveAspectRatio: 'xMidYMid meet',
        },
      });
      animation.setSubframe(true);
      const mounted = {
        animation,
        width: -1,
        height: -1,
        desiredFrame: element.animationData.ip,
      };
      animation.addEventListener('DOMLoaded', () => {
        animation.resize(container.clientWidth, container.clientHeight);
        animation.goToAndStop(mounted.desiredFrame, true);
      });
      animation.goToAndStop(mounted.desiredFrame, true);
      lottieAnimations.set(container, mounted);
      break;
    }
  }
}

/** Updates self-animated content from an absolute clock without remounting its DOM/player. */
export function renderAnimatedElementAtTime(
  container: HTMLElement,
  element: Element,
  elapsedMs: number,
): void {
  if (element.type === 'image-sequence') {
    if (element.frames.length === 0) return;
    const rawFrame = Math.max(0, Math.floor((elapsedMs / 1000) * Math.max(1, element.fps)));
    const frameIndex = element.loop
      ? rawFrame % element.frames.length
      : Math.min(rawFrame, element.frames.length - 1);
    const image = container.firstElementChild as HTMLImageElement | null;
    const src = element.frames[frameIndex];
    if (image?.tagName === 'IMG' && src) image.src = src;
    else renderElementContent(container, element, frameIndex);
    return;
  }
  if (element.type === 'lottie' && element.animationData) {
    const mounted = lottieAnimations.get(container);
    if (!mounted) return;
    mounted.desiredFrame = lottieFrameAtTime(element, elapsedMs);
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width !== mounted.width || height !== mounted.height) {
      mounted.width = width;
      mounted.height = height;
      if (width > 0 && height > 0) mounted.animation.resize(width, height);
    }
    mounted.animation.goToAndStop(mounted.desiredFrame, true);
  }
}

/**
 * The element a compiled layer should render with, given runtime data — mirrors the editor's
 * design-time `resolveEffectiveElement` (apps/editor/src/state/dataBinding.ts), adapted to the
 * compiled descriptor's shape (data keyed by field `key`, not `fieldId`). All current bindable
 * properties are string-typed, so the override always stringifies.
 */
export function resolveBoundElement(layer: CompiledLayer, data: Record<string, unknown>): Element {
  const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
  return bindings.reduce<Element>((element, binding) => {
    const root = data[binding.dataKey];
    const itemValue =
      binding.itemIndex === undefined
        ? root
        : Array.isArray(root)
          ? root[binding.itemIndex]
          : undefined;
    const value = valueAtSourcePath(itemValue, binding.sourcePath);
    if (value === undefined) return element;
    const mappedValue = binding.valueMap?.[String(value)] ?? value;
    const resolvedValue =
      binding.targetProperty === 'fill' && mappedValue && typeof mappedValue === 'object'
        ? mappedValue
        : String(mappedValue);
    return { ...element, [binding.targetProperty]: resolvedValue } as Element;
  }, layer.element);
}
