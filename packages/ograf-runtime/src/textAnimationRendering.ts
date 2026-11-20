import { setTextGradientSource } from './textGradientTint';
import type { GradientPaint } from '@ograf-editor/scene-model';
import { hasTextAnimationSettings } from '@ograf-editor/scene-model';
import {
  mountTextPropertyAnimators,
  renderTextPropertyAnimators,
} from './textPropertyAnimatorRendering';
import {
  isAnimatedTextSegment,
  isCountingTextAnimation,
  isRollingTextAnimation,
  normalizeTextAnimation,
  parseTextAnimationNumber,
  sampleTextCountAnimation,
  sampleTextCountRoll,
  segmentTextAnimationUnits,
  textAnimationSegmentProgress,
  textAnimationSegmentVisual,
  textAnimationSplit,
  usesShapedTextMotion,
  visibleTextAnimationSegmentCount,
  type TextAnimation,
  type TextElement,
  type TextRun,
} from '@ograf-editor/scene-model';

interface StyledRange {
  start: number;
  end: number;
  run: TextRun;
}

const animatedGradients = new WeakMap<
  HTMLElement,
  { paint: string; signature?: string; layoutKey?: string; fontWaited?: boolean }
>();
// Shown glyphs inherit rather than force `visible`: a child with `visible` paints through a
// hidden ancestor, so a hidden layer, shared proxy or staged playout copy would leak its text.
const SHOWN = 'inherit';

interface MountedTextCount {
  source: string;
  prefix: string;
  suffix: string;
  numericLength: number;
  parts: Array<{ node: HTMLElement; start: number; end: number }>;
  lastSample?: string;
}

const mountedTextCounts = new WeakMap<HTMLElement, MountedTextCount>();

interface RollUnit {
  text: string;
  index: number;
}

interface RollSlot {
  host: HTMLElement;
  spacer: HTMLElement;
  outgoing: HTMLElement;
  incoming: HTMLElement;
  from: string;
  to: string;
}

interface ShapedRoll {
  motion: HTMLElement;
  prefix: HTMLElement;
  anchor: HTMLElement;
  reference: HTMLElement;
  slots: HTMLElement;
  suffix: HTMLElement;
  settled: HTMLElement;
  complete: boolean;
  labels?: string;
}

interface MountedTextRoll {
  element: TextElement;
  source: string;
  previous: TextElement | null;
  previousIdentity: string;
  value: HTMLElement;
  slots: RollSlot[];
  activeSlots: number;
  shaped?: ShapedRoll;
  lastPair?: string;
  lastFrame: number;
}

const mountedTextRolls = new WeakMap<HTMLElement, MountedTextRoll>();
interface ShapedTypewriter {
  source: string;
  ranges: StyledRange[];
  starts: number[];
  prefix: HTMLElement;
  cursor: HTMLElement | null;
  end?: number;
}

const shapedTypewriters = new WeakMap<HTMLElement, ShapedTypewriter>();
const shapedWordAnimations = new WeakMap<
  HTMLElement,
  { parent: HTMLElement; words: Node[]; settled: HTMLElement; complete: boolean }
>();
// A font or viewport resize can add copies while playback is paused. Keep the logical update
// predecessor and sampled frame on the track so new copies can reproduce the current pose.
const mountedCrawlAnimations = new WeakMap<
  HTMLElement,
  { frame: number; previous: TextElement | null }
>();

export function refreshTextCrawlAnimation(container: HTMLElement, element: TextElement): void {
  if (!hasTextAnimationSettings(element.textAnimation)) return;
  const track = container.querySelector<HTMLElement>('[data-ograf-text-crawl-track="true"]');
  if (!track) return;
  const retained = mountedCrawlAnimations.get(track);
  const replayFrame = Number(container.dataset.ografTextAnimationFrame);
  const frame = retained?.frame ?? (Number.isFinite(replayFrame) ? replayFrame : 0);
  setTextAnimationPrevious(container, retained?.previous ?? null);
  renderTextAnimationAtFrame(container, element, frame);
}

/** Measure the completed text flow without allowing entrance transforms to inflate scroll bounds. */
export function measureTextAnimationLayout<T>(content: HTMLElement, measure: () => T): T {
  const glyphs = [
    ...content.querySelectorAll<HTMLElement>(
      '[data-ograf-text-segment], [data-ograf-text-segment-inner], [data-ograf-text-animator-glyph]',
    ),
  ];
  const transforms = glyphs.map((glyph) => glyph.style.transform);
  const counts = [
    ...content.querySelectorAll<HTMLElement>(
      '[data-ograf-text-count-value], [data-ograf-text-roll-value], [data-ograf-typewriter-value]',
    ),
  ];
  const displays = counts.map((count) => count.style.display);
  for (const glyph of glyphs) glyph.style.transform = 'none';
  // The hidden authored text determines fitting and wrapping. Intermediate digits never do.
  for (const count of counts) count.style.display = 'none';
  try {
    return measure();
  } finally {
    glyphs.forEach((glyph, index) => {
      glyph.style.transform = transforms[index]!;
    });
    counts.forEach((count, index) => {
      count.style.display = displays[index]!;
    });
  }
}

/** Paint each moving glyph locally while retaining one gradient across the entire text box. */
export function applyTextAnimationGradient(
  content: HTMLElement,
  paint: string,
  source?: GradientPaint,
): boolean {
  if (source) setTextGradientSource(content, source);
  const flow = content.querySelector<HTMLElement>('[data-ograf-text-flow="true"]');
  if (!flow) return false;
  const previous = animatedGradients.get(content);
  if (previous?.paint !== paint) animatedGradients.set(content, { paint });
  // Ancestor background-clip:text does not composite transformed/filtered descendant glyphs
  // reliably. Keep the paint on the same node as its animated opacity, transform and filter.
  content.style.backgroundImage = 'none';
  content.style.backgroundColor = 'transparent';
  if (!content.style.position) content.style.position = 'relative';
  flow.style.position = 'relative';
  refreshTextAnimationGradient(content, flow);
  return true;
}

