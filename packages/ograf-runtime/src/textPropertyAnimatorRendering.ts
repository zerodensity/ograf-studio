import { getTextGradientSource, tintGradientCss } from './textGradientTint';
import {
  readColor,
  paintToCss,
  segmentTextAnimationUnits,
  textAnimatorOrder,
  textAnimatorWeight,
  type TextElement,
  type TextPropertyAnimator,
} from '@ograf-editor/scene-model';
import { composeTextTint } from './textTintMask';
interface Glyph {
  element: HTMLElement;
  sourceIndex: number;
  word: number;
  line: number;
  baseColor?: number[];
  baseAlpha?: number;
  lastTint?: string;
  lastMaskedTint?: string;
}
interface Mounted {
  glyphs: Glyph[];
  words: number;
  width: number;
  height: number;
  lineCount: number;
  ranks: Map<string, number[]>;
  dynamicRoll: boolean;
  rollGlyphs: WeakMap<HTMLElement, Glyph>;
  rollSource?: string;
  rollUnits?: Array<{ text: string; index: number }>;
  rollWords?: Array<{ text: string; index: number }>;
  tintCache: Map<string, string>;
}
const mounted = new WeakMap<HTMLElement, Mounted>();
const gradientWrites = new WeakMap<HTMLElement, { requested: string; applied: string }>();
/** Wrap graphemes inside existing preset segments, so preset transforms and glyph transforms compose. */
export function mountTextPropertyAnimators(content: HTMLElement, element: TextElement): void {
  const animators = element.textAnimation.animators;
  if (!animators?.some((a) => a.enabled)) return;
  const dynamicRoll =
    element.textAnimation.type === 'roll-up' ||
    element.textAnimation.type === 'roll-down' ||
    ((element.textAnimation.type === 'count-up' || element.textAnimation.type === 'count-down') &&
      (element.textAnimation.countRoll === 'up' || element.textAnimation.countRoll === 'down'));
  const source = element.runs.length
    ? element.runs.map((run) => run.text).join('')
    : element.content;
  const shapingGroup = content.querySelector<HTMLElement>('[data-ograf-text-shaping-group]');
  const words = shapingGroup
    ? [{ text: source, index: 0 }]
    : segmentTextAnimationUnits(source, 'word', element.language).filter((item) =>
        item.text.trim(),
      );
  const glyphs: Glyph[] = [];
  if (shapingGroup) {
    // The preset moves the outer block. Apply property animation to its intact inner text flow.
    const wrapper = content.ownerDocument.createElement('span');
    wrapper.dataset.ografTextAnimatorGlyph = 'true';
    wrapper.style.display = 'block';
    wrapper.append(...shapingGroup.childNodes);
    shapingGroup.appendChild(wrapper);
    glyphs.push({ element: wrapper, sourceIndex: 0, word: 0, line: 0 });
  } else if (!dynamicRoll) {
    const walker = content.ownerDocument.createTreeWalker(
      content,
      5 /* SHOW_ELEMENT | SHOW_TEXT */,
    );
    const nodes: Node[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
      if (el?.closest('[data-ograf-text-cursor], [data-ograf-text-count-spacer]')) continue;
      if (node.nodeType === 1 && (node as HTMLElement).dataset.ografTextCountPart !== undefined)
        nodes.push(node);
      else if (node.nodeType === 3 && !el?.closest('[data-ograf-text-count-part]'))
        nodes.push(node);
    }
    let offset = 0;
    const wordFor = (sourceIndex: number) => {
      let index = words.findIndex(
        (word) => sourceIndex >= word.index && sourceIndex < word.index + word.text.length,
      );
      if (index < 0) {
        const next = words.findIndex((word) => word.index > sourceIndex);
        index = next < 0 ? Math.max(0, words.length - 1) : Math.max(0, next - 1);
      }
      return index;
    };
    for (const node of nodes) {
      if (node.nodeType === 1) {
        const item = node as HTMLElement;
        const text = item.textContent ?? '';
        const wrapper = content.ownerDocument.createElement('span');
        wrapper.dataset.ografTextAnimatorGlyph = 'true';
        wrapper.dataset.ografAnimatorDynamic = 'count';
        wrapper.style.display = 'inline-block';
        item.parentNode?.replaceChild(wrapper, item);
        wrapper.appendChild(item);
        glyphs.push({ element: wrapper, sourceIndex: offset, word: wordFor(offset), line: 0 });
        offset += text.length;
        continue;
      }
      const text = (node as Text).data;
      const fragment = content.ownerDocument.createDocumentFragment();
      for (const part of segmentTextAnimationUnits(text, 'grapheme', element.language)) {
        if (/^(?:\r\n|\r|\n)$/.test(part.text)) {
          fragment.appendChild(content.ownerDocument.createTextNode(part.text));
          continue;
        }
        const span = content.ownerDocument.createElement('span');
        span.dataset.ografTextAnimatorGlyph = 'true';
        span.style.display = 'inline-block';
        if (/^\s+$/u.test(part.text)) span.style.whiteSpace = 'pre';
        span.textContent = part.text;
        const sourceIndex = offset + part.index;
        glyphs.push({ element: span, sourceIndex, word: wordFor(sourceIndex), line: 0 });
        fragment.appendChild(span);
      }
      offset += text.length;
      node.parentNode?.replaceChild(fragment, node);
    }
  }
  mounted.set(content, {
    glyphs,
    words: Math.max(1, words.length),
    width: -1,
    height: -1,
    lineCount: 1,
    ranks: new Map(),
    dynamicRoll,
    rollGlyphs: new WeakMap(),
    tintCache: new Map(),
  });
  void content.ownerDocument.fonts?.ready.then(() => {
    const state = mounted.get(content);
    if (state) state.width = -1;
  });
}
/** Rolling cells are reused by the preset renderer; wrap each cell once, not each sampled frame. */
function syncRollingGlyphs(content: HTMLElement, state: Mounted, element: TextElement): void {
  const slots = [...content.querySelectorAll<HTMLElement>('[data-ograf-text-roll-slot]')];
  const source = element.runs.length
    ? element.runs.map((run) => run.text).join('')
    : element.content;
  if (state.rollSource !== source) {
    state.rollSource = source;
    state.rollUnits = segmentTextAnimationUnits(source, 'grapheme', element.language);
    state.rollWords = segmentTextAnimationUnits(source, 'word', element.language).filter((item) =>
      item.text.trim(),
    );
  }
  const units = state.rollUnits ?? [];
  const words = state.rollWords ?? [];
  const active: Glyph[] = [];
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index]!;
    let glyph = state.rollGlyphs.get(slot);
    if (!glyph) {
      const wrapper = content.ownerDocument.createElement('span');
      wrapper.dataset.ografTextAnimatorGlyph = 'true';
      wrapper.dataset.ografAnimatorDynamic = 'roll';
      wrapper.style.display = 'inline-block';
      wrapper.style.verticalAlign = 'bottom';
      slot.parentNode?.replaceChild(wrapper, slot);
      wrapper.appendChild(slot);
      glyph = { element: wrapper, sourceIndex: 0, word: 0, line: 0 };
      state.rollGlyphs.set(slot, glyph);
    }
    const display = slot.style.display === 'contents' ? 'contents' : 'inline-block';
    if (glyph.element.style.display !== display) glyph.element.style.display = display;
    if (slot.style.display === 'none' || slot.style.display === 'contents') continue;
    glyph.sourceIndex = units[index]?.index ?? source.length;
    const wordIndex = words.findIndex(
      (word) =>
        glyph!.sourceIndex >= word.index && glyph!.sourceIndex < word.index + word.text.length,
    );
    glyph.word = wordIndex < 0 ? Math.max(0, words.length - 1) : wordIndex;
    active.push(glyph);
  }
  if (
    active.length !== state.glyphs.length ||
    active.some((glyph, index) => glyph !== state.glyphs[index])
  ) {
    state.width = -1;
    state.glyphs = active;
  }
  state.words = Math.max(1, words.length);
}

