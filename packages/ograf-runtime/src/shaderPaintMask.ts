import {
  croppedSourcePlacement,
  editablePathBounds,
  patternRows,
  patternRowOffset,
  sourceCropPixels,
  readColor,
  type Element,
  type TextElement,
} from '@ograf-editor/scene-model';
import { paintTextTintGlyph } from './textTintMask';

export interface ShaderPaintMask {
  ready: Promise<void>;
  /** Call after the native image/sequence/Lottie/pattern content has reached the requested time. */
  update(elapsedMs?: number): Promise<CanvasImageSource | null>;
  /** Shader uploads can retain a complete chart frame without sharing its mutable Canvas backing. */
  update(
    elapsedMs: number,
    options: { immutableChartSnapshot: true },
  ): Promise<CanvasImageSource | ImageData | null>;
  /** Experimental colored glyph weight map, populated alongside the ordinary coverage mask. */
  textTint(): CanvasImageSource | null;
  dispose(): void;
}

export interface ShaderPaintMaskOptions {
  /** Text strokes use the same native layout and centered glyph outlines; fill remains the default. */
  slot?: 'fill' | 'stroke';
  /** Shared CSS-pixel expansion around text fill/stroke output, independent of backing scale. */
  padding?: number;
  /** Invoke the native fitter after fonts/layout are ready; never fit independently in the mask. */
  refreshTextLayout?: () => void;
  /** Allocate a separate color/weight map only for experimental tinted text. */
  textTint?: boolean;
}

interface Size {
  width: number;
  height: number;
}

/** Match the native image content's centered object-fit: contain placement. */
export function shaderMaskContainRect(source: Size, target: Size) {
  if (source.width <= 0 || source.height <= 0)
    throw new Error('Shader image alpha has no decoded dimensions.');
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const width = source.width * scale,
    height = source.height * scale;
  return { x: (target.width - width) / 2, y: (target.height - height) / 2, width, height };
}

function pixelSize(value: string): number {
  return /^\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : 0;
}

function hostSize(host: HTMLElement, fallback: Size): Size {
  return {
    width:
      host.clientWidth ||
      pixelSize(host.style.width) ||
      pixelSize(host.parentElement?.style.width ?? '') ||
      fallback.width,
    height:
      host.clientHeight ||
      pixelSize(host.style.height) ||
      pixelSize(host.parentElement?.style.height ?? '') ||
      fallback.height,
  };
}

async function waitForImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('Shader paint alpha has been disposed.');
  if (image.complete) {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) return;
    throw new Error('Shader image alpha could not be decoded.');
  }
  await new Promise<void>((resolve, reject) => {
    const clear = () => {
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      clearTimeout(timeout);
    };
    const loaded = () => {
      clear();
      resolve();
    };
    const failed = () => {
      clear();
      reject(new Error('Shader image alpha could not be decoded; check its URL and CORS access.'));
    };
    const aborted = () => {
      clear();
      reject(new Error('Shader paint alpha has been disposed.'));
    };
    const timeout = setTimeout(() => {
      clear();
      reject(new Error('Shader image alpha did not load within 10 seconds.'));
    }, 10_000);
    image.addEventListener('load', loaded, { once: true });
    image.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
  });
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0)
    throw new Error('Shader image alpha has no decoded dimensions.');
}

function transformedText(text: string, transform: string): string {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize')
    return text.replace(
      /(^|[\s\p{P}])(\p{L})/gu,
      (_, prefix: string, letter: string) => prefix + letter.toUpperCase(),
    );
  return text;
}

/** Fit the native ellipsis without splitting Unicode grapheme clusters. */
export function shaderMaskEllipsis(
  text: string,
  width: number,
  measure: (text: string) => number,
): string {
  if (measure(text) <= width) return text;
  if (measure('…') > width) return '';
  const characters = [
    ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
  ].map((entry) => entry.segment);
  let low = 0,
    high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(characters.slice(0, middle).join('') + '…') <= width) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join('') + '…';
}

/** Match the native layout: text-overflow does not ellipsize a direct anonymous flex/grid item. */
export function shaderMaskUsesEllipsis(
  style: Pick<CSSStyleDeclaration, 'display' | 'textOverflow' | 'overflowX' | 'whiteSpace'>,
): boolean {
  return (
    style.textOverflow === 'ellipsis' &&
    !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display) &&
    ['hidden', 'clip'].includes(style.overflowX) &&
    ['nowrap', 'pre'].includes(style.whiteSpace)
  );
}