export function refreshTextAnimationGradient(
  content: HTMLElement,
  flow = content.querySelector<HTMLElement>('[data-ograf-text-flow="true"]'),
): void {
  const gradient = animatedGradients.get(content);
  if (!gradient || !flow || !content.clientWidth || !content.clientHeight) return;
  const width = content.clientWidth;
  const height = content.clientHeight;
  const segments = [...flow.querySelectorAll<HTMLElement>('[data-ograf-text-segment]')];
  // Layout positions are stable while only opacity/transform changes. Avoid forcing layout for
  // every animation frame; changed text, typography, tracking, size or font readiness invalidates.
  const animatorGlyphs = [
    ...flow.querySelectorAll<HTMLElement>(
      '[data-ograf-text-animator-glyph]:not([data-ograf-animator-dynamic="roll"])',
    ),
  ];
  const paintHosts = animatorGlyphs.length
    ? animatorGlyphs
    : segments.flatMap((segment) => {
        const rollPaints = [
          ...segment.querySelectorAll<HTMLElement>('[data-ograf-text-roll-paint]'),
        ];
        return rollPaints.length
          ? rollPaints
          : [segment.querySelector<HTMLElement>('[data-ograf-text-segment-inner]') ?? segment];
      });
  const layoutKey = JSON.stringify([
    gradient.paint,
    width,
    height,
    flow.textContent,
    paintHosts.length,
    // A roll cell with no successor collapses when the roll ends, moving every cell after it.
    segments.map((segment) => segment.style.display),
    content.style.fontFamily,
    content.style.fontSize,
    content.style.fontWeight,
    content.style.letterSpacing,
    content.style.lineHeight,
    content.style.textAlign,
    content.style.justifyContent,
    paintHosts.map((host) => [
      host.style.fontFamily,
      host.style.fontSize,
      host.style.fontWeight,
      host.style.letterSpacing,
    ]),
  ]);
  if (content.isConnected && gradient.layoutKey === layoutKey) return;
  gradient.layoutKey = layoutKey;
  if (!gradient.fontWaited && content.ownerDocument.fonts?.ready) {
    gradient.fontWaited = true;
    void content.ownerDocument.fonts.ready.then(() => {
      if (animatedGradients.get(content) === gradient) delete gradient.layoutKey;
    });
  }
  // Read all untransformed layout offsets before writing any paint style.
  const placements = paintHosts.map((host) => {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = host;
    while (node && node !== content) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return { host, x, y };
  });
  const signature = JSON.stringify([
    gradient.paint,
    width,
    height,
    placements.map(({ x, y }) => [x, y]),
  ]);
  if (signature === gradient.signature) return;
  for (const { host, x, y } of placements) {
    host.style.backgroundImage = gradient.paint;
    host.style.backgroundSize = `${width}px ${height}px`;
    host.style.backgroundPosition = `${-x}px ${-y}px`;
    host.style.backgroundRepeat = 'no-repeat';
    host.style.backgroundClip = 'text';
    host.style.webkitBackgroundClip = 'text';
  }
  gradient.signature = signature;
}

function textSource(element: TextElement): string {
  return element.runs.length ? element.runs.map((run) => run.text).join('') : element.content;
}

function styledRanges(runs: TextRun[]): StyledRange[] {
  let offset = 0;
  return runs.map((run) => {
    const range = { start: offset, end: offset + run.text.length, run };
    offset = range.end;
    return range;
  });
}

function applyRunStyle(element: HTMLElement, run: TextRun): void {
  if (run.color) element.style.color = run.color;
  if (run.fontWeight !== undefined) element.style.fontWeight = String(run.fontWeight);
  if (run.fontStyle) element.style.fontStyle = run.fontStyle;
  if (run.fontFamily) element.style.fontFamily = run.fontFamily;
}

function appendStyledText(
  target: HTMLElement,
  text: string,
  sourceIndex: number,
  ranges: StyledRange[],
): void {
  if (ranges.length === 0) {
    target.textContent = text;
    return;
  }
  const end = sourceIndex + text.length;
  let cursor = sourceIndex;
  while (cursor < end) {
    const range = ranges.find((candidate) => cursor >= candidate.start && cursor < candidate.end);
    if (!range) {
      target.append(text.slice(cursor - sourceIndex));
      break;
    }
    const sliceEnd = Math.min(end, range.end);
    const span = target.ownerDocument.createElement('span');
    span.textContent = text.slice(cursor - sourceIndex, sliceEnd - sourceIndex);
    applyRunStyle(span, range.run);
    target.appendChild(span);
    cursor = sliceEnd;
  }
}

function usesShapedReveal(source: string, element: TextElement): boolean {
  return (
    element.direction === 'rtl' ||
    /[\p{Script=Arabic}\p{Script=Hebrew}\p{Bidi_Control}]/u.test(source)
  );
}

function createTypewriterCursor(
  flow: HTMLElement,
  color: string,
  kind: 'bar' | 'block',
): HTMLElement {
  const cursor = flow.ownerDocument.createElement('span');
  cursor.dataset.ografTextCursor = kind;
  cursor.setAttribute('aria-hidden', 'true');
  Object.assign(cursor.style, {
    display: 'inline-block',
    width: kind === 'block' ? '0.55em' : '0.08em',
    minWidth: kind === 'block' ? '0.55em' : '2px',
    height: '0.9em',
    background: color === 'transparent' ? '#ffffff' : color,
    opacity: '1',
  });
  return cursor;
}

