import { isGradientPaint } from './paint';
import { readColor } from './stylePackColorLinks';
import { normalizeTextPropertyAnimator, textPropertyAnimatorErrors } from './textAnimators';
import type { TextAnimation, TextElement } from './types';

export interface TextAnimationSegment {
  text: string;
  index: number;
}

type IntlSegmenter = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' | 'word' },
) => {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

export const DEFAULT_TEXT_ANIMATION: TextAnimation = {
  type: 'none',
  split: 'grapheme',
  durationFrames: 12,
  cursor: 'bar',
  cursorBlinkFrames: 12,
  replayOnUpdate: false,
  customActionId: null,
  countFrom: null,
  countRoll: 'none',
};

export const TEXT_ANIMATION_TYPES = [
  'none',
  'typewriter',
  'fade',
  'rise',
  'pop',
  'word-reveal',
  'flip',
  'blur',
  'rotate',
  'stretch',
  'roll-up',
  'roll-down',
  'count-up',
  'count-down',
] as const satisfies readonly TextAnimation['type'][];

export const TEXT_ANIMATION_LABELS: Record<TextAnimation['type'], string> = {
  none: 'None',
  typewriter: 'Typewriter',
  fade: 'Fade in',
  rise: 'Rise in',
  pop: 'Pop in',
  'word-reveal': 'Word reveal',
  flip: 'Flip',
  blur: 'Blur in',
  rotate: 'Rotate in',
  stretch: 'Stretch in',
  'roll-up': 'Roll up',
  'roll-down': 'Roll down',
  'count-up': 'Count up',
  'count-down': 'Count down',
};

export function textAnimationSplit(animation: TextAnimation): TextAnimation['split'] {
  return animation.type === 'word-reveal' ? 'word' : animation.split;
}

export function normalizeTextAnimation(
  animation: Partial<TextAnimation> | null | undefined,
): TextAnimation {
  const durationFrames = Number(animation?.durationFrames);
  const cursorBlinkFrames = Number(animation?.cursorBlinkFrames);
  return {
    type:
      animation?.type && Object.hasOwn(TEXT_ANIMATION_LABELS, animation.type)
        ? animation.type
        : 'none',
    split: animation?.split === 'word' ? 'word' : 'grapheme',
    durationFrames:
      Number.isFinite(durationFrames) && durationFrames >= 1
        ? Math.max(1, Math.round(durationFrames))
        : DEFAULT_TEXT_ANIMATION.durationFrames,
    cursor:
      animation?.cursor === 'none' || animation?.cursor === 'block' ? animation.cursor : 'bar',
    cursorBlinkFrames:
      Number.isFinite(cursorBlinkFrames) && cursorBlinkFrames >= 1
        ? Math.max(1, Math.round(cursorBlinkFrames))
        : DEFAULT_TEXT_ANIMATION.cursorBlinkFrames,
    replayOnUpdate: animation?.replayOnUpdate === true,
    customActionId:
      typeof animation?.customActionId === 'string' && animation.customActionId.trim()
        ? animation.customActionId.trim()
        : null,
    ...(Array.isArray(animation?.animators) && animation.animators.length
      ? {
          animators: animation.animators
            .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
            .map(normalizeTextPropertyAnimator),
        }
      : {}),
    countFrom:
      typeof animation?.countFrom === 'number' && Number.isFinite(animation.countFrom)
        ? animation.countFrom
        : null,
    countRoll:
      animation?.countRoll === 'up' || animation?.countRoll === 'down'
        ? animation.countRoll
        : 'none',
  };
}

export function hasTextAnimationSettings(
  value: Partial<TextAnimation> | null | undefined,
): boolean {
  const animation = normalizeTextAnimation(value);
  return animation.type !== 'none' || !!animation.animators?.some((animator) => animator.enabled);
}
export function hasTextAnimation(element: TextElement): boolean {
  return hasTextAnimationSettings(element.textAnimation);
}
export function textAnimationTotalFrames(value: Partial<TextAnimation> | null | undefined): number {
  const animation = normalizeTextAnimation(value);
  return Math.max(
    animation.type !== 'none' ? animation.durationFrames : 0,
    ...(animation.animators ?? [])
      .filter((a) => a.enabled)
      .map((a) => Math.max(a.durationFrames, ...a.offsetKeyframes.map((k) => k.frame))),
    0,
  );
}

/** A color animator can tint solid text or parseable gradients while retaining stop alpha. */
export function supportsTextAnimatorColor(element: TextElement): boolean {
  const fill = element.fill ?? element.color;
  return (
    typeof fill === 'string' ||
    (isGradientPaint(fill) &&
      Array.isArray(fill.stops) &&
      fill.stops.every((stop) => !!readColor(stop.color)))
  );
}
/** Avoid silently exporting a color animation that cannot tint its authored paint. */
export function textAnimatorPaintErrors(element: TextElement): string[] {
  if (
    !supportsTextAnimatorColor(element) &&
    Array.isArray(element.textAnimation?.animators) &&
    element.textAnimation.animators.some(
      (a) => a && typeof a === 'object' && a.enabled !== false && a.properties?.color,
    )
  )
    return [
      'Text animator color requires a solid fill or a gradient with parseable colors; shader and media fills cannot be tinted yet. Other animator properties remain available.',
    ];
  return [];
}

/** Validate authored values without rejecting absent options in older templates. */
export function textAnimationErrors(animation: unknown): string[] {
  if (animation === undefined || animation === null) return [];
  if (typeof animation !== 'object' || Array.isArray(animation))
    return ['Text animation must be an object.'];
  const value = animation as Record<string, unknown>;
  const errors: string[] = [];
  if (
    value.type !== undefined &&
    (typeof value.type !== 'string' || !Object.hasOwn(TEXT_ANIMATION_LABELS, value.type))
  )
    errors.push('Text animation type is unsupported.');
  if (value.split !== undefined && value.split !== 'grapheme' && value.split !== 'word')
    errors.push('Text animation split must be grapheme or word.');
  for (const field of ['durationFrames', 'cursorBlinkFrames'] as const) {
    if (
      value[field] !== undefined &&
      (typeof value[field] !== 'number' || !Number.isInteger(value[field]) || value[field] < 1)
    )
      errors.push(`Text animation ${field} must be a positive frame count.`);
  }
  if (
    value.cursor !== undefined &&
    value.cursor !== 'none' &&
    value.cursor !== 'bar' &&
    value.cursor !== 'block'
  )
    errors.push('Text animation cursor must be none, bar or block.');
  if (value.replayOnUpdate !== undefined && typeof value.replayOnUpdate !== 'boolean')
    errors.push('Text animation replayOnUpdate must be a boolean.');
  if (
    value.customActionId !== undefined &&
    value.customActionId !== null &&
    typeof value.customActionId !== 'string'
  )
    errors.push('Text animation customActionId must be a string or null.');
  if (
    value.countFrom !== undefined &&
    value.countFrom !== null &&
    (typeof value.countFrom !== 'number' || !Number.isFinite(value.countFrom))
  )
    errors.push('Text animation countFrom must be a finite number or null.');
  if (
    value.countRoll !== undefined &&
    value.countRoll !== 'none' &&
    value.countRoll !== 'up' &&
    value.countRoll !== 'down'
  )
    errors.push('Text animation countRoll must be none, up or down.');
  errors.push(...textPropertyAnimatorErrors(value.animators));
  return errors;
}

export function isRollingTextAnimation(type: TextAnimation['type']): boolean {
  return type === 'roll-up' || type === 'roll-down';
}

export function isCountingTextAnimation(type: TextAnimation['type']): boolean {
  return type === 'count-up' || type === 'count-down';
}

/** Count and roll replays carry the old value to the new one, so they are the update effect. */
export function textAnimationCarriesUpdate(
  value: Partial<TextAnimation> | null | undefined,
): boolean {
  const animation = normalizeTextAnimation(value);
  return (
    animation.replayOnUpdate &&
    (isRollingTextAnimation(animation.type) || isCountingTextAnimation(animation.type))
  );
}

export interface TextAnimationNumber {
  value: number;
  prefix: string;
  suffix: string;
  /** UTF-16 source offsets, including a directly attached sign. */
  numberStart: number;
  numberEnd: number;
}

interface ParsedTextAnimationNumber extends TextAnimationNumber {
  decimal: string;
  precision: number;
  group: string;
  secondaryGroupSize: number;
  minimumIntegerDigits: number;
  omitLeadingZero: boolean;
  explicitPlus: boolean;
  minus: string;
  formatter: Intl.NumberFormat;
}

const textAnimationNumberCache = new Map<string, ParsedTextAnimationNumber | null>();

function textNumberLocale(language: string): { decimal: string; secondaryGroupSize: number } {
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(language.trim() || 'en-US');
  } catch {
    formatter = new Intl.NumberFormat('en-US');
  }
  const parts = formatter.formatToParts(1234567.8);
  const integers = parts.filter((part) => part.type === 'integer');
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    secondaryGroupSize: integers.length > 2 ? integers[integers.length - 2]!.value.length : 3,
  };
}