interface TextLine {
  text: string;
  x: number;
  top: number;
  style: CSSStyleDeclaration;
  ancestors: HTMLElement[];
  opacity: number;
}

interface TextMaskNodeStyle {
  computed: CSSStyleDeclaration;
  transform: string;
  transformOrigin: string;
  filter: string;
  /** Fixed at a geometry revision; avoids layout reads during color-only animation. */
  bounds?: DOMRect;
}

const TEXT_LAYOUT_PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'font-feature-settings',
  'font-kerning',
  'letter-spacing',
  'word-spacing',
  'line-height',
  'text-transform',
  'direction',
  'text-align',
] as const;

/** Freeze native run typography before measuring the clone outside the editor's CSS ancestry. */
function copyTextMaskStyles(
  source: HTMLElement,
  clone: HTMLElement,
  view: Window,
  styles: Map<HTMLElement, TextMaskNodeStyle>,
): void {
  const computed = view.getComputedStyle(source);
  styles.set(clone, {
    computed,
    transform: computed.transform,
    transformOrigin: computed.transformOrigin,
    filter: computed.filter,
  });
  for (const property of TEXT_LAYOUT_PROPERTIES) {
    clone.style.setProperty(property, computed.getPropertyValue(property));
  }
  // Range rectangles are measured before transforms; Canvas applies each ancestor matrix once.
  clone.style.transform = 'none';
  const children = [...(source.children ?? [])];
  const clonedChildren = [...(clone.children ?? [])];
  children.forEach((child, index) => {
    const clonedChild = clonedChildren[index];
    if (clonedChild)
      copyTextMaskStyles(child as HTMLElement, clonedChild as HTMLElement, view, styles);
  });
}

/** Read native line positions; the browser remains responsible for wrapping and font shaping. */
function textLines(
  content: HTMLElement,
  origin: DOMRect,
  styles: Map<HTMLElement, TextMaskNodeStyle>,
): TextLine[] {
  const lines: TextLine[] = [];
  const range = content.ownerDocument.createRange();
  const visit = (parent: HTMLElement, ancestors: HTMLElement[], opacity: number) => {
    const style = styles.get(parent)?.computed;
    const cursor = parent.getAttribute?.('data-ograf-text-cursor');
    if (
      !style ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      cursor != null
    )
      return;
    const ownOpacity = Number.parseFloat(style.opacity);
    const alpha =
      parent === content ? opacity : opacity * (Number.isFinite(ownOpacity) ? ownOpacity : 1);
    if (alpha <= 0) return;
    const children = parent.childNodes
      ? [...parent.childNodes]
      : parent.firstChild
        ? [parent.firstChild]
        : [];
    for (const node of children) {
      if (node.nodeType === 1) {
        visit(node as HTMLElement, [...ancestors, node as HTMLElement], alpha);
        continue;
      }
      if (node.nodeType !== 3) continue;
      const text = node.textContent ?? '';
      let current: TextLine | undefined;
      let offset = 0;
      for (const character of text) {
        const next = offset + character.length;
        if (character === '\n' || character === '\r') {
          current = undefined;
          offset = next;
          continue;
        }
        range.setStart(node, offset);
        range.setEnd(node, next);
        const rect = range.getClientRects()[0];
        offset = next;
        if (!rect || rect.height <= 0 || (rect.width === 0 && !character.trim())) continue;
        const top = rect.top - origin.top;
        if (!current || Math.abs(current.top - top) > 0.5) {
          current = { text: '', x: rect.left - origin.left, top, style, ancestors, opacity: alpha };
          lines.push(current);
        }
        current.text += character;
        current.x = Math.min(current.x, rect.left - origin.left);
      }
    }
  };
  try {
    visit(content, [], 1);
  } finally {
    range.detach();
  }
  return lines;
}

