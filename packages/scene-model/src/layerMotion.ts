import { createLayerKeyframe, createLayerPropertyKeyframe } from './factory';
import { computeKeyframeFrames } from './keyframeTiming';
import {
  getLayerPropertyValueAtFrame,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  isAnimatableLayerPropertyApplicable,
  isRevealAnimationProperty,
  REVEAL_ANIMATION_PROPERTIES,
  revealPropertyDefault,
  sortLayerKeyframes,
  sortLayerPropertyKeyframes,
  TRANSFORM_ANIMATION_PROPERTIES,
} from './layerAnimation';
import type {
  Composition,
  EasingPreset,
  Layer,
  LayerMotionDirection,
  LayerMotionSpec,
  LayerMotionStyle,
  LayerPropertyKeyframe,
  LayerRevealProperty,
} from './types';

/** Properties every Animate In/Out bake owns, so a side always starts from a clean window. */
export const LAYER_MOTION_PROPERTIES = ['x', 'y', 'opacity', 'blur'] as const;
type MotionProperty =
  (typeof LAYER_MOTION_PROPERTIES)[number] | 'width' | 'height' | 'rotation' | LayerRevealProperty;

export const LAYER_MOTION_DEFAULT_DISTANCE = 80;
const FOCUS_BLUR = 24;
const FLY_MARGIN = 40;
const SCALE_FROM = 0.5;
const SPIN_DEGREES = 90;

export type LayerMotionSide = 'in' | 'out';

export const LAYER_MOTION_STYLES: LayerMotionStyle[] = [
  'fade',
  'slide',
  'fly',
  'focus',
  'wipe',
  'scale',
  'pop',
  'grow',
  'spin',
  'drop',
];

const EDGE_DIRECTIONS: LayerMotionDirection[] = ['left', 'right', 'up', 'down'];

/** Directions a style offers; the first is its default. Empty when the style has no direction. */
export function layerMotionDirections(style: LayerMotionStyle): LayerMotionDirection[] {
  switch (style) {
    case 'slide':
    case 'fly':
      return EDGE_DIRECTIONS;
    case 'wipe':
    case 'grow':
      return [...EDGE_DIRECTIONS, 'center'];
    case 'spin':
      return ['right', 'left'];
    default:
      return [];
  }
}

function motionDirection(spec: LayerMotionSpec): LayerMotionDirection {
  const directions = layerMotionDirections(spec.style);
  return spec.direction && directions.includes(spec.direction)
    ? spec.direction
    : (directions[0] ?? 'left');
}

/** Pop springs and Drop lands with a bounce; everything else eases out on entry, in on exit. */
export function layerMotionDefaultEasing(
  style: LayerMotionStyle,
  side: LayerMotionSide,
): EasingPreset {
  if (style === 'pop') return side === 'in' ? 'back-out' : 'back-in';
  if (style === 'drop' && side === 'in') return 'bounce-out';
  return side === 'in' ? 'cubic-out' : 'cubic-in';
}

/** Motion properties this layer can animate; blur needs the layer's built-in blur effect. */
export function layerMotionProperties(layer: Layer): (typeof LAYER_MOTION_PROPERTIES)[number][] {
  return LAYER_MOTION_PROPERTIES.filter((property) =>
    isAnimatableLayerPropertyApplicable(layer, property),
  );
}

/** Focus needs a blur to animate; Grow resizes the box, which would reflow text. */
export function layerMotionStyleAvailable(layer: Layer, style: LayerMotionSpec['style']): boolean {
  if (style === 'focus') return layerMotionProperties(layer).includes('blur');
  if (style === 'grow') return layer.element.type !== 'text';
  return true;
}