function validTextNumberGroups(value: string, separator: string, secondarySize: number): boolean {
  const groups = value.split(separator);
  if (groups.length < 2 || groups.some((group) => !/^\d+$/u.test(group))) return false;
  if (groups[groups.length - 1]!.length !== 3) return false;
  const standard =
    groups[0]!.length <= 3 && groups.slice(1, -1).every((group) => group.length === 3);
  const localized =
    secondarySize === 2 &&
    groups[0]!.length <= 2 &&
    groups.slice(1, -1).every((group) => group.length === 2);
  return standard || localized;
}

function parseTextAnimationNumberUncached(
  source: string,
  language: string,
): ParsedTextAnimationNumber | null {
  const firstDigit = source.search(/\d/u);
  if (firstDigit < 0) return null;
  let numberStart = firstDigit;
  // A leading decimal is part of the number rather than its surrounding label.
  if (numberStart > 0 && /[.,]/u.test(source[numberStart - 1]!)) numberStart -= 1;
  if (numberStart > 0 && /[+\-−]/u.test(source[numberStart - 1]!)) numberStart -= 1;
  let numberEnd = source.length;
  while (numberEnd > firstDigit && !/\d/u.test(source[numberEnd - 1]!)) numberEnd -= 1;
  const prefix = source.slice(0, numberStart);
  const suffix = source.slice(numberEnd);
  // Reject malformed signs/separators instead of animating a valid-looking substring.
  if (/[+\-−.,'’]$/u.test(prefix) || /^[+\-−.,'’]/u.test(suffix)) return null;
  const token = source.slice(numberStart, numberEnd);
  const sign = /^[+\-−]/u.test(token) ? token[0]! : '';
  const body = sign ? token.slice(1) : token;
  // This also excludes clocks, fractions, scientific notation, and separate numbers.
  if (!/^[\d.,'’ \u00a0\u202f]+$/u.test(body)) return null;
  const locale = textNumberLocale(language);
  const dots = [...body.matchAll(/\./gu)].length;
  const commas = [...body.matchAll(/,/gu)].length;
  let decimal = '';
  if (dots && commas) {
    decimal = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    if ((decimal === '.' ? dots : commas) !== 1) return null;
  } else if (dots + commas === 1) {
    const candidate = dots ? '.' : ',';
    if (
      candidate === locale.decimal ||
      !validTextNumberGroups(body, candidate, locale.secondaryGroupSize)
    )
      decimal = candidate;
  }
  const decimalIndex = decimal ? body.lastIndexOf(decimal) : -1;
  const integerPart = decimalIndex >= 0 ? body.slice(0, decimalIndex) : body;
  const fraction = decimalIndex >= 0 ? body.slice(decimalIndex + 1) : '';
  if (decimal && !/^\d+$/u.test(fraction)) return null;
  // NumberFormat can preserve fixed precision up to 20 decimal places consistently.
  if (fraction.length > 20) return null;
  const separators = [...new Set(integerPart.match(/[^\d]/gu) ?? [])];
  if (separators.length > 1) return null;
  const group = separators[0] ?? '';
  if (group && !validTextNumberGroups(integerPart, group, locale.secondaryGroupSize)) return null;
  const integerDigits = group ? integerPart.split(group).join('') : integerPart;
  if (integerDigits && !/^\d+$/u.test(integerDigits)) return null;
  if (!integerDigits && !decimal) return null;
  const magnitude = Number(`${integerDigits || '0'}${decimal ? `.${fraction}` : ''}`);
  if (!Number.isFinite(magnitude)) return null;
  const value = sign === '-' || sign === '−' ? -magnitude : magnitude;
  const integerGroups = group ? integerPart.split(group) : [];
  return {
    value,
    prefix,
    suffix,
    numberStart,
    numberEnd,
    decimal,
    precision: fraction.length,
    group,
    secondaryGroupSize:
      integerGroups.length > 2 ? integerGroups[integerGroups.length - 2]!.length : 3,
    minimumIntegerDigits: /^0\d/u.test(integerDigits) ? integerDigits.length : 1,
    omitLeadingZero: !integerDigits,
    explicitPlus: sign === '+',
    minus: sign === '−' ? '−' : '-',
    formatter: new Intl.NumberFormat('en-US', {
      useGrouping: false,
      minimumFractionDigits: fraction.length,
      maximumFractionDigits: fraction.length,
    }),
  };
}

function parsedTextAnimationNumber(
  source: string,
  language = '',
): ParsedTextAnimationNumber | null {
  const key = `${language}\u0000${source}`;
  if (textAnimationNumberCache.has(key)) return textAnimationNumberCache.get(key)!;
  const parsed = parseTextAnimationNumberUncached(source, language);
  if (textAnimationNumberCache.size >= 128)
    textAnimationNumberCache.delete(textAnimationNumberCache.keys().next().value!);
  textAnimationNumberCache.set(key, parsed);
  return parsed;
}

/** Parse one formatted numeric token; leave unsupported labels unchanged. */
export function parseTextAnimationNumber(
  source: string,
  language = '',
): TextAnimationNumber | null {
  const parsed = parsedTextAnimationNumber(source, language);
  if (!parsed) return null;
  const { value, prefix, suffix, numberStart, numberEnd } = parsed;
  return { value, prefix, suffix, numberStart, numberEnd };
}

function formatTextAnimationNumber(value: number, parsed: ParsedTextAnimationNumber): string {
  const fixed = parsed.formatter.format(Math.abs(value));
  const [integer = '0', fraction = ''] = fixed.split('.');
  let integerDigits = integer.padStart(parsed.minimumIntegerDigits, '0');
  if (parsed.omitLeadingZero && integerDigits === '0') integerDigits = '';
  if (parsed.group && integerDigits.length > 3) {
    const groups = [integerDigits.slice(-3)];
    let remaining = integerDigits.slice(0, -3);
    while (remaining.length > parsed.secondaryGroupSize) {
      groups.unshift(remaining.slice(-parsed.secondaryGroupSize));
      remaining = remaining.slice(0, -parsed.secondaryGroupSize);
    }
    if (remaining) groups.unshift(remaining);
    integerDigits = groups.join(parsed.group);
  }
  const roundedZero = !/[1-9]/u.test(fixed);
  const sign = value < 0 && !roundedZero ? parsed.minus : parsed.explicitPlus ? '+' : '';
  return `${parsed.prefix}${sign}${integerDigits}${parsed.decimal ? `${parsed.decimal}${fraction}` : ''}${parsed.suffix}`;
}

function textCountValue(
  parsed: ParsedTextAnimationNumber,
  animation: TextAnimation,
  frame: number,
): { value: number; progress: number } {
  const duration = Number.isFinite(animation.durationFrames)
    ? Math.max(1, animation.durationFrames)
    : DEFAULT_TEXT_ANIMATION.durationFrames;
  const progress = Number.isNaN(frame) ? 0 : Math.max(0, Math.min(1, frame / duration));
  if (progress >= 1) return { value: parsed.value, progress };
  const distance = Math.max(Math.abs(parsed.value), 1);
  const authoredStart =
    typeof animation.countFrom === 'number' && Number.isFinite(animation.countFrom)
      ? animation.countFrom
      : null;
  const automaticStart =
    animation.type === 'count-up'
      ? Math.max(-Number.MAX_VALUE, Math.min(0, parsed.value - distance))
      : Math.min(Number.MAX_VALUE, Math.max(0, parsed.value + distance));
  const from =
    animation.type === 'count-up'
      ? Math.min(authoredStart ?? automaticStart, parsed.value)
      : Math.max(authoredStart ?? automaticStart, parsed.value);
  const eased = 1 - (1 - progress) ** 3;
  // Weighted interpolation avoids overflowing when finite endpoints have opposite signs.
  const value = from * (1 - eased) + parsed.value * eased;
  return { value, progress };
}

/** Whole-number entrance sampled from frames; both directions finish at the authored value. */
export function sampleTextCountAnimation(
  source: string,
  animation: TextAnimation,
  frame: number,
  language = '',
): string | null {
  if (!isCountingTextAnimation(animation.type)) return null;
  const parsed = parsedTextAnimationNumber(source, language);
  if (!parsed) return null;
  const { value, progress } = textCountValue(parsed, animation, frame);
  if (progress >= 1) return source;
  return formatTextAnimationNumber(value, parsed);
}

export interface TextCountRollSample {
  from: string;
  to: string;
  progress: number;
}

/** Adjacent authored decimal units, sampled without relying on previous playback frames. */
export function sampleTextCountRoll(
  source: string,
  animation: TextAnimation,
  frame: number,
  language = '',
): TextCountRollSample | null {
  if (!isCountingTextAnimation(animation.type)) return null;
  const parsed = parsedTextAnimationNumber(source, language);
  if (!parsed) return null;
  const { value, progress } = textCountValue(parsed, animation, frame);
  if (progress >= 1) return { from: source, to: source, progress: 1 };
  const scale = 10 ** parsed.precision;
  let units = value * scale;
  // Adjacent authored units cannot be represented beyond safe integer precision.
  // Keep the finite formatted value rather than introducing Infinity or fake digit motion.
  if (!Number.isFinite(units) || Math.abs(units) >= Number.MAX_SAFE_INTEGER) {
    const formatted = formatTextAnimationNumber(value, parsed);
    return { from: formatted, to: formatted, progress: 0 };
  }
  const nearest = Math.round(units);
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(units)) * 4);
  if (Math.abs(units - nearest) <= tolerance) units = nearest;
  const increasing = animation.type === 'count-up';
  const fromUnits = increasing ? Math.floor(units) : Math.ceil(units);
  const toUnits = fromUnits + (increasing ? 1 : -1);
  const clampTarget = (candidate: number) =>
    increasing ? Math.min(candidate, parsed.value) : Math.max(candidate, parsed.value);
  return {
    from: formatTextAnimationNumber(clampTarget(fromUnits / scale), parsed),
    to: formatTextAnimationNumber(clampTarget(toUnits / scale), parsed),
    progress: Math.max(0, Math.min(1, increasing ? units - fromUnits : fromUnits - units)),
  };
}