function applyTextMaskAncestor(
  context: CanvasRenderingContext2D,
  node: HTMLElement,
  state: TextMaskNodeStyle,
  origin: DOMRect,
): void {
  const bounds = state.bounds ?? node.getBoundingClientRect();
  const x = bounds.left - origin.left;
  const y = bounds.top - origin.top;
  if (state.transform && state.transform !== 'none') {
    const matrix = new DOMMatrix(state.transform);
    const [ox = 0, oy = 0] = state.transformOrigin
      .split(' ')
      .map((value) => Number.parseFloat(value) || 0);
    context.translate(x + ox, y + oy);
    context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    context.translate(-x - ox, -y - oy);
  }
  // Text FX blur belongs to the glyph alpha, before a shader/gradient/media paint is applied.
  // Canvas filter lengths are backing pixels, so include the mask resolution and fitted scale.
  for (const match of state.filter?.matchAll(/blur\(\s*([\d.]+)px\s*\)/g) ?? []) {
    const radius = Number(match[1]);
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const matrix = context.getTransform();
    const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
    const blur = `blur(${radius * scale}px)`;
    context.filter =
      context.filter && context.filter !== 'none' ? `${context.filter} ${blur}` : blur;
  }
  const clips = (overflow: string) => ['hidden', 'clip', 'scroll', 'auto'].includes(overflow);
  if (clips(state.computed.overflowX) || clips(state.computed.overflowY)) {
    context.beginPath();
    // Native text-animation clipping (for example Word Reveal) belongs to the ancestor before
    // its inner run's translation. The measured box remains the browser's layout authority.
    context.rect(x, y, bounds.width, bounds.height);
    context.clip();
  }
}

function setTextMaskFont(
  context: CanvasRenderingContext2D,
  style: CSSStyleDeclaration,
  element: TextElement,
): void {
  context.font = `${style.fontStyle || 'normal'} ${style.fontWeight || element.fontWeight} ${style.fontSize || `${element.fontSize}px`} ${style.fontFamily || element.fontFamily}`;
  context.fontKerning = style.fontKerning as CanvasFontKerning;
  context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  context.wordSpacing = style.wordSpacing === 'normal' ? '0px' : style.wordSpacing;
  context.direction = style.direction === 'rtl' ? 'rtl' : 'ltr';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
}

/** Keep cached text painting independent of live computed-style/layout reads. */
function freezeTextMaskStyle(style: CSSStyleDeclaration): CSSStyleDeclaration {
  return {
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontKerning: style.fontKerning,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    direction: style.direction,
    textTransform: style.textTransform,
    display: style.display,
    textOverflow: style.textOverflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    whiteSpace: style.whiteSpace,
    strokeLinejoin: style.strokeLinejoin,
    strokeMiterlimit: style.strokeMiterlimit,
  } as CSSStyleDeclaration;
}

function textMaskSnapshot(content: HTMLElement | null, ignoreTint = false): unknown {
  const css = (value: string) =>
    ignoreTint ? value.replace(/--ograf-text-animator-tint\s*:[^;]*(?:;|$)/g, '') : value;
  const inheritedVisibility = [] as Array<[string, string, string, boolean]>;
  let ancestor: HTMLElement | SVGElement | null = content;
  while (ancestor) {
    const style = (ancestor as HTMLElement).style;
    inheritedVisibility.push([
      style?.visibility ?? '',
      style?.display ?? '',
      ancestor.getAttribute?.('class') ?? '',
      ancestor.hasAttribute?.('hidden') ?? false,
    ]);
    const root = ancestor.getRootNode?.();
    const shadowHost = root && 'host' in root ? (root as ShadowRoot).host : null;
    ancestor = (ancestor.parentElement ?? shadowHost) as HTMLElement | SVGElement | null;
  }
  return content
    ? [
        inheritedVisibility,
        content.ownerDocument?.defaultView?.innerWidth,
        content.ownerDocument?.defaultView?.innerHeight,
        css(content.style.cssText),
        content.textContent,
        [...(content.querySelectorAll?.('*') ?? [])].map((node) => [
          css((node as HTMLElement).style.cssText),
          node.textContent,
        ]),
      ]
    : null;
}

function textContent(host: HTMLElement): HTMLElement | null {
  return (
    ([...host.children].find(
      (child) => child.getAttribute('data-ograf-runtime-auxiliary') !== 'true',
    ) as HTMLElement | undefined) ?? null
  );
}