function groups(state: Mounted, animator: TextPropertyAnimator) {
  if (animator.unit === 'word') return { count: state.words, index: (glyph: Glyph) => glyph.word };
  if (animator.unit === 'line')
    return { count: state.lineCount, index: (glyph: Glyph) => glyph.line };
  return { count: state.glyphs.length, index: (_glyph: Glyph, i: number) => i };
}
export function renderTextPropertyAnimators(
  content: HTMLElement,
  element: TextElement,
  frame: number,
): void {
  const state = mounted.get(content);
  const animators = element.textAnimation.animators?.filter((a) => a.enabled) ?? [];
  if (!state || !animators.length) return;
  if (state.dynamicRoll) syncRollingGlyphs(content, state, element);
  if (
    animators.some((a) => a.unit === 'line') &&
    (state.width !== content.clientWidth || state.height !== content.clientHeight)
  ) {
    const lines: number[] = [];
    for (const glyph of state.glyphs) {
      const top = glyph.element.offsetTop;
      let line = lines.findIndex((y) => Math.abs(y - top) < 1);
      if (line < 0) {
        line = lines.length;
        lines.push(top);
      }
      glyph.line = line;
    }
    state.lineCount = Math.max(1, lines.length);
    state.width = content.clientWidth;
    state.height = content.clientHeight;
  }
  const preparations = animators.map((animator) => {
    const group = groups(state, animator);
    const key = `${group.count}:${animator.order}:${animator.seed}`;
    let ranks = state.ranks.get(key);
    if (!ranks) {
      ranks = textAnimatorOrder(group.count, animator.order, animator.seed);
      state.ranks.set(key, ranks);
    }
    return { animator, group, ranks };
  });
  const shaderBase = content.closest<HTMLElement>('[data-ograf-shader-base]');
  const shaderMasked = !!shaderBase;
  const shaderTintEnabled = shaderBase?.dataset.ografExperimentalShaderTint === 'true';
  const masked = shaderMasked || !!content.closest('[data-ograf-media-base]');
  const gradient = masked ? undefined : getTextGradientSource(content);
  const gradientKey = gradient ? JSON.stringify(gradient) : '';
  const solid = !masked && !gradient && typeof (element.fill ?? element.color) === 'string';
  const hasColorAnimator = preparations.some(({ animator }) => !!animator.properties.color);
  state.glyphs.forEach((glyph, i) => {
    let x = 0,
      y = 0,
      scale = 1,
      rotation = 0,
      opacity = 1,
      blur = 0,
      tracking = 0;
    let color: number[] | null = null;
    const tints: Array<{ color: string; weight: number }> = [];
    if (
      solid &&
      glyph.baseColor === undefined &&
      preparations.some(({ animator }) => !!animator.properties.color)
    ) {
      const computed = content.ownerDocument.defaultView?.getComputedStyle(glyph.element).color;
      const base = readColor(computed) ?? readColor(element.color);
      glyph.baseColor = base?.rgb ?? [0, 0, 0];
      glyph.baseAlpha = base?.alpha ?? 1;
    }
    for (const { animator, group, ranks } of preparations) {
      const index = group.index(glyph, i);
      const weight = textAnimatorWeight(animator, index, group.count, ranks[index] ?? index, frame);
      if (!weight) continue;
      const p = animator.properties;
      x += (p.x ?? 0) * weight;
      y += (p.y ?? 0) * weight;
      scale *= 1 + ((p.scale ?? 1) - 1) * weight;
      rotation += (p.rotation ?? 0) * weight;
      opacity *= 1 + ((p.opacity ?? 1) - 1) * weight;
      blur += (p.blur ?? 0) * weight;
      tracking += (p.tracking ?? 0) * weight;
      if ((gradient || shaderTintEnabled) && p.color) tints.push({ color: p.color, weight });
      if (solid && p.color && glyph.baseColor) {
        const to = readColor(p.color);
        if (to) {
          const fromColor: number[] = color ?? glyph.baseColor;
          const amount = weight * to.alpha;
          color = fromColor.map((v: number, j: number) => v + (to.rgb[j]! - v) * amount);
        }
      }
    }
    const style = glyph.element.style;
    const transform = `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`;
    const alpha = String(Math.max(0, Math.min(1, opacity)));
    const filter = blur > 0 ? `blur(${blur}px)` : '';
    const spacing = tracking ? `${tracking}px` : '';
    const tint = color ? `rgba(${color.map(Math.round).join(', ')}, ${glyph.baseAlpha ?? 1})` : '';
    if (style.transform !== transform) style.transform = transform;
    if (style.opacity !== alpha) style.opacity = alpha;
    if (style.filter !== filter) style.filter = filter;
    if (style.letterSpacing !== spacing) {
      style.letterSpacing = spacing;
      if (animators.some((item) => item.unit === 'line')) state.width = -1;
    }
    if (glyph.lastTint !== tint) {
      style.color = tint;
      glyph.lastTint = tint;
    }
    if (shaderTintEnabled && hasColorAnimator) {
      const combined = composeTextTint(tints);
      const encoded = `rgba(${combined.rgb.map(Math.round).join(', ')}, ${combined.weight})`;
      if (glyph.lastMaskedTint !== encoded) {
        style.setProperty('--ograf-text-animator-tint', encoded);
        glyph.lastMaskedTint = encoded;
      }
    } else if (glyph.lastMaskedTint !== undefined) {
      style.removeProperty('--ograf-text-animator-tint');
      delete glyph.lastMaskedTint;
    }
    if (gradient && hasColorAnimator) {
      const key = JSON.stringify([gradientKey, tints]);
      let paint = state.tintCache.get(key);
      if (!paint) {
        paint = tints.length ? tintGradientCss(gradient, tints) : paintToCss(gradient);
        if (state.tintCache.size >= 512) state.tintCache.clear();
        state.tintCache.set(key, paint);
      }
      const hosts =
        glyph.element.dataset.ografAnimatorDynamic === 'roll'
          ? [...glyph.element.querySelectorAll<HTMLElement>('[data-ograf-text-roll-paint]')]
          : [glyph.element];
      for (const host of hosts) {
        const previous = gradientWrites.get(host);
        if (
          !previous ||
          previous.requested !== paint ||
          host.style.backgroundImage !== previous.applied
        ) {
          host.style.backgroundImage = paint;
          gradientWrites.set(host, { requested: paint, applied: host.style.backgroundImage });
        }
      }
    }
  });
}