/** Segment-local progress for an entrance that staggers across the full authored duration. */
export function textAnimationSegmentProgress(
  index: number,
  total: number,
  frame: number,
  durationFrames: number,
): number {
  const duration = Math.max(1, durationFrames);
  const entrance = total <= 1 ? duration : Math.max(1, duration * 0.4);
  const lastStart = Math.max(0, duration - entrance);
  const start = total <= 1 ? 0 : (Math.max(0, index) / (total - 1)) * lastStart;
  return Math.max(0, Math.min(1, (frame - start) / entrance));
}

export interface TextAnimationSegmentVisual {
  opacity: number;
  translateYEm: number;
  scale: number;
  rotateXDeg?: number;
  rotateDeg?: number;
  blurPx?: number;
  scaleX?: number;
}

/** Pure visual sample shared by editing, realtime playout, and scheduled seeks. */
export function textAnimationSegmentVisual(
  type: TextAnimation['type'],
  progress: number,
): TextAnimationSegmentVisual {
  const t = Math.max(0, Math.min(1, progress));
  const eased = 1 - (1 - t) ** 3;
  if (type === 'rise') return { opacity: eased, translateYEm: (1 - eased) * 0.75, scale: 1 };
  if (type === 'word-reveal') return { opacity: eased, translateYEm: (1 - eased) * 1.1, scale: 1 };
  if (type === 'pop') {
    const shifted = t - 1;
    const overshoot = 1 + 2.70158 * shifted ** 3 + 1.70158 * shifted ** 2;
    return { opacity: eased, translateYEm: 0, scale: 0.7 + 0.3 * overshoot };
  }
  if (type === 'flip')
    return { opacity: eased, translateYEm: 0, scale: 1, rotateXDeg: (1 - eased) * 90 };
  if (type === 'blur')
    return { opacity: eased, translateYEm: 0, scale: 1, blurPx: (1 - eased) * 8 };
  if (type === 'rotate')
    return { opacity: eased, translateYEm: 0, scale: 1, rotateDeg: (eased - 1) * 90 };
  if (type === 'stretch')
    return { opacity: eased, translateYEm: 0, scale: 1, scaleX: 0.15 + 0.85 * eased };
  return { opacity: eased, translateYEm: 0, scale: 1 };
}

