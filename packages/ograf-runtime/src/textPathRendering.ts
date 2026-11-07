import {
  createTextPathGeometry,
  layoutTextPathUnits,
  segmentTextAnimationUnits,
  isGradientPaint,
  gradientStopColor,
  textPathCompatibilityErrors,
  type TextPathGeometry,
  type TextElement,
  type LayerTransform,
  type PathElement,
  type Paint,
  type GradientPaint,
  type Element as SceneElement,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import type { CompiledLayerVisualState } from './loopRendering';
import { getTextGradientSource } from './textGradientTint';

interface PathGlyph {
  element: HTMLElement;
  text: string;
  font: string;
  ascent: number;
  height: number;
  letterSpacing: number;
  caseMode: string;
  gradientChildren?: Array<{ element: HTMLElement; offset: number }>;
}
interface MountedPathText {
  glyphs: PathGlyph[];
  widths: number[];
  geometry?: TextPathGeometry | undefined;
  offset?: number;
  alignment?: 'start' | 'center' | 'end';
  rolling?: boolean;
  rollingUnits?: HTMLElement[] | undefined;
  rollingText?: string[];
  counting?: boolean;
  countSignature?: string | undefined;
  metricsContext?: CanvasRenderingContext2D;
  metricsCache?: Map<string, number>;
  glyphMetadata?: WeakMap<HTMLElement, PathGlyph>;
  gradient?: GradientPaint | undefined;
  gradientKey?: string;
  gradientHosts?: HTMLElement[];
  gradientPaints?: Map<HTMLElement, string>;
  rtl?: boolean;
  fontSize?: string;
}
const mounted = new WeakMap<HTMLElement, MountedPathText>();
const geometries = new WeakMap<HTMLElement, { key: string; geometry: TextPathGeometry }>();
const checkedText = new WeakMap<HTMLElement, string>();

export function textPathAdvance(previous: number, next: number, letterSpacing: number): number {
  const value = next - previous + letterSpacing;
  if (!Number.isFinite(value) || value < 0)
    throw new Error('Text path tracking makes a glyph advance invalid.');
  return value;
}

export function layoutDirectionalPathUnits(
  geometry: TextPathGeometry,
  widths: readonly number[],
  startOffset: number,
  alignment: 'start' | 'center' | 'end',
  rtl: boolean,
) {
  return rtl
    ? layoutTextPathUnits(geometry, [...widths].reverse(), startOffset, alignment).reverse()
    : layoutTextPathUnits(geometry, widths, startOffset, alignment);
}

function measuredCase(value: string, mode: string): string {
  if (mode === 'uppercase') return value.toUpperCase();
  if (mode === 'lowercase') return value.toLowerCase();
  return value;
}

/** Bounded adjacent-pair shaping preserves common kerning without quadratic prefix work. */
function measurePathWidths(
  glyphs: PathGlyph[],
  context: CanvasRenderingContext2D,
  cache = new Map<string, number>(),
): number[] {
  if (cache.size > 4096) cache.clear();
  let previous = '',
    font = '',
    caseMode = '';
  return glyphs.map((glyph) => {
    if (font !== glyph.font || caseMode !== glyph.caseMode) {
      previous = '';
      font = glyph.font;
      caseMode = glyph.caseMode;
      context.font = font;
    }
    const text = measuredCase(glyph.text, glyph.caseMode);
    if (!text) return 0;
    const key = JSON.stringify([font, previous, text]);
    let advance = cache.get(key);
    if (advance === undefined) {
      const previousWidth = previous ? context.measureText(previous).width : 0;
      advance = context.measureText(previous + text).width - previousWidth;
      cache.set(key, advance);
    }
    previous = text;
    // A word-reveal unit is one positioned span but retains CSS tracking for
    // every grapheme inside that span, not just one tracking increment per word.
    const units =
      glyph.element.dataset.ografTextPathPreset === 'true' && text.length > 1
        ? segmentTextAnimationUnits(text, 'grapheme').length
        : 1;
    return textPathAdvance(0, advance, glyph.letterSpacing * units);
  });
}

/** Cache character origins once per word; animated frames never read layout. */
function measureWordGradientChildren(
  glyph: PathGlyph,
  context: CanvasRenderingContext2D,
  view: Window,
): void {
  const children = [
    ...glyph.element.querySelectorAll<HTMLElement>('[data-ograf-text-animator-glyph]'),
  ];
  if (!children.length) {
    delete glyph.gradientChildren;
    return;
  }
  const units: PathGlyph[] = children.map((element) => {
    const style = view.getComputedStyle(element);
    return {
      element,
      text: element.textContent ?? '',
      font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      ascent: glyph.ascent,
      height: glyph.height,
      letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
      caseMode: style.textTransform,
    };
  });
  const widths = measurePathWidths(units, context);
  let offset = 0;
  glyph.gradientChildren = children.map((element, index) => {
    const result = { element, offset };
    offset += widths[index] ?? 0;
    return result;
  });
}

export function resolveTextPathPaint(
  content: HTMLElement,
  paint: Paint | undefined,
): Paint | undefined {
  return isGradientPaint(paint) ? (getTextGradientSource(content) ?? paint) : paint;
}

/** Path geometry and font widths are recomputed only when their inputs change. */
export function cachedTextPathGeometry(
  content: HTMLElement,
  path: PathElement,
  source: LayerTransform,
  target: LayerTransform,
  sourceScale = 1,
  targetScale = 1,
): TextPathGeometry {
  const origin = (value: LayerTransform, scale: number) => {
    const angle = (value.rotation * Math.PI) / 180,
      x = value.transformOriginX * value.width,
      y = value.transformOriginY * value.height;
    return {
      x: value.x + x - scale * (x * Math.cos(angle) - y * Math.sin(angle)),
      y: value.y + y - scale * (x * Math.sin(angle) + y * Math.cos(angle)),
    };
  };
  const sourceOrigin = origin(source, sourceScale),
    targetOrigin = origin(target, targetScale),
    angle = (-target.rotation * Math.PI) / 180;
  const dx = sourceOrigin.x - targetOrigin.x,
    dy = sourceOrigin.y - targetOrigin.y;
  const round = (value: number) => Math.round(value * 1e9) / 1e9;
  const relative = [
    round((dx * Math.cos(angle) - dy * Math.sin(angle)) / (targetScale || 1)),
    round((dx * Math.sin(angle) + dy * Math.cos(angle)) / (targetScale || 1)),
    round(source.rotation - target.rotation),
    source.width,
    source.height,
    target.width,
    target.height,
    targetScale <= 1e-9 ? 'collapsed' : round(sourceScale / targetScale),
  ];
  const key = JSON.stringify([path.d, path.viewBoxWidth, path.viewBoxHeight, relative]);
  const previous = geometries.get(content);
  if (previous?.key === key) return previous.geometry;
  let geometry: TextPathGeometry;
  try {
    geometry =
      targetScale <= 1e-9
        ? { length: 0, sample: () => null }
        : createTextPathGeometry(path, source, target, sourceScale, targetScale);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('no length')) throw error;
    geometry = { length: 0, sample: () => null };
  }
  geometries.set(content, { key, geometry });
  return geometry;
}

