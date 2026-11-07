import { parseEditablePath } from './pathEditing';
import { isGradientPaint } from './paint';
import { segmentTextAnimationUnits } from './textAnimation';
import type { Layer, LayerTextPath, TextElement } from './types';

export type TextPathReference = LayerTextPath;

/** Combinations not yet verified end to end are rejected before authoring/export. */
export function textPathCompatibilityErrors(element: TextElement): string[] {
  const errors: string[] = [];
  const animation = element.textAnimation;
  const source = element.runs.length
    ? element.runs.map((run) => run.text).join('')
    : element.content;
  if (source.length > 4096) errors.push('Text on a path is limited to 4,096 characters.');
  else {
    const graphemes = segmentTextAnimationUnits(source, 'grapheme', element.language);
    if (graphemes.length > 512 || graphemes.some((item) => item.text.length > 64))
      errors.push('Text on a path is limited to 512 graphemes and 64 code units per grapheme.');
  }
  if (
    ![
      'none',
      'fade',
      'typewriter',
      'roll-up',
      'roll-down',
      'count-up',
      'count-down',
      'rise',
      'pop',
      'flip',
      'blur',
      'rotate',
      'stretch',
      'word-reveal',
    ].includes(animation.type)
  )
    errors.push('This text effect is not yet supported on a path.');
  if (
    ['rise', 'pop', 'flip', 'blur', 'rotate', 'stretch'].includes(animation.type) &&
    animation.split !== 'grapheme'
  )
    errors.push('Transform presets on path text require grapheme splitting.');
  if (element.crawl || element.clock)
    errors.push('Crawls and clocks are not yet supported on a path.');
  if (['squeeze', 'shrink-to-fit', 'fit-to-width'].includes(element.autoFit))
    errors.push('Text paths do not yet support automatic fitting or squeeze.');
  const supportedAnimatorProperties = ['opacity', 'color', 'x', 'y', 'scale', 'rotation'];
  if (
    animation.animators?.some(
      (a) =>
        a.enabled &&
        Object.keys(a.properties).some((p) => !supportedAnimatorProperties.includes(p)),
    )
  )
    errors.push('This text animator property is not yet supported on a path.');
  if (
    typeof (element.fill ?? element.color) !== 'string' &&
    animation.animators?.some((a) => a.enabled && a.properties.color)
  )
    errors.push('Color animators on non-solid path text are not yet supported.');
  if (
    animation.type === 'word-reveal' &&
    typeof (element.fill ?? element.color) !== 'string' &&
    !isGradientPaint(element.fill) &&
    animation.animators?.some((a) => a.enabled)
  )
    errors.push('Word Reveal with animators and shader or Media path text is not yet supported.');
  if (element.strokePaint)
    errors.push('Shader strokes on path text are not yet supported in exports.');
  if (/[\r\n]/.test(source)) errors.push('Text on a path must be a single line.');
  if (element.letterSpacing < 0)
    errors.push('Negative tracking is not yet supported on a text path.');
  if (
    element.textTransform === 'capitalize' ||
    (element.textTransform !== 'none' && /[^\x00-\x7f]/.test(source))
  )
    errors.push('Capitalize and non-ASCII case transformations are not yet supported on a path.');
  // Whole-word spans preserve shaping; the restricted cases below avoid mixed
  // bidi runs, inline styles and per-character animators until those have a
  // shaping-aware layout. Digits and punctuation need full bidi processing.
  const simpleWordShaping =
    animation.type === 'word-reveal' &&
    !animation.animators?.some((animator) => animator.enabled) &&
    element.runs.length === 0 &&
    typeof (element.fill ?? element.color) === 'string' &&
    !/[\p{N}\p{P}\p{S}]/u.test(source);
  const simpleArabic =
    simpleWordShaping &&
    element.direction === 'rtl' &&
    /^[\p{Script=Arabic}\p{M}\s]*$/u.test(source);
  const simpleDevanagari =
    simpleWordShaping &&
    element.direction !== 'rtl' &&
    /^[\p{Script=Devanagari}\p{M}\s]+$/u.test(source);
  if (
    !simpleArabic &&
    !simpleDevanagari &&
    (element.direction === 'rtl' ||
      /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
        source,
      ))
  )
    errors.push(
      'This right-to-left or contextual-shaping combination is not yet supported on a path.',
    );
  return errors;
}

export function textPathReferenceErrors(
  owner: Layer,
  reference: TextPathReference,
  layers: readonly Layer[],
): string[] {
  const errors: string[] = [];
  if (owner.element.type !== 'text') errors.push('Only text can follow a path.');
  if (reference.sourceLayerId === owner.id) errors.push('Text cannot use itself as its path.');
  const source = layers.find((layer) => layer.id === reference.sourceLayerId);
  if (!source || source.element.type !== 'path')
    errors.push('Choose a path from this composition.');
  else {
    if (source.isGuide) errors.push('The source path must not be a guide layer.');
    if (source.element.stretchInsets)
      errors.push(
        'Paths with Preserve design / nine-slice insets cannot yet be used as text baselines.',
      );
    try {
      const contours = parseEditablePath(source.element.d);
      const contour = contours[0];
      if (contours.length > 1) errors.push('Text paths must contain a single contour.');
      if (!contour || contour.nodes.length < 2) errors.push('The path needs at least two points.');
      else {
        const first = contour.nodes[0]!;
        const hasLength = contour.nodes.some((node) =>
          [node, node.in, node.out].some(
            (point) => point && Math.hypot(point.x - first.x, point.y - first.y) > 1e-9,
          ),
        );
        if (!hasLength) errors.push('The source path must have nonzero length.');
      }
    } catch {
      errors.push('The selected path geometry is invalid.');
    }
  }
  if (!Number.isFinite(reference.startOffset)) errors.push('Text path offset must be finite.');
  if (!['start', 'center', 'end'].includes(reference.alignment))
    errors.push('Text path alignment is invalid.');
  return errors;
}

/** Never leave a stale reference when copying a subset to a different composition. */
export function remapTextPathReference(
  reference: TextPathReference | null | undefined,
  idMap: ReadonlyMap<string, string>,
  existingIds: ReadonlySet<string>,
): TextPathReference | null {
  if (!reference) return null;
  const sourceLayerId =
    idMap.get(reference.sourceLayerId) ??
    (existingIds.has(reference.sourceLayerId) ? reference.sourceLayerId : null);
  return sourceLayerId ? { ...reference, sourceLayerId } : null;
}
