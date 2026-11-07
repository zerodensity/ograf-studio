import {
  hasElementShaderPaint,
  hasTextAnimationSettings,
  normalizeTextAnimation,
  type Element as SceneElement,
  type TickerContentElement,
} from '@ograf-editor/scene-model';

/**
 * What a data change does to one resolved element on a mounted template:
 * - `none`: nothing the viewer can see.
 * - `uniforms`: only shader parameters, which reach the running shader without a new frame.
 * - `content`: redrawn with resources already on the page, such as new text or a color.
 * - `image`: a plain image source, which can be loaded ahead and swapped without a blank frame.
 * - `resource`: anything else that has to load, which only a separate template host can prepare.
 */
export type ElementDataChange = 'none' | 'uniforms' | 'content' | 'image' | 'resource';

function paintResource(paint: unknown): unknown {
  if (!paint || typeof paint !== 'object') return null;
  const value = paint as {
    type?: unknown;
    fragmentSource?: unknown;
    inputImage?: unknown;
    source?: unknown;
  };
  if (value.type === 'shader') return [value.fragmentSource, value.inputImage ?? null];
  if (value.type === 'media') return value.source ?? null;
  return null;
}

function elementResources(element: SceneElement | TickerContentElement): unknown {
  const painted = element as { fill?: unknown; strokePaint?: unknown };
  const paints = [paintResource(painted.fill), paintResource(painted.strokePaint)];
  switch (element.type) {
    case 'image':
    case 'audio':
      return [element.src, paints];
    case 'image-sequence':
      return [element.frames, paints];
    case 'lottie':
      return [element.animationData, paints];
    case 'shader':
      return paintResource(element);
    case 'ticker':
      return [
        element.items.map((item) => elementResources(item.element)),
        paintResource(element.background),
      ];
    default:
      return paints;
  }
}

const withoutShaderParameters = (key: string, value: unknown) =>
  key === 'parameters' ? undefined : value;

export function classifyElementDataChange(
  before: SceneElement,
  after: SceneElement,
): ElementDataChange {
  if (JSON.stringify(before) === JSON.stringify(after)) return 'none';
  if (before.type !== after.type) return 'resource';
  if (JSON.stringify(elementResources(before)) !== JSON.stringify(elementResources(after))) {
    if (before.type !== 'image' || after.type !== 'image' || before.fill || after.fill)
      return 'resource';
    return after.src ? 'image' : 'content';
  }
  if (
    (after.type === 'shader' || hasElementShaderPaint(after)) &&
    JSON.stringify(before, withoutShaderParameters) ===
      JSON.stringify(after, withoutShaderParameters)
  )
    return 'uniforms';
  return 'content';
}

/** Tickers, charts, clocks and replaying text show their own update unless a length is authored. */
export function animatesItsOwnUpdate(element: SceneElement): boolean {
  if (element.type === 'ticker' || element.type === 'chart') return true;
  if (element.type !== 'text') return false;
  if (element.clock) return true;
  const animation = normalizeTextAnimation(element.textAnimation);
  return hasTextAnimationSettings(animation) && animation.replayOnUpdate;
}