export function assertTextPathFxSupported(element: TextElement, host?: HTMLElement): void {
  const key = host?.dataset.ografRenderedElement ?? JSON.stringify(element);
  if (host && checkedText.get(host) === key) return;
  const errors = textPathCompatibilityErrors(element);
  if (errors.length) throw new Error(errors.join(' '));
  if (host) checkedText.set(host, key);
}

/**
 * Prepare a stable grapheme subtree while retaining existing text FX and rich-run ancestors.
 * Only static and opacity-based FX are currently supported by the guarded integration.
 */
export function mountTextPathGlyphs(
  content: HTMLElement,
  language = '',
  paint?: Paint,
  transformPreset = false,
  wordPreset = false,
  rtl = false,
): void {
  const gradient = isGradientPaint(paint) ? paint : undefined;
  const existing = mounted.get(content);
  if (existing) {
    if (existing.rtl !== rtl) {
      existing.rtl = rtl;
      existing.geometry = undefined;
    }
    const key = JSON.stringify(gradient ?? null);
    if (existing.gradientKey !== key) {
      if (gradient && !existing.gradient) {
        const context = content.ownerDocument.createElement('canvas').getContext('2d');
        const view = content.ownerDocument.defaultView;
        if (context && view)
          for (const glyph of existing.glyphs)
            if (glyph.element.dataset.ografTextPathWord === 'true')
              measureWordGradientChildren(glyph, context, view);
      }
      if (!gradient)
        for (const target of existing.gradientPaints?.keys() ?? []) {
          target.style.backgroundImage = '';
          target.style.backgroundSize = '';
          target.style.backgroundPosition = '';
          target.style.backgroundClip = '';
          target.style.webkitBackgroundClip = '';
          target.style.color = '';
          target.style.webkitTextFillColor = '';
        }
      existing.gradient = gradient;
      existing.gradientKey = key;
      existing.geometry = undefined;
    }
    return;
  }
  if (content.querySelector('[data-ograf-text-roll-value]')) {
    const state: MountedPathText = {
      glyphs: [],
      widths: [],
      rolling: true,
      gradient,
      gradientKey: JSON.stringify(gradient ?? null),
      gradientHosts: [content],
      rtl,
      fontSize: content.style.fontSize,
    };
    mounted.set(content, state);
    void content.ownerDocument.fonts?.ready.then(() => {
      if (mounted.get(content) !== state) return;
      state.glyphMetadata = new WeakMap();
      state.metricsCache?.clear();
      state.rollingUnits = undefined;
      const { geometry, offset, alignment } = state;
      if (geometry) renderTextPathGlyphs(content, geometry, offset, alignment);
    });
    return;
  }
  if (content.querySelector('[data-ograf-text-count-value]')) {
    const state: MountedPathText = {
      glyphs: [],
      widths: [],
      counting: true,
      gradient,
      gradientKey: JSON.stringify(gradient ?? null),
      gradientHosts: [content],
      rtl,
      fontSize: content.style.fontSize,
    };
    mounted.set(content, state);
    void content.ownerDocument.fonts?.ready.then(() => {
      if (mounted.get(content) !== state) return;
      state.glyphMetadata = new WeakMap();
      state.metricsCache?.clear();
      state.countSignature = undefined;
      const { geometry, offset, alignment } = state;
      if (geometry) renderTextPathGlyphs(content, geometry, offset, alignment);
    });
    return;
  }
  // Gradient FX makes the flow positioned; path glyph coordinates must instead use the
  // text content's local origin, independent of the flex row's vertical alignment.
  const flow = content.querySelector<HTMLElement>('[data-ograf-text-flow="true"]');
  if (flow) flow.style.position = 'static';
  const owner = content.ownerDocument;
  const walker = owner.createTreeWalker(content, 4);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (!node.parentElement?.closest('[data-ograf-text-cursor]')) nodes.push(node as Text);
  const glyphs: PathGlyph[] = [];
  const context = owner.createElement('canvas').getContext('2d');
  const view = owner.defaultView;
  if (!context || !view) throw new Error('Text path measurement is unavailable.');
  if (transformPreset) {
    const segments: Node[] =
      wordPreset && flow
        ? [...flow.childNodes]
        : [...content.querySelectorAll<HTMLElement>('[data-ograf-text-segment]')];
    for (const segment of segments) {
      if (segment.nodeType !== 1 && segment.nodeType !== 3) continue;
      const text = segment.textContent ?? '';
      if (!text) continue;
      if (!wordPreset && segmentTextAnimationUnits(text, 'grapheme', language).length !== 1)
        throw new Error('Transform presets on path text require grapheme splitting.');
      const style = view.getComputedStyle(
          segment.nodeType === 1 ? (segment as HTMLElement) : flow!,
        ),
        font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.font = font;
      const metrics = context.measureText('Mg'),
        ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
      if (!Number.isFinite(ascent) || ascent <= 0)
        throw new Error('Text path needs font ascent metrics.');
      const wrapper = owner.createElement('span');
      wrapper.dataset.ografTextPathGlyph = 'true';
      wrapper.dataset.ografTextPathPreset = 'true';
      if (wordPreset) wrapper.dataset.ografTextPathWord = 'true';
      Object.assign(wrapper.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        display: 'inline-block',
        whiteSpace: 'pre',
        transformOrigin: '0 0',
      });
      segment.parentNode?.insertBefore(wrapper, segment);
      wrapper.appendChild(segment);
      const glyph: PathGlyph = {
        element: wrapper,
        text,
        font,
        ascent,
        height:
          Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 16) * 1.2,
        letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
        caseMode: style.textTransform,
      };
      if (wordPreset && gradient) measureWordGradientChildren(glyph, context, view);
      glyphs.push(glyph);
    }
  }
  for (const node of transformPreset ? [] : nodes) {
    const parent = node.parentElement;
    if (!parent) continue;
    const style = view.getComputedStyle(parent);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.font = font;
    const metrics = context.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
    if (!Number.isFinite(ascent) || ascent <= 0)
      throw new Error('Text path needs font ascent metrics.');
    const parts = segmentTextAnimationUnits(node.data, 'grapheme', language);
    if (
      parent.dataset.ografTextAnimatorGlyph === 'true' &&
      parent.childNodes.length === 1 &&
      parts.length === 1
    ) {
      const wrapper = owner.createElement('span');
      wrapper.dataset.ografTextPathGlyph = 'true';
      wrapper.dataset.ografTextPathAnimator = 'true';
      Object.assign(wrapper.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        display: 'inline-block',
        whiteSpace: 'pre',
        transformOrigin: '0 0',
      });
      parent.parentNode?.insertBefore(wrapper, parent);
      wrapper.appendChild(parent);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      glyphs.push({
        element: wrapper,
        text: parts[0]!.text,
        font,
        ascent,
        height: Number.parseFloat(style.lineHeight) || fontSize * 1.2,
        letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
        caseMode: style.textTransform,
      });
      continue;
    }
    const fragment = owner.createDocumentFragment();
    for (const part of parts) {
      if (/[\r\n]/.test(part.text)) throw new Error('Text on a path currently supports one line.');
      const glyph = owner.createElement('span');
      glyph.dataset.ografTextPathGlyph = 'true';
      glyph.textContent = part.text;
      Object.assign(glyph.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        display: 'inline-block',
        whiteSpace: 'pre',
        transformOrigin: '0 0',
      });
      fragment.appendChild(glyph);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const height = Number.parseFloat(style.lineHeight) || fontSize * 1.2;
      glyphs.push({
        element: glyph,
        text: part.text,
        font,
        ascent,
        height,
        letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
        caseMode: style.textTransform,
      });
    }
    node.parentNode?.replaceChild(fragment, node);
  }
  const widths = measurePathWidths(glyphs, context);
  const gradientHosts = [
    content,
    ...content.querySelectorAll<HTMLElement>(
      '[data-ograf-text-segment], [data-ograf-text-segment-inner]:not([data-ograf-text-roll-paint]), [data-ograf-text-animator-glyph]',
    ),
  ];
  const state: MountedPathText = {
    glyphs,
    widths,
    gradient,
    gradientKey: JSON.stringify(gradient ?? null),
    gradientHosts,
    rtl,
    fontSize: content.style.fontSize,
  };
  mounted.set(content, state);
  // Refresh once fonts settle, including while paused; no per-frame font measurements.
  if (owner.fonts && glyphs.length) {
    const unique = [...new Set(glyphs.map((glyph) => glyph.font))];
    void Promise.all(unique.map((face) => owner.fonts.load(face).catch(() => [])))
      .then(() => owner.fonts.ready)
      .then(() => {
        if (mounted.get(content) !== state) return;
        state.glyphs.forEach((glyph) => {
          const style = view.getComputedStyle(glyph.element);
          glyph.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          context.font = glyph.font;
          const metrics = context.measureText('Mg');
          glyph.ascent =
            metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || glyph.ascent;
          glyph.height =
            Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 16) * 1.2;
          glyph.letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
          glyph.caseMode = style.textTransform;
          if (state.gradient && glyph.element.dataset.ografTextPathWord === 'true')
            measureWordGradientChildren(glyph, context, view);
        });
        state.widths = measurePathWidths(state.glyphs, context);
        const { geometry, offset, alignment } = state;
        state.geometry = undefined;
        if (geometry) renderTextPathGlyphs(content, geometry, offset, alignment);
      })
      .catch(() => {
        /* The original measurement uses the browser fallback font. */
      });
  }
}

