import {
  editablePathBounds,
  patternRows,
  patternRowOffset,
  type Element,
  type TextElement,
} from '@ograf-editor/scene-model';

export interface ShaderPaintMask {
  ready: Promise<void>;
  /** Call after the native image/sequence/Lottie/pattern content has reached the requested time. */
  update(elapsedMs?: number): Promise<CanvasImageSource | null>;
  dispose(): void;
}

export interface ShaderPaintMaskOptions {
  /** Text strokes use the same native layout and centered glyph outlines; fill remains the default. */
  slot?: 'fill' | 'stroke';
  /** Shared CSS-pixel expansion around text fill/stroke output, independent of backing scale. */
  padding?: number;
  /** Invoke the native fitter after fonts/layout are ready; never fit independently in the mask. */
  refreshTextLayout?: () => void;
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
}

/** Read native line positions; the browser remains responsible for wrapping and font shaping. */
function textLines(content: HTMLElement, origin: DOMRect): TextLine[] {
  const node = content.firstChild;
  if (!node || node.nodeType !== 3) return [];
  const text = node.textContent ?? '';
  const lines: TextLine[] = [];
  let current: TextLine | undefined;
  let offset = 0;
  const range = content.ownerDocument.createRange();
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
    if (!rect || rect.height <= 0) continue;
    const top = rect.top - origin.top;
    if (!current || Math.abs(current.top - top) > 0.5) {
      current = { text: '', x: rect.left - origin.left, top };
      lines.push(current);
    }
    current.text += character;
    current.x = Math.min(current.x, rect.left - origin.left);
  }
  range.detach();
  return lines;
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
): void {
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
  // Retain native fitting results, tracking and line grid, including programmatically loaded fonts.
  for (const property of [
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
  ]) {
    content.style.setProperty(property, computed.getPropertyValue(property));
  }
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
  context.save();
  try {
    const origin = wrapper.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    const lines = textLines(content, origin);
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
    const clipX = clips(computed.overflowX),
      clipY = clips(computed.overflowY);
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
    context.font = `${computed.fontStyle || 'normal'} ${computed.fontWeight || element.fontWeight} ${computed.fontSize || `${element.fontSize}px`} ${computed.fontFamily || element.fontFamily}`;
    context.fontKerning = computed.fontKerning as CanvasFontKerning;
    context.letterSpacing = computed.letterSpacing === 'normal' ? '0px' : computed.letterSpacing;
    context.wordSpacing = computed.wordSpacing === 'normal' ? '0px' : computed.wordSpacing;
    context.direction = computed.direction === 'rtl' ? 'rtl' : 'ltr';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#ffffff';
    if (slot === 'stroke') {
      context.strokeStyle = '#ffffff';
      context.lineWidth = strokeWidth;
      context.lineJoin = ['bevel', 'round', 'miter'].includes(computed.strokeLinejoin)
        ? (computed.strokeLinejoin as CanvasLineJoin)
        : 'miter';
      const miterLimit = Number.parseFloat(computed.strokeMiterlimit);
      // Match the native CSS text outline, instead of Canvas's default miter limit of ten.
      context.miterLimit = Number.isFinite(miterLimit) && miterLimit > 0 ? miterLimit : 4;
    }
    const metrics = context.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent;
    if (!Number.isFinite(ascent))
      throw new Error('Shader text alpha requires browser font bounding-box metrics.');
    for (const line of lines) {
      let text = transformedText(line.text, computed.textTransform);
      if (shaderMaskUsesEllipsis(computed))
        text = shaderMaskEllipsis(
          text,
          Math.max(0, layout.width - line.x),
          (value) => context.measureText(value).width,
        );
      if (slot === 'stroke') context.strokeText(text, line.x, line.top + ascent);
      else context.fillText(text, line.x, line.top + ascent);
    }
  } finally {
    context.restore();
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
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Shader paint alpha requires Canvas 2D rendering support.');
  let disposed = false;
  const pending = new AbortController();
  let previousKey = '';
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

  const update = async (elapsedMs = 0): Promise<CanvasImageSource | null> => {
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
          JSON.stringify([content?.style.cssText, content?.textContent, fontRevision])
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
    } else if (element.type === 'pattern') {
      key += JSON.stringify(
        [...baseHost.querySelectorAll('[data-ograf-pattern-row]')].map((row) =>
          row.getAttribute('x'),
        ),
      );
    }
    if (key === previousKey) return null;
    context.resetTransform();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
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
          paintTextMask(
            baseHost,
            element,
            canvas,
            context,
            layout,
            options.slot ?? 'fill',
            Number.isFinite(options.padding) ? Math.max(0, options.padding ?? 0) : 0,
          );
          break;
        case 'image':
        case 'image-sequence': {
          const image = baseHost.querySelector('img');
          if (!image) break;
          await waitForImage(image, pending.signal);
          if (disposed) throw new Error('Shader paint alpha has been disposed.');
          const box = shaderMaskContainRect(
            { width: image.naturalWidth, height: image.naturalHeight },
            canvas,
          );
          context.drawImage(image, box.x, box.y, box.width, box.height);
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
        case 'shader':
          context.fillRect(0, 0, canvas.width, canvas.height);
          break;
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
    return canvas;
  };
  return {
    ready,
    update,
    dispose() {
      disposed = true;
      pending.abort();
      fonts?.removeEventListener('loadingdone', onFonts);
      pathCache.clear();
      canvas.width = canvas.height = 1;
      if (rowCanvas) rowCanvas.width = rowCanvas.height = 1;
      if (blurredRowCanvas) blurredRowCanvas.width = blurredRowCanvas.height = 1;
    },
  };
}