function mountShapedTypewriter(
  flow: HTMLElement,
  source: string,
  ranges: StyledRange[],
  element: TextElement,
  animation: TextAnimation,
): void {
  const document = flow.ownerDocument;
  const layout = document.createElement('span');
  layout.style.display = 'block';
  layout.style.visibility = 'hidden';
  appendStyledText(layout, source, 0, ranges);
  flow.style.position = 'relative';
  flow.appendChild(layout);

  const value = document.createElement('span');
  value.dataset.ografTypewriterValue = 'true';
  value.dataset.ografTextSegment = '0';
  value.dataset.ografTextShapingGroup = 'true';
  Object.assign(value.style, { display: 'block', position: 'absolute', inset: '0' });
  flow.appendChild(value);

  const prefix = document.createElement('span');
  value.appendChild(prefix);
  const cursor =
    animation.cursor === 'none'
      ? null
      : createTypewriterCursor(flow, element.color, animation.cursor);
  const anchor = cursor ? document.createElement('span') : null;
  if (cursor && anchor) {
    anchor.style.position = 'relative';
    Object.assign(cursor.style, {
      position: 'absolute',
      insetInlineStart: '0',
      marginInlineStart: '0.08em',
    });
    anchor.appendChild(cursor);
    value.appendChild(anchor);
  }
  const starts = segmentTextAnimationUnits(source, animation.split, element.language)
    .filter((record) => isAnimatedTextSegment(record, animation.split))
    .map((record) => record.index);
  const state = { source, ranges, starts, prefix, cursor };
  shapedTypewriters.set(flow, state);
  renderShapedTypewriter(state, animation, 0);
}

function renderShapedTypewriter(state: ShapedTypewriter, animation: TextAnimation, frame: number) {
  const count = visibleTextAnimationSegmentCount(
    state.starts.length,
    frame,
    animation.durationFrames,
  );
  const end = state.starts[count] ?? state.source.length;
  if (end !== state.end) {
    // Let the browser shape the entire visible prefix, including partially typed Urdu words.
    if (state.ranges.length) state.prefix.replaceChildren();
    appendStyledText(state.prefix, state.source.slice(0, end), 0, state.ranges);
    state.end = end;
  }
  if (!state.cursor) return;
  const complete = count >= state.starts.length;
  const blinkOn = Math.floor(Math.max(0, frame) / animation.cursorBlinkFrames) % 2 === 0;
  state.cursor.style.display = complete ? 'none' : 'inline-block';
  state.cursor.style.opacity = blinkOn ? '1' : '0';
}

function mountCountingText(
  flow: HTMLElement,
  source: string,
  element: TextElement,
  ranges: StyledRange[],
): void {
  const parsed = parseTextAnimationNumber(source, element.language);
  const value = flow.ownerDocument.createElement('span');
  value.dataset.ografTextSegment = '0';
  value.style.display = 'block';
  value.style.opacity = '1';
  value.style.visibility = SHOWN;
  // A nonnumeric label stays fully readable; it must not enter the glyph-fade code path.
  if (!parsed) {
    appendStyledText(value, source, 0, ranges);
    flow.appendChild(value);
    return;
  }

  flow.style.position = 'relative';
  const spacer = flow.ownerDocument.createElement('span');
  spacer.dataset.ografTextCountSpacer = 'true';
  spacer.style.display = 'block';
  spacer.style.visibility = 'hidden';
  spacer.style.pointerEvents = 'none';
  appendStyledText(spacer, source, 0, ranges);
  flow.appendChild(spacer);
  value.dataset.ografTextCountValue = 'true';
  Object.assign(value.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
  });
  const prefix = flow.ownerDocument.createElement('span');
  appendStyledText(prefix, parsed.prefix, 0, ranges);
  value.appendChild(prefix);
  const numeric = source.slice(parsed.numberStart, parsed.numberEnd);
  const parts: MountedTextCount['parts'] = [];
  // Animated count parts need stable slots even when the starting number has more
  // characters than the destination. Empty leading slots are cheap and retain
  // their animator/path wrappers when a sign or digit appears during playback.
  if (element.textAnimation.animators?.some((animator) => animator.enabled)) {
    const initial = sampleTextCountAnimation(
      source,
      normalizeTextAnimation(element.textAnimation),
      0,
      element.language,
    );
    const initialNumber =
      initial === null ? null : parseTextAnimationNumber(initial, element.language);
    const extra = Math.max(
      0,
      (initialNumber?.numberEnd ?? 0) - (initialNumber?.numberStart ?? 0) - numeric.length,
    );
    for (let index = extra; index > 0; index--) {
      const node = flow.ownerDocument.createElement('span');
      node.dataset.ografTextCountPart = 'true';
      const leadingRange = ranges.find(
        (candidate) => parsed.numberStart >= candidate.start && parsed.numberStart < candidate.end,
      );
      if (leadingRange) applyRunStyle(node, leadingRange.run);
      value.appendChild(node);
      parts.push({ node, start: -index, end: 1 - index });
    }
  }
  let cursor = parsed.numberStart;
  while (cursor < parsed.numberEnd) {
    const range = ranges.find((candidate) => cursor >= candidate.start && cursor < candidate.end);
    let end = Math.min(parsed.numberEnd, range?.end ?? parsed.numberEnd);
    if (element.textAnimation.animators?.some((animator) => animator.enabled)) {
      const first = segmentTextAnimationUnits(
        source.slice(cursor, end),
        'grapheme',
        element.language,
      )[0];
      if (first) end = cursor + first.text.length;
    }
    const node = flow.ownerDocument.createElement('span');
    node.dataset.ografTextCountPart = 'true';
    node.textContent = source.slice(cursor, end);
    if (range) applyRunStyle(node, range.run);
    value.appendChild(node);
    parts.push({ node, start: cursor - parsed.numberStart, end: end - parsed.numberStart });
    cursor = end;
  }
  const suffix = flow.ownerDocument.createElement('span');
  appendStyledText(suffix, parsed.suffix, parsed.numberEnd, ranges);
  value.appendChild(suffix);
  flow.appendChild(value);
  mountedTextCounts.set(flow, {
    source,
    prefix: parsed.prefix,
    suffix: parsed.suffix,
    numericLength: numeric.length,
    parts,
  });
}

/** Keep path glyph nodes stable while an animated count changes without changing length. */
export function updatePathCountGlyphs(node: HTMLElement, slice: string, language: string): boolean {
  if (node.dataset.ografCountPath !== 'true') return false;
  const glyphs = [...node.children].filter(
    (child) => (child as HTMLElement).dataset.ografTextPathGlyph === 'true',
  ) as HTMLElement[];
  if (!glyphs.length || glyphs.length !== node.children.length) return false;
  const parts = segmentTextAnimationUnits(slice, 'grapheme', language);
  if (glyphs.length === 1 && parts.length === 0) {
    glyphs[0]!.textContent = '';
    return true;
  }
  if (glyphs.length !== parts.length) return false;
  glyphs.forEach((glyph, i) => {
    if (glyph.textContent !== parts[i]!.text) glyph.textContent = parts[i]!.text;
  });
  return true;
}