/** Apply an absolute geometry snapshot; the result does not depend on earlier frames. */
export function renderTextPathGlyphs(
  content: HTMLElement,
  geometry: TextPathGeometry,
  startOffset = 0,
  alignment: 'start' | 'center' | 'end' = 'start',
): void {
  const state = mounted.get(content);
  if (!state) throw new Error('Text path glyphs are not mounted.');
  if (state.fontSize !== content.style.fontSize) {
    state.fontSize = content.style.fontSize;
    state.geometry = undefined;
    if (state.rolling || state.counting) {
      state.glyphMetadata = new WeakMap();
      state.metricsCache = new Map();
      state.rollingUnits = undefined;
      state.countSignature = undefined;
    } else {
      const view = content.ownerDocument.defaultView;
      const context = content.ownerDocument.createElement('canvas').getContext('2d');
      if (!view || !context) throw new Error('Text path measurement is unavailable.');
      for (const glyph of state.glyphs) {
        const style = view.getComputedStyle(glyph.element);
        glyph.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.font = glyph.font;
        const metrics = context.measureText('Mg');
        glyph.ascent =
          metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || glyph.ascent;
        glyph.height =
          Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 16) * 1.2;
        glyph.letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
        if (state.gradient && glyph.element.dataset.ografTextPathWord === 'true')
          measureWordGradientChildren(glyph, context, view);
      }
      state.widths = measurePathWidths(state.glyphs, context);
    }
  }
  if (state.rolling) refreshRollingPathGlyphs(content, state);
  if (state.counting) refreshCountingPathGlyphs(content, state);
  const { glyphs, widths } = state;
  if (
    state.geometry !== geometry ||
    state.offset !== startOffset ||
    state.alignment !== alignment
  ) {
    // Each RTL word remains a shaped DOM unit. Reverse their path order, not
    // the characters inside each word, so the first logical word is rightmost.
    const placements = layoutDirectionalPathUnits(
      geometry,
      widths,
      startOffset,
      alignment,
      state.rtl ?? false,
    );
    const parentWidth = content.clientWidth,
      parentHeight = content.clientHeight;
    if (state.gradient) state.gradientPaints = new Map();
    glyphs.forEach((glyph, index) => {
      const position = placements[index];
      const visibility = position ? '' : 'hidden';
      if (glyph.element.style.visibility !== visibility)
        glyph.element.style.visibility = visibility;
      if (!position) return;
      const transform = `translate(${position.x}px, ${position.y}px) rotate(${position.angle}deg) translate(${-position.width / 2}px, ${-glyph.ascent}px)`;
      if (glyph.element.style.transform !== transform) glyph.element.style.transform = transform;
      if (state.gradient) {
        const degrees = (state.gradient.angle * Math.PI) / 180,
          dx = Math.sin(degrees),
          dy = -Math.cos(degrees);
        const rotation = (position.angle * Math.PI) / 180;
        const centerY = glyph.height / 2 - glyph.ascent;
        const centerX = position.x - Math.sin(rotation) * centerY;
        const centerWorldY = position.y + Math.cos(rotation) * centerY;
        const localAngle = state.gradient.angle - position.angle;
        const stops = state.gradient.stops;
        let paint: string;
        if (state.gradient.type === 'linear') {
          const globalLength = Math.abs(parentWidth * dx) + Math.abs(parentHeight * dy) || 1;
          const centerFraction =
            0.5 +
            ((centerX - parentWidth / 2) * dx + (centerWorldY - parentHeight / 2) * dy) /
              globalLength;
          const localRadians = (localAngle * Math.PI) / 180;
          const localLength =
            Math.abs(position.width * Math.sin(localRadians)) +
              Math.abs(glyph.height * Math.cos(localRadians)) || 1;
          paint = `linear-gradient(${localAngle}deg, ${stops.map((stop) => `${gradientStopColor(stop)} ${50 + (((stop.offset - centerFraction) * globalLength) / localLength) * 100}%`).join(', ')})`;
        } else {
          const dxCenter = parentWidth / 2 - position.x,
            dyCenter = parentHeight / 2 - position.y;
          const localX =
            Math.cos(rotation) * dxCenter + Math.sin(rotation) * dyCenter + position.width / 2;
          const localY =
            -Math.sin(rotation) * dxCenter + Math.cos(rotation) * dyCenter + glyph.ascent;
          const cssStops = stops
            .map((stop) => `${gradientStopColor(stop)} ${stop.offset * 100}%`)
            .join(', ');
          paint =
            state.gradient.type === 'radial'
              ? `radial-gradient(circle ${Math.hypot(parentWidth / 2, parentHeight / 2)}px at ${localX}px ${localY}px, ${cssStops})`
              : `conic-gradient(from ${localAngle}deg at ${localX}px ${localY}px, ${cssStops})`;
        }
        const presetTarget =
          glyph.element.dataset.ografTextPathPreset === 'true'
            ? glyph.element.querySelector<HTMLElement>(
                '[data-ograf-text-animator-glyph], [data-ograf-text-segment-inner], [data-ograf-text-segment]',
              )
            : null;
        const animatorTarget =
          glyph.element.dataset.ografTextPathAnimator === 'true'
            ? glyph.element.querySelector<HTMLElement>('[data-ograf-text-animator-glyph]')
            : null;
        const targets = state.rolling
          ? [...glyph.element.querySelectorAll<HTMLElement>('[data-ograf-text-roll-paint]')]
          : glyph.gradientChildren?.length
            ? glyph.gradientChildren.map((child) => child.element)
            : presetTarget || animatorTarget
              ? [presetTarget ?? animatorTarget!]
              : glyph.element.dataset.ografTextPathPreset === 'true'
                ? []
                : [glyph.element];
        for (const target of targets) {
          target.style.backgroundImage = paint;
          const child = glyph.gradientChildren?.find((item) => item.element === target);
          if (child) {
            target.style.backgroundSize = `${position.width}px ${glyph.height}px`;
            target.style.backgroundPosition = `${-child.offset}px 0px`;
            target.style.backgroundRepeat = 'no-repeat';
          }
          state.gradientPaints!.set(target, target.style.backgroundImage);
          target.style.backgroundClip = 'text';
          target.style.webkitBackgroundClip = 'text';
          target.style.color = 'transparent';
          target.style.webkitTextFillColor = 'transparent';
        }
      }
    });
    state.geometry = geometry;
    state.offset = startOffset;
    state.alignment = alignment;
  }
  if (state.gradient)
    for (const host of state.gradientHosts ?? []) {
      if (state.gradientPaints?.has(host)) continue;
      if (host.style.backgroundImage !== 'none') host.style.backgroundImage = 'none';
      if (host.style.backgroundColor !== 'transparent') host.style.backgroundColor = 'transparent';
    }
  if (state.gradient)
    for (const [target, paint] of state.gradientPaints ?? []) {
      if (target.style.backgroundImage !== paint) target.style.backgroundImage = paint;
    }
  const cursor = content.querySelector<HTMLElement>('[data-ograf-text-cursor]');
  const nextGlyph = cursor?.nextElementSibling?.querySelector<HTMLElement>(
    '[data-ograf-text-path-glyph]',
  );
  if (cursor && nextGlyph) {
    if (cursor.style.position !== 'absolute') cursor.style.position = 'absolute';
    if (cursor.style.left !== '0px') cursor.style.left = '0';
    if (cursor.style.top !== '0px') cursor.style.top = '0';
    if (cursor.style.transformOrigin !== '0px 0px') cursor.style.transformOrigin = '0 0';
    if (cursor.style.transform !== nextGlyph.style.transform)
      cursor.style.transform = nextGlyph.style.transform;
  }
}

