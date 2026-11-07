import { cubicBezierProgress, type LayerUpdateTransition } from '@ograf-editor/scene-model';

/** The easing an update's motion runs on. On air the browser samples this keyword itself. */
export const UPDATE_MOTION_EASING = 'ease-in-out';
/** That keyword as CSS defines it, for replay to sample at any time. */
const UPDATE_MOTION_CURVE = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

/** How an update moves one layer's content out and back in. */
export interface UpdateMotion {
  /** The length of the out half, and again of the in half. */
  halfMs: number;
  /** Where the out half ends, in pixels from where the content rests. */
  x: number;
  y: number;
}

export interface UpdateMotionSample {
  opacity: number;
  x: number;
  y: number;
}

/** The motion a layer's update transition asks for, or undefined if it cuts to the new value. */
export function resolveUpdateMotion(
  transition: LayerUpdateTransition | undefined,
  compositionFrames: number | undefined,
  frameRate: number,
): UpdateMotion | undefined {
  const { style, durationFrames, distance } = transition ?? {
    style: 'inherit' as const,
    durationFrames: 0,
    distance: 24,
  };
  const frames = durationFrames || compositionFrames || 0;
  if (style === 'none' || frames <= 0) return undefined;
  return {
    halfMs: (frames / frameRate) * 500,
    x: style === 'slide-left' ? -distance : style === 'slide-right' ? distance : 0,
    y: style === 'slide-up' ? -distance : style === 'slide-down' ? distance : 0,
  };
}

/**
 * A layer's content `elapsedMs` into an update whose data changes at `switchMs`. The graphic has one
 * data change, when its slowest layer has finished leaving, so a quicker layer waits fully out until
 * then. Every layer starts back at the data change and takes its own in half to arrive.
 */
export function sampleUpdateMotion(
  motion: UpdateMotion,
  elapsedMs: number,
  switchMs: number,
): UpdateMotionSample {
  const leaving = elapsedMs < switchMs;
  const progress = Math.min(1, (leaving ? elapsedMs : elapsedMs - switchMs) / motion.halfMs);
  const eased = cubicBezierProgress(progress, UPDATE_MOTION_CURVE);
  const away = leaving ? eased : 1 - eased;
  return { opacity: 1 - away, x: motion.x * away, y: motion.y * away };
}