function renderCountingText(flow: HTMLElement, element: TextElement, frame: number): void {
  const state = mountedTextCounts.get(flow);
  if (!state) return;
  const sample = sampleTextCountAnimation(
    state.source,
    normalizeTextAnimation(element.textAnimation),
    frame,
    element.language,
  );
  if (sample === null || state.lastSample === sample) return;
  const numeric = sample.slice(state.prefix.length, sample.length - state.suffix.length);
  const shift = numeric.length - state.numericLength;
  state.parts.forEach(({ node, start, end }, index) => {
    // Keep run styling anchored to the least-significant digits as the number gains/loses digits.
    const slice = numeric.slice(
      index === 0 ? 0 : Math.max(0, start + shift),
      Math.max(0, end + shift),
    );
    if (node.textContent !== slice && !updatePathCountGlyphs(node, slice, element.language))
      node.textContent = slice;
  });
  state.lastSample = sample;
}

function alignedRollUnits(
  from: string,
  to: string,
  split: 'grapheme' | 'word',
  language: string,
): Array<{ from: RollUnit; to: RollUnit }> {
  const units = (source: string, offset = 0) =>
    segmentTextAnimationUnits(source, split, language).map((unit) => ({
      ...unit,
      index: unit.index + offset,
    }));
  const blank = { text: '', index: 0 };
  const align = (oldUnits: RollUnit[], newUnits: RollUnit[]) => {
    const count = Math.max(oldUnits.length, newUnits.length);
    return Array.from({ length: count }, (_, index) => ({
      from: oldUnits[index - count + oldUnits.length] ?? blank,
      to: newUnits[index - count + newUnits.length] ?? blank,
    }));
  };
  const oldNumber = parseTextAnimationNumber(from, language);
  const newNumber = parseTextAnimationNumber(to, language);
  if (
    split === 'grapheme' &&
    oldNumber &&
    newNumber &&
    oldNumber.prefix === newNumber.prefix &&
    oldNumber.suffix === newNumber.suffix
  ) {
    return [
      ...align(units(oldNumber.prefix), units(newNumber.prefix)),
      ...align(
        units(from.slice(oldNumber.numberStart, oldNumber.numberEnd), oldNumber.numberStart),
        units(to.slice(newNumber.numberStart, newNumber.numberEnd), newNumber.numberStart),
      ),
      ...align(
        units(oldNumber.suffix, oldNumber.numberEnd),
        units(newNumber.suffix, newNumber.numberEnd),
      ),
    ];
  }
  const oldUnits = units(from);
  const newUnits = units(to);
  let prefix = 0;
  let suffix = 0;
  while (
    prefix < oldUnits.length &&
    prefix < newUnits.length &&
    oldUnits[prefix]!.text === newUnits[prefix]!.text
  )
    prefix += 1;
  while (
    suffix < oldUnits.length - prefix &&
    suffix < newUnits.length - prefix &&
    oldUnits[oldUnits.length - suffix - 1]!.text === newUnits[newUnits.length - suffix - 1]!.text
  )
    suffix += 1;
  return [
    ...align(oldUnits.slice(0, prefix), newUnits.slice(0, prefix)),
    ...align(
      oldUnits.slice(prefix, oldUnits.length - suffix),
      newUnits.slice(prefix, newUnits.length - suffix),
    ),
    ...align(oldUnits.slice(oldUnits.length - suffix), newUnits.slice(newUnits.length - suffix)),
  ];
}

function rollSourceIndex(sample: string, index: number, source: string, language: string): number {
  const sampled = parseTextAnimationNumber(sample, language);
  const authored = parseTextAnimationNumber(source, language);
  if (
    !sampled ||
    !authored ||
    sampled.prefix !== authored.prefix ||
    sampled.suffix !== authored.suffix
  )
    return index;
  if (index < sampled.numberStart) return index;
  if (index >= sampled.numberEnd) return authored.numberEnd + index - sampled.numberEnd;
  return Math.max(authored.numberStart, authored.numberEnd + index - sampled.numberEnd);
}

function setRollRow(
  node: HTMLElement,
  text: string,
  sourceIndex: number,
  ranges: StyledRange[],
): void {
  node.replaceChildren();
  appendStyledText(node, text, sourceIndex, ranges);
}

function createRollSlot(value: HTMLElement, index: number): RollSlot {
  const host = value.ownerDocument.createElement('span');
  host.dataset.ografTextSegment = String(index);
  host.dataset.ografTextRollSlot = String(index);
  Object.assign(host.style, {
    display: 'inline-block',
    position: 'relative',
    overflow: 'hidden',
    verticalAlign: 'bottom',
    whiteSpace: 'pre',
  });
  const spacer = value.ownerDocument.createElement('span');
  spacer.dataset.ografTextRollSlotSpacer = 'true';
  spacer.style.visibility = 'hidden';
  const outgoing = value.ownerDocument.createElement('span');
  const incoming = value.ownerDocument.createElement('span');
  outgoing.dataset.ografTextRollOld = 'true';
  incoming.dataset.ografTextRollNew = 'true';
  for (const row of [outgoing, incoming]) {
    row.dataset.ografTextRollPaint = 'true';
    row.dataset.ografTextSegmentInner = 'true';
    Object.assign(row.style, { display: 'block', position: 'absolute', left: '0', top: '0' });
  }
  host.appendChild(spacer);
  host.appendChild(outgoing);
  host.appendChild(incoming);
  value.appendChild(host);
  return { host, spacer, outgoing, incoming, from: '', to: '' };
}