/** Count parts keep their animation-owned nodes; replace only text nodes changed by a new value. */
function refreshCountingPathGlyphs(content: HTMLElement, state: MountedPathText): void {
  const value = content.querySelector<HTMLElement>('[data-ograf-text-count-value]');
  if (!value) throw new Error('Counting text path content is unavailable.');
  const signature = value.textContent ?? '';
  if (
    signature === state.countSignature &&
    state.glyphs.every((glyph) => value.contains(glyph.element))
  )
    return;
  const owner = content.ownerDocument,
    view = owner.defaultView,
    context = state.metricsContext ?? owner.createElement('canvas').getContext('2d');
  if (!view || !context) throw new Error('Text path measurement is unavailable.');
  state.metricsContext = context;
  state.metricsCache ??= new Map();
  state.glyphMetadata ??= new WeakMap();
  for (const part of value.querySelectorAll<HTMLElement>('[data-ograf-text-count-part]'))
    part.dataset.ografCountPath = 'true';
  // The animator owns each part, so put path placement outside that stable
  // wrapper, including empty reserved slots which may become visible later.
  for (const animator of value.querySelectorAll<HTMLElement>(
    '[data-ograf-animator-dynamic="count"]',
  )) {
    if (animator.parentElement?.dataset.ografTextPathGlyph === 'true') continue;
    const wrapper = owner.createElement('span');
    wrapper.dataset.ografTextPathGlyph = 'true';
    wrapper.dataset.ografTextPathAnimator = 'true';
    Object.assign(wrapper.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      display: 'inline-block',
      whiteSpace: 'pre',
      transformOrigin: '0 0',
    });
    animator.parentNode?.insertBefore(wrapper, animator);
    wrapper.appendChild(animator);
  }
  const walker = owner.createTreeWalker(value, 4),
    nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (!node.parentElement?.closest('[data-ograf-text-path-glyph]')) nodes.push(node as Text);
  for (const node of nodes) {
    const animator = node.parentElement?.closest<HTMLElement>('[data-ograf-text-animator-glyph]');
    if (animator && segmentTextAnimationUnits(node.data, 'grapheme').length <= 1) {
      if (animator.parentElement?.dataset.ografTextPathGlyph !== 'true') {
        const wrapper = owner.createElement('span');
        wrapper.dataset.ografTextPathGlyph = 'true';
        wrapper.dataset.ografTextPathAnimator = 'true';
        Object.assign(wrapper.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          display: 'inline-block',
          whiteSpace: 'pre',
          transformOrigin: '0 0',
        });
        animator.parentNode?.insertBefore(wrapper, animator);
        wrapper.appendChild(animator);
      }
      continue;
    }
    const fragment = owner.createDocumentFragment();
    for (const part of segmentTextAnimationUnits(node.data, 'grapheme')) {
      const glyph = owner.createElement('span');
      glyph.dataset.ografTextPathGlyph = 'true';
      glyph.textContent = part.text;
      Object.assign(glyph.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        display: 'inline-block',
        whiteSpace: 'pre',
        transformOrigin: '0 0',
      });
      fragment.appendChild(glyph);
    }
    node.parentNode?.replaceChild(fragment, node);
  }
  const glyphs = [...value.querySelectorAll<HTMLElement>('[data-ograf-text-path-glyph]')].map(
    (element) => {
      const existing = state.glyphMetadata!.get(element);
      if (existing) {
        existing.text = element.textContent ?? '';
        return existing;
      }
      const measurementHost =
        element.dataset.ografTextPathAnimator === 'true'
          ? (element.querySelector<HTMLElement>('[data-ograf-text-animator-glyph]') ?? element)
          : element;
      const style = view.getComputedStyle(measurementHost),
        font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.font = font;
      const metrics = context.measureText('Mg'),
        ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
      if (!Number.isFinite(ascent) || ascent <= 0)
        throw new Error('Text path needs font ascent metrics.');
      const glyph = {
        element,
        text: element.textContent ?? '',
        font,
        ascent,
        height:
          Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 16) * 1.2,
        letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
        caseMode: style.textTransform,
      };
      state.glyphMetadata!.set(element, glyph);
      return glyph;
    },
  );
  state.glyphs = glyphs;
  state.widths = measurePathWidths(glyphs, context, state.metricsCache);
  state.countSignature = signature;
  state.geometry = undefined;
  state.gradientHosts = [
    content,
    ...content.querySelectorAll<HTMLElement>(
      '[data-ograf-text-segment], [data-ograf-text-animator-glyph]',
    ),
  ];
}