export function segmentTextAnimationUnits(
  text: string,
  split: TextAnimation['split'],
  language = '',
): TextAnimationSegment[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: IntlSegmenter }).Segmenter;
  let records: TextAnimationSegment[];
  if (Segmenter) {
    const segmenter = new Segmenter(language.trim() || undefined, { granularity: split });
    records = [...segmenter.segment(text)].map((entry) => ({
      text: entry.segment,
      index: entry.index,
    }));
  } else if (split === 'word') {
    records = [];
    for (const match of text.matchAll(/\s+|[^\s]+/gu)) {
      records.push({ text: match[0], index: match.index ?? 0 });
    }
  } else {
    records = [];
    let index = 0;
    for (const segment of Array.from(text)) {
      records.push({ text: segment, index });
      index += segment.length;
    }
  }

  const result: TextAnimationSegment[] = [];
  for (const record of records) {
    let index = record.index;
    for (const part of record.text.split(/(\r\n|\r|\n)/)) {
      if (!part) continue;
      result.push({ text: part, index });
      index += part.length;
    }
  }
  return result;
}

export function isAnimatedTextSegment(
  segment: TextAnimationSegment,
  split: TextAnimation['split'],
): boolean {
  if (/^(?:\r\n|\r|\n)$/.test(segment.text)) return false;
  return split !== 'word' || !/^\s+$/u.test(segment.text);
}