function configureRollShaping(state: MountedTextRoll, flow: HTMLElement): void {
  const previous = state.previous;
  const shaped =
    usesShapedReveal(state.source, state.element) ||
    !!(previous && usesShapedReveal(textSource(previous), previous));
  if (shaped === !!state.shaped) return;

  state.slots = [];
  state.activeSlots = 0;
  delete state.lastPair;
  flow.style.fontVariantNumeric = shaped ? '' : 'tabular-nums';
  if (!shaped) {
    delete state.shaped;
    state.value.replaceChildren();
    return;
  }
  const span = () => flow.ownerDocument.createElement('span');
  const motion = span();
  motion.style.display = 'block';
  const prefix = span();
  const anchor = span();
  const reference = span();
  reference.style.visibility = 'hidden';
  reference.style.fontVariantNumeric = 'tabular-nums';
  const slots = span();
  const suffix = span();
  prefix.dataset.ografTextSegment = 'prefix';
  suffix.dataset.ografTextSegment = 'suffix';
  anchor.append(slots, reference);
  motion.append(prefix, anchor, suffix);

  // At rest the same continuous text can use the browser's native ligatures, bidi resolution,
  // tracking, and proportional digit advances. Detach the motion tree so seeks don't retain poses.
  const settled = span();
  settled.style.display = 'block';
  const segment = span();
  segment.style.display = 'block';
  segment.dataset.ografTextSegment = 'settled';
  segment.dataset.ografTextRollSlot = 'settled';
  segment.dataset.ografTextRollSourceIndex = '0';
  const paint = span();
  paint.style.display = 'block';
  paint.dataset.ografTextRollPaint = 'true';
  appendStyledText(paint, state.source, 0, styledRanges(state.element.runs));
  segment.appendChild(paint);
  settled.appendChild(segment);
  state.value.replaceChildren(motion);
  state.shaped = { motion, prefix, anchor, reference, slots, suffix, settled, complete: false };
}

function shapedRollingPairs(
  shape: ShapedRoll,
  from: string,
  to: string,
  source: string,
  language: string,
  ranges: StyledRange[],
): { pairs: Array<{ from: RollUnit; to: RollUnit }>; block: boolean } {
  const oldNumber = parseTextAnimationNumber(from, language);
  const newNumber = parseTextAnimationNumber(to, language);
  const numbers =
    newNumber &&
    (oldNumber
      ? oldNumber.prefix === newNumber.prefix && oldNumber.suffix === newNumber.suffix
      : !from && !newNumber.prefix && !newNumber.suffix);
  if (!numbers) {
    if (shape.slots.style.display !== 'block') {
      shape.anchor.style.display = 'block';
      shape.anchor.style.position = '';
      shape.reference.style.display = 'none';
      Object.assign(shape.slots.style, {
        display: 'block',
        position: '',
        left: '',
        whiteSpace: '',
        direction: '',
        unicodeBidi: '',
        fontVariantNumeric: '',
      });
      shape.prefix.replaceChildren();
      shape.suffix.replaceChildren();
      delete shape.labels;
    }
    // A prose change rolls as a single shaped run, including when the paragraph wraps.
    return { pairs: [{ from: { text: from, index: 0 }, to: { text: to, index: 0 } }], block: true };
  }

  if (shape.slots.style.display !== 'inline-block') {
    shape.anchor.style.display = 'inline';
    shape.anchor.style.position = 'relative';
    shape.reference.style.display = '';
    Object.assign(shape.slots.style, {
      display: 'inline-block',
      position: 'absolute',
      left: '0',
      whiteSpace: 'pre',
      direction: 'ltr',
      unicodeBidi: 'isolate',
      fontVariantNumeric: 'tabular-nums',
    });
  }
  // The paragraph resolves a leading sign with its surroundings. Keep just the digits and
  // internal separators together so a sign keeps the same bidi position at rest and in motion.
  const digitStart = (text: string, start: number) =>
    start + (/^[+−-]/u.test(text.slice(start)) ? 1 : 0);
  const oldStart = digitStart(from, oldNumber?.numberStart ?? 0);
  const newStart = digitStart(to, newNumber.numberStart);
  const prefix = to.slice(0, newStart);
  const oldDigits = oldNumber ? from.slice(oldStart, oldNumber.numberEnd) : '';
  const newDigits = to.slice(newStart, newNumber.numberEnd);
  // Keep the numeric text itself in the paragraph, so neighboring Latin words, signs and
  // punctuation resolve against its real bidi class instead of a neutral inline-block.
  const reference = [...oldDigits].length > [...newDigits].length ? oldDigits : newDigits;
  shape.reference.replaceChildren();
  appendStyledText(
    shape.reference,
    reference,
    rollSourceIndex(to, newStart, source, language),
    ranges,
  );
  const suffixStart = rollSourceIndex(to, newNumber.numberEnd, source, language);
  const labels = JSON.stringify([prefix, newNumber.suffix, suffixStart]);
  if (shape.labels !== labels) {
    shape.prefix.replaceChildren();
    shape.suffix.replaceChildren();
    appendStyledText(shape.prefix, prefix, 0, ranges);
    appendStyledText(shape.suffix, newNumber.suffix, suffixStart, ranges);
    shape.labels = labels;
  }
  const pairs = alignedRollUnits(oldDigits, newDigits, 'grapheme', language).map((pair) => ({
    from: { ...pair.from, index: pair.from.index + oldStart },
    to: { ...pair.to, index: pair.to.index + newStart },
  }));
  return { pairs, block: false };
}

function mountRollingText(
  flow: HTMLElement,
  source: string,
  element: TextElement,
  previous: TextElement | null,
  ranges: StyledRange[],
): void {
  flow.style.position = 'relative';
  // Numeric font features keep clock digits and counting columns at a stable advance.
  flow.style.fontVariantNumeric = 'tabular-nums';
  const spacer = flow.ownerDocument.createElement('span');
  spacer.dataset.ografTextRollSpacer = 'true';
  spacer.style.display = 'block';
  spacer.style.visibility = 'hidden';
  appendStyledText(spacer, source, 0, ranges);
  flow.appendChild(spacer);
  const value = flow.ownerDocument.createElement('span');
  value.dataset.ografTextRollValue = 'true';
  if (isCountingTextAnimation(element.textAnimation.type)) {
    value.dataset.ografTextCountValue = 'true';
    spacer.dataset.ografTextCountSpacer = 'true';
  }
  Object.assign(value.style, {
    display: 'block',
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
  });
  flow.appendChild(value);
  const state: MountedTextRoll = {
    element,
    source,
    previous,
    previousIdentity: previous
      ? JSON.stringify([textSource(previous), previous.runs, previous.direction])
      : '',
    value,
    slots: [],
    activeSlots: 0,
    lastFrame: 0,
  };
  configureRollShaping(state, flow);
  mountedTextRolls.set(flow, state);
  renderRollingText(flow, element, 0);
}