/** The properties a style moves, beyond the ones it holds still. */
function movedProperties(spec: LayerMotionSpec): MotionProperty[] {
  const direction = motionDirection(spec);
  const horizontal = direction === 'left' || direction === 'right';
  switch (spec.style) {
    case 'fade':
      return ['opacity'];
    case 'focus':
      return ['opacity', 'blur'];
    case 'slide':
      return ['opacity', horizontal ? 'x' : 'y'];
    case 'fly':
      return [horizontal ? 'x' : 'y'];
    case 'drop':
      return ['y'];
    case 'scale':
      return ['scale', 'opacity'];
    case 'pop':
      return ['scale'];
    case 'spin':
      return ['rotation', 'opacity'];
    case 'wipe':
      return direction === 'center'
        ? ['clipLeft', 'clipRight']
        : [
            direction === 'left'
              ? 'clipRight'
              : direction === 'right'
                ? 'clipLeft'
                : direction === 'up'
                  ? 'clipBottom'
                  : 'clipTop',
          ];
    case 'grow':
      return horizontal || direction === 'center' ? ['width', 'x'] : ['height', 'y'];
  }
}

/** The IN window runs from Start to the first Step; OUT from the last Step to End. */
export interface LayerMotionWindows {
  start: number;
  firstStep: number;
  lastStep: number;
  end: number;
  /** Longest motion that fits each window, in frames. */
  inFrames: number;
  outFrames: number;
}

export function layerMotionWindows(
  composition: Pick<Composition, 'keyframes' | 'transitions'>,
): LayerMotionWindows | null {
  const frames = new Map(
    computeKeyframeFrames(composition as Composition).map((entry) => [
      entry.keyframeId,
      entry.frame,
    ]),
  );
  const start = composition.keyframes.find((keyframe) => keyframe.role === 'start');
  const end = composition.keyframes.find((keyframe) => keyframe.role === 'end');
  const steps = composition.keyframes.filter((keyframe) => keyframe.role === 'step');
  if (!start || !end || steps.length === 0) return null;
  const at = (id: string) => frames.get(id) ?? 0;
  const firstStep = at(steps[0]!.id);
  const lastStep = at(steps.at(-1)!.id);
  return {
    start: at(start.id),
    firstStep,
    lastStep,
    end: at(end.id),
    inFrames: Math.max(0, firstStep - at(start.id)),
    outFrames: Math.max(0, at(end.id) - lastStep),
  };
}

export function defaultLayerMotionSpec(
  style: LayerMotionSpec['style'],
  windowFrames: number,
): LayerMotionSpec {
  const direction = layerMotionDirections(style)[0];
  return {
    style,
    ...(direction ? { direction } : {}),
    ...(style === 'slide' ? { distance: LAYER_MOTION_DEFAULT_DISTANCE } : {}),
    durationFrames: Math.max(1, Math.min(windowFrames, style === 'drop' ? 18 : 12)),
  };
}

/** Values a layer holds off air, for the properties the style moves. */
function offAirValues(
  composition: Pick<Composition, 'width' | 'height'>,
  spec: LayerMotionSpec,
  side: LayerMotionSide,
  onAir: Record<MotionProperty, number>,
): Partial<Record<MotionProperty, number>> {
  const direction = motionDirection(spec);
  switch (spec.style) {
    case 'fade':
      return { opacity: 0 };
    case 'focus':
      return { opacity: 0, blur: onAir.blur + FOCUS_BLUR };
    case 'slide': {
      const distance = Math.max(0, spec.distance ?? LAYER_MOTION_DEFAULT_DISTANCE);
      const offset =
        direction === 'left'
          ? { x: onAir.x - distance }
          : direction === 'right'
            ? { x: onAir.x + distance }
            : direction === 'up'
              ? { y: onAir.y - distance }
              : { y: onAir.y + distance };
      return { opacity: 0, ...offset };
    }
    case 'fly':
      return direction === 'left'
        ? { x: -onAir.width - FLY_MARGIN }
        : direction === 'right'
          ? { x: composition.width + FLY_MARGIN }
          : direction === 'up'
            ? { y: -onAir.height - FLY_MARGIN }
            : { y: composition.height + FLY_MARGIN };
    case 'drop':
      return { y: side === 'in' ? -onAir.height - FLY_MARGIN : composition.height + FLY_MARGIN };
    case 'scale':
      return { scale: onAir.scale * SCALE_FROM, opacity: 0 };
    case 'pop':
      return { scale: 0 };
    case 'spin': {
      // Clockwise turns in from -90° and out to +90°; counter-clockwise mirrors that.
      const turn = (direction === 'left' ? -1 : 1) * (side === 'in' ? -1 : 1) * SPIN_DEGREES;
      return { rotation: onAir.rotation + turn, opacity: 0 };
    }
    case 'wipe':
      return Object.fromEntries(
        movedProperties(spec).map((property) => [property, direction === 'center' ? 0.5 : 1]),
      );
    case 'grow':
      switch (direction) {
        case 'left':
          return { width: 0 };
        case 'right':
          return { width: 0, x: onAir.x + onAir.width };
        case 'center':
          return { width: 0, x: onAir.x + onAir.width / 2 };
        case 'up':
          return { height: 0 };
        case 'down':
          return { height: 0, y: onAir.y + onAir.height };
      }
  }
}