/** Reuse stable rolling cells; only remeasure when a cell's text or membership changes. */
function refreshRollingPathGlyphs(content: HTMLElement, state: MountedPathText): void {
  const slots = [...content.querySelectorAll<HTMLElement>('[data-ograf-text-roll-slot]')].filter(
    (slot) => slot.style.display !== 'none',
  );
  const texts = slots.map(
    (slot) => slot.querySelector('[data-ograf-text-roll-slot-spacer]')?.textContent ?? '',
  );
  if (
    state.rollingUnits?.length === slots.length &&
    slots.every(
      (slot, index) =>
        state.rollingUnits?.[index] === slot && state.rollingText?.[index] === texts[index],
    )
  )
    return;
  const owner = content.ownerDocument,
    view = owner.defaultView,
    context = state.metricsContext ?? owner.createElement('canvas').getContext('2d');
  if (!view || !context) throw new Error('Text path measurement is unavailable.');
  state.metricsContext = context;
  state.metricsCache ??= new Map();
  state.glyphMetadata ??= new WeakMap();
  const glyphs: PathGlyph[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const unit =
      slot.parentElement?.dataset.ografTextAnimatorGlyph === 'true' ? slot.parentElement : slot;
    let wrapper =
      unit.parentElement?.dataset.ografTextPathRoll === 'true' ? unit.parentElement : null;
    if (!wrapper) {
      wrapper = owner.createElement('span');
      wrapper.dataset.ografTextPathRoll = 'true';
      Object.assign(wrapper.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        display: 'inline-block',
        whiteSpace: 'pre',
        transformOrigin: '0 0',
      });
      unit.parentNode?.insertBefore(wrapper, unit);
      wrapper.appendChild(unit);
    }
    const existing = state.glyphMetadata.get(wrapper);
    if (existing) {
      existing.text = texts[i]!;
      glyphs.push(existing);
      continue;
    }
    const style = view.getComputedStyle(slot),
      nextFont = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.font = nextFont;
    const metrics = context.measureText('Mg'),
      ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
    if (!Number.isFinite(ascent) || ascent <= 0)
      throw new Error('Text path needs font ascent metrics.');
    const text = texts[i]!;
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
    const glyph = {
      element: wrapper,
      text,
      font: nextFont,
      ascent,
      height:
        Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 16) * 1.2,
      letterSpacing,
      caseMode: style.textTransform,
    };
    state.glyphMetadata.set(wrapper, glyph);
    glyphs.push(glyph);
  }
  state.glyphs = glyphs;
  state.widths = measurePathWidths(glyphs, context, state.metricsCache);
  state.rollingUnits = slots;
  state.rollingText = texts;
  state.geometry = undefined;
  state.gradientHosts = [
    content,
    ...content.querySelectorAll<HTMLElement>(
      '[data-ograf-text-segment], [data-ograf-text-animator-glyph]',
    ),
  ];
}