function renderRollingText(flow: HTMLElement, element: TextElement, frame: number): void {
  const state = mountedTextRolls.get(flow);
  if (!state) return;
  state.element = element;
  state.lastFrame = frame;
  const animation = normalizeTextAnimation(element.textAnimation);
  const counting = isCountingTextAnimation(animation.type);
  const sample = counting
    ? sampleTextCountRoll(state.source, animation, frame, element.language)
    : {
        from: state.previous ? textSource(state.previous) : '',
        to: state.source,
        progress: 1 - (1 - Math.max(0, Math.min(1, frame / animation.durationFrames))) ** 3,
      };
  const shape = state.shaped;
  if (shape) {
    const complete = !sample || frame >= animation.durationFrames;
    if (complete !== shape.complete) {
      state.value.replaceChildren(complete ? shape.settled : shape.motion);
      shape.complete = complete;
      const gradient = flow.parentElement && animatedGradients.get(flow.parentElement);
      if (gradient) {
        delete gradient.signature;
        delete gradient.layoutKey;
      }
    }
    if (complete) {
      if (flow.parentElement) refreshTextAnimationGradient(flow.parentElement, flow);
      return;
    }
  }
  const from = sample?.from ?? state.source;
  const to = sample?.to ?? state.source;
  const progress = sample?.progress ?? 1;
  const pairKey = JSON.stringify([from, to]);
  if (state.lastPair !== pairKey) {
    const newRanges = styledRanges(element.runs);
    const oldElement = counting ? element : (state.previous ?? element);
    const oldRanges = styledRanges(oldElement.runs);
    const oldSource = textSource(oldElement);
    const { pairs, block } = shape
      ? shapedRollingPairs(shape, from, to, state.source, element.language, newRanges)
      : {
          pairs: alignedRollUnits(
            from,
            to,
            counting ? 'grapheme' : animation.split,
            element.language,
          ),
          block: false,
        };
    pairs.forEach((pair, index) => {
      const slot = state.slots[index] ?? createRollSlot(shape?.slots ?? state.value, index);
      state.slots[index] = slot;
      slot.from = pair.from.text;
      slot.to = pair.to.text;
      const newIndex = rollSourceIndex(to, pair.to.index, state.source, element.language);
      const oldIndex = rollSourceIndex(from, pair.from.index, oldSource, element.language);
      if (shape) {
        slot.host.dataset.ografTextRollSourceIndex = String(newIndex);
        slot.host.style.whiteSpace = block ? 'inherit' : 'pre';
        slot.spacer.dir = block ? element.direction : '';
        slot.outgoing.dir = block ? oldElement.direction : '';
        slot.incoming.dir = block ? element.direction : '';
        slot.outgoing.style.width = block ? '100%' : '';
        slot.incoming.style.width = block ? '100%' : '';
      }
      // A missing leading digit still has a cell during a carry (9 -> 10); unchanged punctuation
      // shares the exact same slot and never moves with its numeric neighbours.
      setRollRow(slot.spacer, pair.to.text || pair.from.text || ' ', newIndex, newRanges);
      setRollRow(slot.outgoing, pair.from.text, oldIndex, oldRanges);
      setRollRow(slot.incoming, pair.to.text, newIndex, newRanges);
      const lineBreak = !block && /[\r\n]/.test(pair.to.text);
      slot.host.style.display = block ? 'block' : lineBreak ? 'contents' : 'inline-block';
      slot.spacer.style.display = lineBreak ? 'none' : '';
      slot.outgoing.style.display = lineBreak ? 'none' : 'block';
      slot.incoming.style.display = lineBreak ? 'inline' : 'block';
      slot.incoming.style.position = lineBreak ? 'static' : 'absolute';
    });
    state.slots.slice(pairs.length).forEach((slot) => {
      slot.host.style.display = 'none';
      slot.from = '';
      slot.to = '';
      slot.spacer.replaceChildren();
      slot.spacer.style.display = '';
      for (const row of [slot.outgoing, slot.incoming]) {
        // Retain reusable cells without retaining a pose from a previously sampled number.
        // Mask snapshots include hidden rows too, so their state must be seek-independent.
        row.replaceChildren();
        row.style.display = 'block';
        row.style.position = 'absolute';
        row.style.visibility = 'hidden';
        row.style.transform = '';
      }
    });
    state.activeSlots = pairs.length;
    state.lastPair = pairKey;
    const gradient = flow.parentElement && animatedGradients.get(flow.parentElement);
    if (gradient) delete gradient.signature;
  }
  const direction =
    (counting ? animation.countRoll : animation.type === 'roll-down' ? 'down' : 'up') === 'down'
      ? -1
      : 1;
  const block = shape?.slots.style.display === 'block';
  for (const slot of state.slots.slice(0, state.activeSlots)) {
    const lineBreak = !block && /[\r\n]/.test(slot.to);
    slot.host.style.display = block
      ? 'block'
      : !slot.to && progress >= 1
        ? 'none'
        : lineBreak
          ? 'contents'
          : 'inline-block';
    const unchanged = slot.from === slot.to || lineBreak;
    slot.outgoing.style.visibility = unchanged || progress >= 1 || !slot.from ? 'hidden' : SHOWN;
    slot.incoming.style.visibility = !slot.to ? 'hidden' : SHOWN;
    slot.outgoing.style.transform =
      unchanged || progress >= 1 ? '' : `translateY(${-direction * progress * 100}%)`;
    slot.incoming.style.transform =
      unchanged || progress >= 1 ? '' : `translateY(${direction * (1 - progress) * 100}%)`;
  }
  if (flow.parentElement) refreshTextAnimationGradient(flow.parentElement, flow);
}