export function visibleTextAnimationSegmentCount(
  total: number,
  frame: number,
  durationFrames: number,
): number {
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, durationFrames)));
  return Math.min(total, Math.floor(progress * total + 1e-9));
}

const shapedTextMotionPresets: ReadonlySet<TextAnimation['type']> = new Set([
  'fade',
  'rise',
  'pop',
  'flip',
  'blur',
  'rotate',
  'stretch',
]);

/** Keep Arabic letters, marks and surrounding bidi text in one browser-shaped run. */
export function usesShapedTextMotion(source: string, animation: TextAnimation): boolean {
  return (
    animation.split === 'grapheme' &&
    shapedTextMotionPresets.has(animation.type) &&
    /(?=\p{Letter})\p{Script=Arabic}/u.test(source)
  );
}

export function textAnimationVisibleText(element: TextElement, frame: number): string {
  const animation = normalizeTextAnimation(element.textAnimation);
  if (animation.type === 'none') return element.content;
  const source = element.runs.length
    ? element.runs.map((run) => run.text).join('')
    : element.content;
  if (isCountingTextAnimation(animation.type))
    return sampleTextCountAnimation(source, animation, frame, element.language) ?? source;
  if (usesShapedTextMotion(source, animation))
    return textAnimationSegmentProgress(0, 1, frame, animation.durationFrames) >= 0.5 ? source : '';
  const split = textAnimationSplit(animation);
  const units = segmentTextAnimationUnits(source, split, element.language);
  const total = units.filter((unit) => isAnimatedTextSegment(unit, split)).length;
  const visible =
    animation.type === 'typewriter'
      ? visibleTextAnimationSegmentCount(total, frame, animation.durationFrames)
      : Array.from({ length: total }, (_, index) =>
          textAnimationSegmentProgress(index, total, frame, animation.durationFrames),
        ).filter((progress) => progress >= 0.5).length;
  let consumed = 0;
  let result = '';
  for (const unit of units) {
    if (isAnimatedTextSegment(unit, split)) {
      if (consumed >= visible) break;
      consumed += 1;
    }
    result += unit.text;
  }
  return result;
}