/** Internal prototype. Export remains guarded while unsupported FX and paint paths are audited. */
export function applyCompiledTextPaths(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
  hosts: Map<string, HTMLElement>,
  resolve: (layer: CompiledGraphicDescriptor['layers'][number]) => SceneElement = (layer) =>
    layer.element,
): void {
  for (const layer of descriptor.layers) {
    if (!layer.textPath) continue;
    const source = descriptor.layers.find(
      (candidate) => candidate.id === layer.textPath!.sourceLayerId,
    );
    const sourceState = states.get(layer.textPath.sourceLayerId),
      targetState = states.get(layer.id);
    const sourceElement = source && resolve(source),
      targetElement = resolve(layer);
    const content = hosts
      .get(layer.id)
      ?.querySelector<HTMLElement>('[data-ograf-modifier-text="true"]');
    if (
      !source ||
      sourceElement?.type !== 'path' ||
      targetElement.type !== 'text' ||
      !sourceState ||
      !targetState ||
      !content
    )
      throw new Error(`Text path source or content is unavailable for ${layer.name}.`);
    assertTextPathFxSupported(targetElement, hosts.get(layer.id));
    const paint = resolveTextPathPaint(content, targetElement.fill);
    mountTextPathGlyphs(
      content,
      targetElement.language,
      paint,
      ['rise', 'pop', 'flip', 'blur', 'rotate', 'stretch', 'word-reveal'].includes(
        targetElement.textAnimation.type,
      ),
      targetElement.textAnimation.type === 'word-reveal',
      targetElement.direction === 'rtl',
    );
    const geometry = cachedTextPathGeometry(
      content,
      sourceElement,
      sourceState.transform,
      targetState.transform,
      Math.max(0, sourceState.paintTracks.scale?.[0]?.value ?? 1),
      Math.max(0, targetState.paintTracks.scale?.[0]?.value ?? 1),
    );
    const targetScale = Math.max(0, targetState.paintTracks.scale?.[0]?.value ?? 1);
    renderTextPathGlyphs(
      content,
      geometry,
      targetScale > 0 ? layer.textPath.startOffset / targetScale : 0,
      layer.textPath.alignment,
    );
  }
}