/** Supply the logical predecessor, independent of whichever frame happened to render last. */
export function setTextAnimationPrevious(
  container: HTMLElement,
  previous?: TextElement | null,
): void {
  const crawl = container.querySelector<HTMLElement>('[data-ograf-text-crawl-track="true"]');
  if (crawl) {
    const state = mountedCrawlAnimations.get(crawl) ?? { frame: 0, previous: null };
    state.previous = previous ?? null;
    mountedCrawlAnimations.set(crawl, state);
    for (const copy of crawl.children) setTextAnimationPrevious(copy as HTMLElement, previous);
    return;
  }
  const flow = container.querySelector<HTMLElement>('[data-ograf-text-flow="true"]');
  const state = flow && mountedTextRolls.get(flow);
  if (!flow || !state || isCountingTextAnimation(state.element.textAnimation.type)) return;
  const identity = previous
    ? JSON.stringify([textSource(previous), previous.runs, previous.direction])
    : '';
  if (identity === state.previousIdentity) return;
  state.previous = previous ?? null;
  state.previousIdentity = identity;
  configureRollShaping(state, flow);
  delete state.lastPair;
  renderRollingText(flow, state.element, state.lastFrame);
}

/** Build one stable inline-flow subtree; revealing segments never changes its measured layout. */
export function mountTextAnimationContent(
  content: HTMLElement,
  element: TextElement,
  previousElement?: TextElement | null,
): void {
  const animation = normalizeTextAnimation(element.textAnimation);
  const source = textSource(element);
  const flow = content.ownerDocument.createElement('span');
  flow.dataset.ografTextFlow = 'true';
  flow.style.display = 'block';
  flow.style.width = '100%';
  flow.setAttribute('aria-hidden', 'true');
  content.setAttribute('aria-label', source);

  const ranges = styledRanges(element.runs);
  if (
    isRollingTextAnimation(animation.type) ||
    (isCountingTextAnimation(animation.type) && animation.countRoll !== 'none')
  ) {
    mountRollingText(flow, source, element, previousElement ?? null, ranges);
    content.appendChild(flow);
    mountTextPropertyAnimators(content, element);
    return;
  }
  if (isCountingTextAnimation(animation.type)) {
    mountCountingText(flow, source, element, ranges);
    content.appendChild(flow);
    mountTextPropertyAnimators(content, element);
    return;
  }
  const shapedReveal = usesShapedReveal(source, element);
  if (animation.type === 'typewriter' && shapedReveal) {
    mountShapedTypewriter(flow, source, ranges, element, animation);
    content.appendChild(flow);
    mountTextPropertyAnimators(content, element);
    return;
  }
  const inlineWords = animation.type === 'word-reveal' && shapedReveal;
  const split = textAnimationSplit(animation);
  const shapedWordMotion =
    shapedReveal && split === 'word' && !inlineWords && animation.type !== 'none';
  const shapedWords = inlineWords || shapedWordMotion;
  if (shapedWords) flow.dataset.ografTextShapingGroup = 'true';
  let animationIndex = 0;
  const shapedMotion = usesShapedTextMotion(source, animation);
  const records = shapedMotion
    ? [{ text: source, index: 0 }]
    : segmentTextAnimationUnits(source, split, element.language);
  for (const record of records) {
    if (!isAnimatedTextSegment(record, split)) {
      flow.append(record.text);
      continue;
    }
    const segment = content.ownerDocument.createElement('span');
    segment.dataset.ografTextSegment = String(animationIndex);
    segment.style.display = inlineWords ? 'inline' : shapedMotion ? 'block' : 'inline-block';
    if (shapedMotion) segment.dataset.ografTextShapingGroup = 'true';
    segment.style.visibility = animation.type === 'typewriter' ? 'hidden' : SHOWN;
    segment.style.opacity =
      animation.type === 'typewriter' || animation.type === 'none' ? '1' : '0';
    if (animation.type === 'word-reveal') {
      const inner = content.ownerDocument.createElement('span');
      inner.dataset.ografTextSegmentInner = 'true';
      if (inlineWords) {
        inner.style.display = 'inline';
        inner.style.position = 'relative';
        inner.dataset.ografInlineWordReveal = 'true';
      } else {
        segment.style.overflow = 'hidden';
        segment.style.verticalAlign = 'bottom';
        inner.style.display = 'inline-block';
      }
      appendStyledText(inner, record.text, record.index, ranges);
      segment.appendChild(inner);
    } else appendStyledText(segment, record.text, record.index, ranges);
    if (shapedWordMotion) {
      // Keep the real text in the paragraph so the browser resolves its order and wrapping.
      // The absolute copy has an independent transform and uses the line's static block position.
      const anchor = content.ownerDocument.createElement('span');
      anchor.style.position = 'relative';
      const reference = content.ownerDocument.createElement('span');
      reference.style.visibility = 'hidden';
      appendStyledText(reference, record.text, record.index, ranges);
      Object.assign(segment.style, {
        position: 'absolute',
        left: '0',
        whiteSpace: 'pre',
      });
      anchor.appendChild(segment);
      anchor.appendChild(reference);
      flow.appendChild(anchor);
    } else flow.appendChild(segment);
    animationIndex += 1;
  }

  if (animation.type === 'typewriter' && animation.cursor !== 'none') {
    const cursor = createTypewriterCursor(flow, element.color, animation.cursor);
    Object.assign(cursor.style, {
      marginLeft: '0.08em',
      verticalAlign: '-0.08em',
    });
    flow.insertBefore(cursor, flow.firstChild);
  }
  content.appendChild(flow);
  mountTextPropertyAnimators(content, element);
  if (shapedWords) {
    const parent = flow.querySelector<HTMLElement>('[data-ograf-text-animator-glyph]') ?? flow;
    const settled = flow.ownerDocument.createElement('span');
    settled.dataset.ografTextSegment = '0';
    settled.style.display = 'block';
    appendStyledText(settled, source, 0, ranges);
    shapedWordAnimations.set(flow, {
      parent,
      words: [...parent.childNodes],
      settled,
      complete: false,
    });
  }
}