function inWindow(windows: LayerMotionWindows, side: LayerMotionSide, frame: number): boolean {
  return side === 'in'
    ? frame >= windows.start && frame < windows.firstStep
    : frame > windows.lastStep && frame <= windows.end;
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/**
 * What a side currently does: the stored choice, `custom` when the window holds other motion
 * (hand-made keys or a recipe), or `null` when the layer simply holds still.
 */
export function layerMotionState(
  composition: Pick<Composition, 'keyframes' | 'transitions'>,
  layer: Layer,
  side: LayerMotionSide,
): LayerMotionSpec | 'custom' | null {
  const stored = layer.motion?.[side];
  if (stored) return stored;
  const windows = layerMotionWindows(composition);
  if (!windows) return null;
  const anchor = side === 'in' ? windows.firstStep : windows.lastStep;
  const tracks = getResolvedLayerAnimationTracks(layer);
  const stateProperties = new Set<MotionProperty>([
    ...layerMotionProperties(layer),
    'width',
    'height',
    'rotation',
    ...REVEAL_ANIMATION_PROPERTIES,
  ]);
  for (const property of stateProperties) {
    if (!isAnimatableLayerPropertyApplicable(layer, property)) continue;
    const onAir = getLayerPropertyValueAtFrame(layer, property, anchor);
    if (
      (tracks[property] ?? []).some(
        (key) => inWindow(windows, side, key.frame) && !sameValue(key.value, onAir),
      )
    )
      return 'custom';
  }
  return null;
}

function revealTrackIsIdle(layer: Layer, property: MotionProperty): boolean {
  return (
    isRevealAnimationProperty(property) &&
    (layer.animationTracks[property] ?? []).every((key) =>
      sameValue(key.value, revealPropertyDefault(property)),
    )
  );
}

/**
 * Bakes an entrance or exit into the layer's tracks, replacing whatever the touched tracks held
 * inside that side's window: x, y, opacity and blur always, plus whatever the new or previous
 * choice moves (scale, wipe insets, width/height, rotation). `null` makes the layer hold its
 * on-air values through the window. The layer's pose at the first Step (in) or last Step (out) is
 * kept. `offsetFrames` finishes the motion that many frames early, for staggered groups.
 */
export function applyLayerMotion(
  composition: Composition,
  layer: Layer,
  side: LayerMotionSide,
  spec: LayerMotionSpec | null,
): void {
  const windows = layerMotionWindows(composition);
  if (!windows)
    throw new Error('Animate In/Out needs a Start, at least one Step, and an End keyframe.');
  const anchor = side === 'in' ? windows.firstStep : windows.lastStep;
  const previous = layer.motion?.[side] ?? null;
  const previousApplication = layer.animationPresets?.[side];
  const previousPlugin = previousApplication
    ? composition.animationPresetPlugins?.find(
        (snapshot) =>
          snapshot.manifest.id === previousApplication.reference.id &&
          snapshot.manifest.version === previousApplication.reference.version &&
          snapshot.sha256 === previousApplication.reference.sha256,
      )
    : undefined;
  const previousPreset = previousPlugin?.presets.find(
    (preset) => preset.id === previousApplication?.presetId,
  );
  const properties = [
    ...new Set<MotionProperty>([
      ...layerMotionProperties(layer).filter(
        (property) =>
          layer.animationTrackMode !== 'independent' ||
          (layer.animationTracks[property]?.length ?? 0) > 0,
      ),
      ...(spec ? movedProperties(spec) : []),
      ...(previous ? movedProperties(previous) : []),
      ...(previousPreset?.tracks[side] ?? []).map((track) => track.property),
    ]),
  ].filter((property) => isAnimatableLayerPropertyApplicable(layer, property));
  const onAir = Object.fromEntries(
    (
      [
        ...LAYER_MOTION_PROPERTIES,
        'width',
        'height',
        'rotation',
        ...REVEAL_ANIMATION_PROPERTIES,
      ] as MotionProperty[]
    ).map((property) => [
      property,
      isAnimatableLayerPropertyApplicable(layer, property)
        ? getLayerPropertyValueAtFrame(layer, property, anchor)
        : 0,
    ]),
  ) as Record<MotionProperty, number>;

  layer.animationTracks = Object.fromEntries(
    Object.entries(
      layer.animationTrackMode === 'independent'
        ? layer.animationTracks
        : getResolvedLayerAnimationTracks(layer),
    ).map(([property, keys]) => [
      property,
      keys?.map((key) => ({ ...key, ...(key.curve ? { curve: { ...key.curve } } : {}) })) ?? [],
    ]),
  );

  const available = side === 'in' ? windows.inFrames : windows.outFrames;
  const duration = spec ? Math.max(1, Math.min(available, Math.round(spec.durationFrames))) : 0;
  const offset = spec
    ? Math.max(0, Math.min(available - duration, Math.round(spec.offsetFrames ?? 0)))
    : 0;
  const off = spec && available > 0 ? offAirValues(composition, spec, side, onAir) : {};
  const easing: EasingPreset =
    spec?.easing ?? layerMotionDefaultEasing(spec?.style ?? 'fade', side);

  for (const property of properties) {
    const track = (layer.animationTracks[property] ?? []).filter(
      (key) => !inWindow(windows, side, key.frame),
    );
    const put = (frame: number, value: number, keyEasing?: EasingPreset) => {
      const existing = track.find((key) => key.frame === frame);
      if (existing) {
        existing.value = value;
        if (keyEasing) {
          existing.easing = keyEasing;
          delete existing.curve;
        }
      } else
        track.push(
          createLayerPropertyKeyframe(frame, value, {
            easing: keyEasing ?? 'linear',
          }) as LayerPropertyKeyframe,
        );
    };
    const offValue = off[property];
    if (offValue === undefined) {
      // Reveal tracks exist only for motion, so a style that leaves them alone drops their keys.
      if (!isRevealAnimationProperty(property))
        put(side === 'in' ? windows.start : windows.end, onAir[property]);
    } else if (side === 'in') {
      const arrive = windows.firstStep - offset;
      put(windows.start, offValue);
      if (arrive - duration > windows.start) put(arrive - duration, offValue);
      put(arrive, onAir[property], easing);
      if (arrive < windows.firstStep) put(windows.firstStep, onAir[property]);
    } else {
      const leave = windows.end - offset;
      if (!track.some((key) => key.frame === windows.lastStep))
        put(windows.lastStep, onAir[property]);
      if (leave - duration > windows.lastStep) put(leave - duration, onAir[property]);
      put(leave, offValue, easing);
      if (leave < windows.end) put(windows.end, offValue);
    }
    layer.animationTracks[property] = sortLayerPropertyKeyframes(track);
    if (revealTrackIsIdle(layer, property)) delete layer.animationTracks[property];
  }

  // Keep the aggregate pose keys (the timeline's per-layer diamonds) in step with the tracks.
  const lifecycleFrames = new Set([
    windows.start,
    windows.firstStep,
    windows.lastStep,
    windows.end,
  ]);
  const transformFrames = new Set<number>(lifecycleFrames);
  for (const property of TRANSFORM_ANIMATION_PROPERTIES)
    for (const key of layer.animationTracks[property] ?? []) transformFrames.add(key.frame);
  const easingAt = (frame: number) =>
    properties
      .flatMap((property) => layer.animationTracks[property] ?? [])
      .find((key) => key.frame === frame && key.easing !== 'linear')?.easing ?? 'linear';
  layer.keyframes = sortLayerKeyframes([
    ...layer.keyframes.filter((key) => transformFrames.has(key.frame)),
    ...[...transformFrames]
      .filter((frame) => !layer.keyframes.some((key) => key.frame === frame))
      .map((frame) => createLayerKeyframe(frame, getLayerTransformAtFrame(layer, frame))),
  ]);
  for (const key of layer.keyframes) {
    key.transform = getLayerTransformAtFrame(layer, key.frame);
    if (inWindow(windows, side, key.frame) || key.frame === anchor || key.frame === windows.end)
      key.easing = easingAt(key.frame);
  }

  const stored = spec ? { ...spec, durationFrames: duration } : null;
  if (stored) {
    if (layerMotionDirections(stored.style).length) stored.direction = motionDirection(stored);
    else delete stored.direction;
    if (offset) stored.offsetFrames = offset;
    else delete stored.offsetFrames;
  }
  layer.motion = {
    in: layer.motion?.in ?? null,
    out: layer.motion?.out ?? null,
    [side]: stored,
  };
  if (layer.animationPresets) {
    delete layer.animationPresets[side];
    if (!layer.animationPresets.in && !layer.animationPresets.out) delete layer.animationPresets;
  }
}

/** Which selected layer moves first in a staggered In/Out. */
export type LayerMotionStaggerOrder =
  'left-to-right' | 'right-to-left' | 'top-to-bottom' | 'bottom-to-top';

export const LAYER_MOTION_STAGGER_ORDERS: LayerMotionStaggerOrder[] = [
  'left-to-right',
  'right-to-left',
  'top-to-bottom',
  'bottom-to-top',
];

export interface LayerMotionStagger {
  /** Frames between one layer's motion and the next. */
  frames: number;
  order: LayerMotionStaggerOrder;
}

/**
 * Per-layer `offsetFrames` for a stagger: the first layer in order arrives (and leaves) first, so
 * it finishes earliest and carries the largest offset. Layers sort by their on-air centre.
 */
export function layerMotionStaggerOffsets(
  composition: Pick<Composition, 'keyframes' | 'transitions'>,
  layers: Layer[],
  side: LayerMotionSide,
  stagger: LayerMotionStagger,
): Map<string, number> {
  const windows = layerMotionWindows(composition);
  const anchor = windows ? (side === 'in' ? windows.firstStep : windows.lastStep) : 0;
  const centre = (layer: Layer) => {
    const pose = getLayerTransformAtFrame(layer, anchor);
    return stagger.order === 'left-to-right' || stagger.order === 'right-to-left'
      ? pose.x + pose.width / 2
      : pose.y + pose.height / 2;
  };
  const sign = stagger.order === 'right-to-left' || stagger.order === 'bottom-to-top' ? -1 : 1;
  const ordered = layers
    .map((layer, index) => ({ layer, index, centre: centre(layer) }))
    .sort((a, b) => sign * (a.centre - b.centre) || a.index - b.index);
  const frames = Math.max(0, Math.round(stagger.frames));
  return new Map(
    ordered.map(({ layer }, index) => [layer.id, (ordered.length - 1 - index) * frames]),
  );
}

/** Reads back the stagger the layers' stored offsets describe, or 0 frames when there is none. */
export function layerMotionStagger(
  composition: Pick<Composition, 'keyframes' | 'transitions'>,
  layers: Layer[],
  side: LayerMotionSide,
): LayerMotionStagger {
  const offsets = layers.map((layer) => layer.motion?.[side]?.offsetFrames ?? 0);
  const largest = Math.max(0, ...offsets);
  if (layers.length < 2 || largest === 0) return { frames: 0, order: 'left-to-right' };
  const frames = Math.round(largest / (layers.length - 1));
  const order =
    LAYER_MOTION_STAGGER_ORDERS.find((candidate) => {
      const expected = layerMotionStaggerOffsets(composition, layers, side, {
        frames,
        order: candidate,
      });
      return layers.every(
        (layer) => (layer.motion?.[side]?.offsetFrames ?? 0) === expected.get(layer.id),
      );
    }) ?? 'left-to-right';
  return { frames, order };
}