function paintTextMask(
  host: HTMLElement,
  element: TextElement,
  target: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  layout: Size,
  slot: 'fill' | 'stroke',
  padding: number,
  tintContext: CanvasRenderingContext2D | null = null,
): (() => void) | undefined {
  const original = textContent(host);
  if (!original || !element.content) return;
  const document = host.ownerDocument;
  const view = document.defaultView;
  if (!view) throw new Error('Shader text alpha needs an active browser document.');
  const computed = view.getComputedStyle(original);
  // Read before stripping the clone's stroke. Explicit animated zero must not fall back to the
  // authored width or Canvas's default one-pixel stroke.
  const measuredStrokeWidth = Number.parseFloat(computed.webkitTextStrokeWidth);
  const strokeWidth = Number.isFinite(measuredStrokeWidth)
    ? Math.max(0, measuredStrokeWidth)
    : Math.max(0, element.strokeWidth);
  if (slot === 'stroke' && strokeWidth === 0) return;
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    opacity: '0',
    pointerEvents: 'none',
    overflow: 'visible',
    transform: 'none',
    filter: 'none',
  });
  const content = original.cloneNode(true) as HTMLElement;
  const styles = new Map<HTMLElement, TextMaskNodeStyle>();
  copyTextMaskStyles(original, content, view, styles);
  const transform = computed.transform;
  const transformOrigin = computed.transformOrigin;
  content.style.transform = 'none';
  content.style.color = '#ffffff';
  content.style.webkitTextFillColor = '#ffffff';
  content.style.webkitTextStrokeWidth = '0px';
  content.style.textShadow = 'none';
  content.style.opacity = '1';
  wrapper.appendChild(content);
  (document.body ?? document.documentElement).appendChild(wrapper);
  try {
    const origin = wrapper.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    const lines = textLines(content, origin, styles);
    const paintStyle = tintContext ? freezeTextMaskStyle(computed) : computed;
    const textMetrics = tintContext ? new Map<TextLine, { ascent: number; text: string }>() : null;
    if (tintContext) {
      for (const [node, state] of styles) {
        state.bounds = node.getBoundingClientRect();
        state.computed = freezeTextMaskStyle(state.computed);
      }
      for (const line of lines) line.style = freezeTextMaskStyle(line.style);
    }
    const renderTo = (context: CanvasRenderingContext2D, tintMode: boolean) => {
      context.save();
      try {
        context.scale(
          target.width / (layout.width + padding * 2),
          target.height / (layout.height + padding * 2),
        );
        if (padding > 0) context.translate(padding, padding);
        if (transform && transform !== 'none') {
          const matrix = new DOMMatrix(transform);
          const [ox = 0, oy = 0] = transformOrigin
            .split(' ')
            .map((part) => Number.parseFloat(part) || 0);
          const x = contentBounds.left - origin.left + ox,
            y = contentBounds.top - origin.top + oy;
          context.translate(x, y);
          context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
          context.translate(-x, -y);
        }
        const clips = (overflow: string) => ['hidden', 'clip', 'scroll', 'auto'].includes(overflow);
        const clipX = clips(paintStyle.overflowX),
          clipY = clips(paintStyle.overflowY);
        if (clipX || clipY) {
          context.beginPath();
          context.rect(
            clipX ? contentBounds.left - origin.left : -padding,
            clipY ? contentBounds.top - origin.top : -padding,
            clipX ? contentBounds.width : layout.width + padding * 2,
            clipY ? contentBounds.height : layout.height + padding * 2,
          );
          context.clip();
        }
        setTextMaskFont(context, paintStyle, element);
        context.fillStyle = '#ffffff';
        if (slot === 'stroke') {
          context.strokeStyle = '#ffffff';
          context.lineWidth = strokeWidth;
          context.lineJoin = ['bevel', 'round', 'miter'].includes(paintStyle.strokeLinejoin)
            ? (paintStyle.strokeLinejoin as CanvasLineJoin)
            : 'miter';
          const miterLimit = Number.parseFloat(paintStyle.strokeMiterlimit);
          // Match the native CSS text outline, instead of Canvas's default miter limit of ten.
          context.miterLimit = Number.isFinite(miterLimit) && miterLimit > 0 ? miterLimit : 4;
        }
        for (const line of lines) {
          context.save();
          try {
            for (const ancestor of line.ancestors) {
              const state = styles.get(ancestor);
              if (state) applyTextMaskAncestor(context, ancestor, state, origin);
            }
            context.globalAlpha = line.opacity;
            setTextMaskFont(context, line.style, element);
            let metrics = textMetrics?.get(line);
            if (!metrics) {
              const ascent = context.measureText('Mg').fontBoundingBoxAscent;
              if (!Number.isFinite(ascent))
                throw new Error('Shader text alpha requires browser font bounding-box metrics.');
              let text = transformedText(line.text, line.style.textTransform);
              if (shaderMaskUsesEllipsis(paintStyle))
                text = shaderMaskEllipsis(
                  text,
                  Math.max(0, layout.width - line.x),
                  (value) => context.measureText(value).width,
                );
              metrics = { ascent, text };
              textMetrics?.set(line, metrics);
            }
            const { ascent, text } = metrics;
            const draw = () => {
              if (slot === 'stroke') context.strokeText(text, line.x, line.top + ascent);
              else context.fillText(text, line.x, line.top + ascent);
            };
            if (tintMode) {
              const glyph = [...line.ancestors]
                .reverse()
                .find((ancestor) => ancestor.hasAttribute('data-ograf-text-animator-glyph'));
              const parsed = readColor(
                glyph?.style.getPropertyValue('--ograf-text-animator-tint') ?? '',
              );
              paintTextTintGlyph(context, draw, line.opacity, {
                rgb: parsed ? [parsed.rgb[0]!, parsed.rgb[1]!, parsed.rgb[2]!] : [0, 0, 0],
                weight: parsed?.alpha ?? 0,
              });
            } else draw();
          } finally {
            context.restore();
          }
        }
      } finally {
        context.restore();
      }
    };
    renderTo(context, false);
    if (tintContext) {
      const selector = '[data-ograf-text-animator-glyph]';
      const originalGlyphs = [...original.querySelectorAll<HTMLElement>(selector)];
      const cloneGlyphs = [...content.querySelectorAll<HTMLElement>(selector)];
      const repaint = () => {
        originalGlyphs.forEach((glyph, index) => {
          cloneGlyphs[index]?.style.setProperty(
            '--ograf-text-animator-tint',
            glyph.style.getPropertyValue('--ograf-text-animator-tint'),
          );
        });
        tintContext.resetTransform();
        tintContext.clearRect(0, 0, target.width, target.height);
        renderTo(tintContext, true);
      };
      repaint();
      return repaint;
    }
  } finally {
    wrapper.remove();
  }
}