export function textAnimationSegmentCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-ograf-text-segment]').length;
}

/** Apply a deterministic text entrance snapshot at an OGraf-local frame. */
export function renderTextAnimationAtFrame(
  container: HTMLElement,
  element: TextElement,
  frame: number,
): void {
  renderPresetTextAnimationAtFrame(container, element, frame);
  const content = container.matches?.('[data-ograf-modifier-text="true"]')
    ? container
    : container.querySelector<HTMLElement>('[data-ograf-modifier-text="true"]');
  if (content) renderTextPropertyAnimators(content, element, frame);
}

function renderPresetTextAnimationAtFrame(
  container: HTMLElement,
  element: TextElement,
  frame: number,
): void {
  const animation = normalizeTextAnimation(element.textAnimation);
  if (animation.type === 'none') return;
  const crawl = container.querySelector<HTMLElement>('[data-ograf-text-crawl-track="true"]');
  if (crawl) {
    const state = mountedCrawlAnimations.get(crawl) ?? { frame: 0, previous: null };
    state.frame = frame;
    mountedCrawlAnimations.set(crawl, state);
    for (const copy of crawl.children)
      renderTextAnimationAtFrame(copy as HTMLElement, element, frame);
    return;
  }
  const flow = container.querySelector<HTMLElement>('[data-ograf-text-flow="true"]');
  if (!flow) return;
  const shapedTypewriter = shapedTypewriters.get(flow);
  if (shapedTypewriter) {
    renderShapedTypewriter(shapedTypewriter, animation, frame);
    if (flow.parentElement) refreshTextAnimationGradient(flow.parentElement, flow);
    return;
  }
  const shapedWords = shapedWordAnimations.get(flow);
  if (shapedWords) {
    const complete = frame >= animation.durationFrames;
    if (complete !== shapedWords.complete) {
      // Even ordinary inline boundaries can nudge native font positions by a fraction of a pixel.
      // At rest, use the same continuous text as the unanimated layer.
      if (complete) shapedWords.parent.replaceChildren(shapedWords.settled);
      else shapedWords.parent.replaceChildren(...shapedWords.words);
      shapedWords.complete = complete;
      const gradient = flow.parentElement && animatedGradients.get(flow.parentElement);
      if (gradient) {
        delete gradient.signature;
        delete gradient.layoutKey;
      }
    }
    if (complete) {
      if (flow.parentElement) refreshTextAnimationGradient(flow.parentElement, flow);
      return;
    }
  }
  if (flow.parentElement) refreshTextAnimationGradient(flow.parentElement, flow);
  if (mountedTextRolls.has(flow)) {
    renderRollingText(flow, element, frame);
    return;
  }
  if (isCountingTextAnimation(animation.type)) {
    renderCountingText(flow, element, frame);
    return;
  }
  const segments = [...flow.querySelectorAll<HTMLElement>('[data-ograf-text-segment]')];
  if (animation.type !== 'typewriter') {
    segments.forEach((segment, index) => {
      const progress = textAnimationSegmentProgress(
        index,
        segments.length,
        frame,
        animation.durationFrames,
      );
      const visual = textAnimationSegmentVisual(animation.type, progress);
      segment.style.opacity = String(visual.opacity);
      // Every sample clears transient state, including when seeking backwards after completion.
      segment.style.visibility = SHOWN;
      segment.style.transform = '';
      segment.style.filter = '';
      segment.style.transformOrigin = '';
      segment.style.backfaceVisibility = '';
      if (animation.type === 'word-reveal') {
        const inner = segment.querySelector<HTMLElement>('[data-ograf-text-segment-inner]');
        if (inner?.dataset.ografInlineWordReveal === 'true') {
          inner.style.top = progress < 1 ? `${visual.translateYEm}em` : '';
          inner.style.clipPath =
            progress > 0 && progress < 1 ? `inset(-1em -1em ${visual.translateYEm}em)` : '';
        } else if (inner) {
          inner.style.transform = progress < 1 ? `translateY(${visual.translateYEm}em)` : '';
        }
      } else if (progress >= 1) {
        return;
      } else if (animation.type === 'rise') {
        segment.style.transform = `translateY(${visual.translateYEm}em)`;
      } else if (animation.type === 'pop') {
        segment.style.transform = `scale(${visual.scale})`;
      } else if (animation.type === 'flip') {
        segment.style.transformOrigin = '50% 50%';
        segment.style.backfaceVisibility = 'hidden';
        // Orthographic rotation also maps exactly onto shader/media text's Canvas alpha mask.
        segment.style.transform = `rotateX(${visual.rotateXDeg ?? 0}deg)`;
      } else if (animation.type === 'blur') {
        segment.style.filter = `blur(${visual.blurPx ?? 0}px)`;
      } else if (animation.type === 'rotate') {
        segment.style.transformOrigin = '50% 50%';
        segment.style.transform = `rotate(${visual.rotateDeg ?? 0}deg)`;
      } else if (animation.type === 'stretch') {
        segment.style.transformOrigin = '50% 50%';
        segment.style.transform = `scaleX(${visual.scaleX ?? 1})`;
      }
    });
    return;
  }
  const visibleCount = visibleTextAnimationSegmentCount(
    segments.length,
    frame,
    animation.durationFrames,
  );
  for (let index = 0; index < segments.length; index += 1) {
    segments[index]!.style.visibility = index < visibleCount ? SHOWN : 'hidden';
  }

  const cursor = flow.querySelector<HTMLElement>('[data-ograf-text-cursor]');
  if (!cursor) return;
  const nextSegment = segments[visibleCount] ?? null;
  flow.insertBefore(cursor, nextSegment);
  const complete = visibleCount >= segments.length;
  const blinkOn = Math.floor(Math.max(0, frame) / animation.cursorBlinkFrames) % 2 === 0;
  cursor.style.display = complete ? 'none' : 'inline-block';
  cursor.style.opacity = blinkOn ? '1' : '0';
}