/** Native geometry/media alpha used by the shader's internal coverage texture. */
export function createShaderPaintMask(
  baseHost: HTMLElement,
  element: Element,
  size: Size,
  options: ShaderPaintMaskOptions = {},
): ShaderPaintMask {
  if (options.slot === 'stroke' && element.type !== 'text') {
    throw new Error('Shader stroke alpha is currently supported only for native text.');
  }
  const canvas = baseHost.ownerDocument.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size.width));
  canvas.height = Math.max(1, Math.round(size.height));
  const maskContext = canvas.getContext('2d', { willReadFrequently: true });
  if (!maskContext) throw new Error('Shader paint alpha requires Canvas 2D rendering support.');
  const context = maskContext;
  const tintCanvas =
    options.textTint && element.type === 'text'
      ? baseHost.ownerDocument.createElement('canvas')
      : null;
  if (tintCanvas) {
    tintCanvas.width = canvas.width;
    tintCanvas.height = canvas.height;
  }
  const tintContext = tintCanvas?.getContext('2d') ?? null;
  if (tintCanvas && !tintContext) throw new Error('Text tint requires Canvas 2D support.');
  let disposed = false;
  const pending = new AbortController();
  let previousKey = '';
  let previousTintKey = '';
  let repaintTint: (() => void) | undefined;
  let previousTintGlyphs: HTMLElement[] = [];
  let fontRevision = 0;
  const fonts = baseHost.ownerDocument.fonts;
  const onFonts = () => {
    fontRevision++;
  };
  if (element.type === 'text') fonts?.addEventListener('loadingdone', onFonts);
  const ready = (async () => {
    if (element.type === 'text' && fonts) {
      // Match native text and document-font registration: a failed face may use the authored
      // fallback stack. Font-set readiness and actual mask/layout errors still propagate.
      await fonts
        .load(`${element.fontWeight} ${element.fontSize}px ${element.fontFamily}`, element.content)
        .catch(() => undefined);
      await fonts.ready;
    }
    if (element.type === 'image' || element.type === 'image-sequence') {
      const image = baseHost.querySelector('img');
      if (image) await waitForImage(image, pending.signal);
    }
  })();
  // The returned readiness promise still rejects for callers; suppress premature browser warnings.
  void ready.catch(() => {});
  const pathCache = new Map<string, Path2D>();
  const pathFor = (source: string) => {
    let path = pathCache.get(source);
    if (!path) {
      path = new Path2D(source);
      pathCache.set(source, path);
    }
    return path;
  };
  let rowCanvas: HTMLCanvasElement | undefined;
  let blurredRowCanvas: HTMLCanvasElement | undefined;
  let previousNativeCanvas: HTMLCanvasElement | null = null;

  function update(elapsedMs?: number): Promise<CanvasImageSource | null>;
  function update(
    elapsedMs: number,
    options: { immutableChartSnapshot: true },
  ): Promise<CanvasImageSource | ImageData | null>;
  async function update(
    elapsedMs = 0,
    updateOptions?: { immutableChartSnapshot: true },
  ): Promise<CanvasImageSource | ImageData | null> {
    await ready;
    if (disposed) throw new Error('Shader paint alpha has been disposed.');
    let layout = hostSize(baseHost, size);
    let key = JSON.stringify([element.type, layout]);
    if (element.type === 'rectangle') key += JSON.stringify(element.borderRadius);
    else if (element.type === 'path')
      key += JSON.stringify([
        element.d,
        element.fillRule,
        element.viewBoxWidth,
        element.viewBoxHeight,
        element.overflow,
      ]);
    else if (element.type === 'text') {
      const snapshotKey = () => {
        const content = textContent(baseHost);
        return (
          JSON.stringify([element.type, layout]) +
          JSON.stringify([textMaskSnapshot(content, !!tintCanvas), fontRevision])
        );
      };
      key = snapshotKey();
      if (key !== previousKey && options.refreshTextLayout) {
        // ResizeObserver can run after a paused/non-realtime capture is requested. Refresh the
        // same native fit synchronously, then cache its settled styles rather than a stale size.
        options.refreshTextLayout();
        layout = hostSize(baseHost, size);
        key = snapshotKey();
      }
    } else if (element.type === 'image' || element.type === 'image-sequence') {
      const image = baseHost.querySelector('img');
      if (image) await waitForImage(image, pending.signal);
      key += JSON.stringify([
        image?.currentSrc || image?.src,
        image?.naturalWidth,
        image?.naturalHeight,
      ]);
    } else if (element.type === 'lottie') {
      const native = baseHost.querySelector<HTMLCanvasElement>('canvas[data-ograf-lottie-canvas]');
      if (native !== previousNativeCanvas) previousKey = '';
      previousNativeCanvas = native;
      key += JSON.stringify([elapsedMs, native?.width, native?.height, native?.style.cssText]);
    } else if (element.type === 'chart') {
      const native = baseHost.querySelector<HTMLCanvasElement>(
        'canvas[data-ograf-chart-fill-mask]',
      );
      if (native !== previousNativeCanvas) previousKey = '';
      previousNativeCanvas = native;
      key += JSON.stringify([native?.width, native?.height, native?.dataset.ografChartRevision]);
    } else if (element.type === 'pattern') {
      key += JSON.stringify(
        [...baseHost.querySelectorAll('[data-ograf-pattern-row]')].map((row) =>
          row.getAttribute('x'),
        ),
      );
    }
    const tintGlyphs = tintCanvas
      ? [
          ...(textContent(baseHost)?.querySelectorAll<HTMLElement>(
            '[data-ograf-text-animator-glyph]',
          ) ?? []),
        ]
      : [];
    const tintKey = tintCanvas
      ? JSON.stringify(
          tintGlyphs.map((glyph) => glyph.style.getPropertyValue('--ograf-text-animator-tint')),
        )
      : '';
    if (
      tintCanvas &&
      (tintGlyphs.length !== previousTintGlyphs.length ||
        tintGlyphs.some((glyph, i) => glyph !== previousTintGlyphs[i]))
    )
      previousKey = '';
    if (key === previousKey) {
      if (tintCanvas && repaintTint && tintKey !== previousTintKey) {
        repaintTint();
        previousTintKey = tintKey;
        return canvas;
      }
      return null;
    }
    context.resetTransform();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
    let coverage: CanvasImageSource | ImageData = canvas;
    context.save();
    try {
      switch (element.type) {
        case 'rectangle': {
          context.scale(canvas.width / layout.width, canvas.height / layout.height);
          context.beginPath();
          const radii = element.borderRadius;
          context.roundRect(0, 0, layout.width, layout.height, [
            radii.topLeft,
            radii.topRight,
            radii.bottomRight,
            radii.bottomLeft,
          ]);
          context.fill();
          break;
        }
        case 'ellipse': {
          context.beginPath();
          context.ellipse(
            canvas.width / 2,
            canvas.height / 2,
            canvas.width / 2,
            canvas.height / 2,
            0,
            0,
            Math.PI * 2,
          );
          context.fill();
          break;
        }
        case 'path': {
          let bounds = { x: 0, y: 0, width: element.viewBoxWidth, height: element.viewBoxHeight };
          if (element.overflow === 'visible') bounds = editablePathBounds(element);
          context.scale(canvas.width / bounds.width, canvas.height / bounds.height);
          context.translate(-bounds.x, -bounds.y);
          context.fill(pathFor(element.d), element.fillRule ?? 'nonzero');
          break;
        }
        case 'text':
          if (tintCanvas && tintContext) {
            tintContext.resetTransform();
            tintContext.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
          }
          repaintTint = paintTextMask(
            baseHost,
            element,
            canvas,
            context,
            layout,
            options.slot ?? 'fill',
            Number.isFinite(options.padding) ? Math.max(0, options.padding ?? 0) : 0,
            tintContext,
          );
          break;
        case 'image':
        case 'image-sequence': {
          const image = baseHost.querySelector('img');
          if (!image) break;
          await waitForImage(image, pending.signal);
          if (disposed) throw new Error('Shader paint alpha has been disposed.');
          const source = { width: image.naturalWidth, height: image.naturalHeight };
          if (element.crop || (element.fit && element.fit !== 'contain')) {
            const crop = sourceCropPixels(source, element.crop);
            const box = croppedSourcePlacement(crop, canvas, undefined, element.fit ?? 'contain');
            context.drawImage(
              image,
              crop.x,
              crop.y,
              crop.width,
              crop.height,
              box.x,
              box.y,
              box.width,
              box.height,
            );
          } else {
            const box = shaderMaskContainRect(source, canvas);
            context.drawImage(image, box.x, box.y, box.width, box.height);
          }
          break;
        }
        case 'lottie': {
          const source = baseHost.querySelector<HTMLCanvasElement>(
            'canvas[data-ograf-lottie-canvas]',
          );
          if (!source) {
            if (element.animationData)
              throw new Error(
                'Shader Lottie alpha is unavailable before the native Canvas is ready.',
              );
            break;
          }
          const x = Number.parseFloat(source.style.left) || 0,
            y = Number.parseFloat(source.style.top) || 0;
          const width = pixelSize(source.style.width) || layout.width,
            height = pixelSize(source.style.height) || layout.height;
          context.scale(canvas.width / layout.width, canvas.height / layout.height);
          context.drawImage(source, x, y, width, height);
          break;
        }
        case 'pattern': {
          const pattern = element.definition;
          if (!pattern)
            throw new Error('Shader pattern alpha requires its resolved pattern definition.');
          rowCanvas ??= baseHost.ownerDocument.createElement('canvas');
          const resolution = Math.min(
            1,
            4096 / pattern.width,
            4096 / pattern.height,
            Math.sqrt((canvas.width * canvas.height) / (pattern.width * pattern.height)),
          );
          const rw = Math.max(1, Math.ceil(pattern.width * resolution)),
            rh = Math.max(1, Math.ceil(pattern.height * resolution));
          if (rowCanvas.width !== rw) rowCanvas.width = rw;
          if (rowCanvas.height !== rh) rowCanvas.height = rh;
          const rowContext = rowCanvas.getContext('2d');
          if (!rowContext)
            throw new Error('Shader pattern row alpha requires Canvas 2D rendering.');
          const sx = rw / pattern.width,
            sy = rh / pattern.height;
          for (const row of patternRows(pattern)) {
            rowContext.resetTransform();
            rowContext.clearRect(0, 0, rw, rh);
            rowContext.save();
            rowContext.scale(sx, sy);
            rowContext.beginPath();
            rowContext.rect(0, row.y, pattern.width, row.height);
            rowContext.clip();
            rowContext.fillStyle = '#ffffff';
            const native = baseHost.querySelector(`[data-ograf-pattern-row="${row.row}"]`);
            const offset = native
              ? Number(native.getAttribute('x'))
              : patternRowOffset(pattern, row, 0);
            if (!(row.period > 0) || !Number.isFinite(offset))
              throw new Error('Shader pattern row has invalid geometry.');
            const first = Math.floor(-offset / row.period) - 1;
            const last = Math.ceil((pattern.width - offset) / row.period) + 1;
            for (let repeat = first; repeat <= last; repeat++)
              for (const entry of row.entries) {
                const symbol = pattern.symbols.find((candidate) => candidate.key === entry.key)!;
                rowContext.save();
                rowContext.translate(offset + repeat * row.period + entry.x, row.y);
                rowContext.scale(
                  entry.width / symbol.viewBoxWidth,
                  entry.height / symbol.viewBoxHeight,
                );
                rowContext.fill(pathFor(symbol.d), symbol.fillRule);
                rowContext.restore();
              }
            rowContext.restore();
            context.globalAlpha = row.opacity;
            if (row.blur > 0) {
              blurredRowCanvas ??= baseHost.ownerDocument.createElement('canvas');
              if (blurredRowCanvas.width !== rw) blurredRowCanvas.width = rw;
              if (blurredRowCanvas.height !== rh) blurredRowCanvas.height = rh;
              const blurContext = blurredRowCanvas.getContext('2d');
              if (!blurContext)
                throw new Error('Shader pattern blur alpha requires Canvas 2D rendering.');
              blurContext.clearRect(0, 0, rw, rh);
              blurContext.filter = `blur(${row.blur * resolution}px)`;
              blurContext.drawImage(rowCanvas, 0, 0);
              context.drawImage(blurredRowCanvas, 0, 0, canvas.width, canvas.height);
            } else context.drawImage(rowCanvas, 0, 0, canvas.width, canvas.height);
          }
          break;
        }
        case 'chart': {
          const source = baseHost.querySelector<HTMLCanvasElement>(
            'canvas[data-ograf-chart-fill-mask]',
          );
          if (!source)
            throw new Error('Chart mark coverage is unavailable; use a mark-paint-v1 renderer.');
          // Hidden or newly mounted charts can have no backing pixels yet. Publish the
          // cleared coverage now; its size/revision key will repaint when it becomes visible.
          if (source.width > 0 && source.height > 0)
            context.drawImage(source, 0, 0, canvas.width, canvas.height);
          break;
        }
        case 'shader':
          context.fillRect(0, 0, canvas.width, canvas.height);
          break;
      }
      if (element.type === 'chart' && updateOptions?.immutableChartSnapshot) {
        // Resolve all raster tiles into owned pixels before WebGL uploads this frame. The
        // next chart draw may reuse both the provider mask and this staging Canvas.
        coverage = context.getImageData(0, 0, canvas.width, canvas.height);
      }
      // Force a readable-origin check before upload, giving a useful CORS error instead of a blank fill.
      if (
        element.type === 'image' ||
        element.type === 'image-sequence' ||
        element.type === 'lottie'
      )
        context.getImageData(0, 0, 1, 1);
    } catch (cause) {
      previousKey = '';
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (error.name === 'SecurityError')
        throw new Error(
          'Shader paint cannot read source alpha because the image or animation is cross-origin. Use embedded assets or a CORS-enabled source.',
        );
      throw error;
    } finally {
      context.restore();
    }
    previousKey = key;
    previousTintKey = tintKey;
    previousTintGlyphs = tintGlyphs;
    return coverage;
  }
  return {
    ready,
    update,
    textTint: () => tintCanvas,
    dispose() {
      disposed = true;
      pending.abort();
      fonts?.removeEventListener('loadingdone', onFonts);
      pathCache.clear();
      repaintTint = undefined;
      previousTintGlyphs = [];
      canvas.width = canvas.height = 1;
      if (tintCanvas) tintCanvas.width = tintCanvas.height = 1;
      if (rowCanvas) rowCanvas.width = rowCanvas.height = 1;
      if (blurredRowCanvas) blurredRowCanvas.width = blurredRowCanvas.height = 1;
    },
  };
}
