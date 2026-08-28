import gsap from 'gsap';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  clipPathForParentBounds,
  cubicBezierProgress,
  EFFECT_ANIMATION_PROPERTIES,
  easedProgress,
  getLoopFrameAtElapsed,
  getTrackValueAtFrame,
  isGradientStopOffsetProperty,
  layerEffectsToCssFilter,
  TRANSFORM_ANIMATION_PROPERTIES,
  type AnimatableLayerProperty,
  type LayerAnimationTracks,
  type LayerEffects,
  type LayerTransform,
} from '@ograf-editor/scene-model';
import { applyAnimatedPaint } from './renderElement';

export interface CompiledLayerVisualState {
  transform: LayerTransform;
  effects: LayerEffects;
  paintTracks: LayerAnimationTracks;
  paintFrame: number;
}

/** Resolves a layer loop's active composition-frame window from compiled lifecycle metadata. */
export function compiledLoopElapsedFrames(
  descriptor: CompiledGraphicDescriptor,
  layer: CompiledLayer,
  baseFrame: number,
  heldFrames = 0,
): number | undefined {
  const activation = layer.loop?.activation;
  if (!activation) return undefined;
  const orderedLifecycle = [...descriptor.keyframes].sort(
    (left, right) => left.frame - right.frame,
  );
  const activationKeyframe =
    activation.type === 'lifecycle'
      ? orderedLifecycle.find((keyframe) => keyframe.role === 'step')
      : orderedLifecycle.find((keyframe) => keyframe.id === activation.stepKeyframeId);
  if (!activationKeyframe || baseFrame < activationKeyframe.frame) return undefined;
  const nextBoundary =
    activation.type === 'step'
      ? orderedLifecycle.find((keyframe) => keyframe.frame > activationKeyframe.frame)
      : orderedLifecycle.find((keyframe) => keyframe.role === 'end');
  if (nextBoundary && baseFrame >= nextBoundary.frame) return undefined;
  return Math.max(0, baseFrame - activationKeyframe.frame + Math.max(0, heldFrames));
}

function incomingProgress(
  layer: CompiledLayer,
  property: AnimatableLayerProperty,
  targetFrame: number,
  progress: number,
): number {
  const targetKey = [...(layer.animationTracks[property] ?? [])]
    .sort((left, right) => left.frame - right.frame)
    .reverse()
    .find((key) => key.frame <= targetFrame);
  if (!targetKey) return progress;
  return targetKey.curve
    ? cubicBezierProgress(progress, targetKey.curve)
    : easedProgress(progress, targetKey.easing);
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * Interpolates directly between two already-resolved visual states. This is intentionally not a
 * composition-frame sample: an OGraf stop from Step 1 to End must not expose Step 2 or Step 3 merely
 * because those states sit between the source and End on the authoring ruler.
 */
export function interpolateCompiledLayerVisualState(
  layer: CompiledLayer,
  source: CompiledLayerVisualState,
  target: CompiledLayerVisualState,
  progress: number,
  targetFrame: number,
): CompiledLayerVisualState {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const transform = { ...source.transform };
  for (const property of TRANSFORM_ANIMATION_PROPERTIES) {
    const eased = incomingProgress(layer, property, targetFrame, clampedProgress);
    transform[property] = interpolate(
      source.transform[property],
      target.transform[property],
      eased,
    );
  }

  const effects = { ...source.effects };
  for (const property of EFFECT_ANIMATION_PROPERTIES) {
    const eased = incomingProgress(layer, property, targetFrame, clampedProgress);
    effects[property] = interpolate(source.effects[property], target.effects[property], eased);
  }

  const paintTracks: LayerAnimationTracks = {};
  const paintProperties = new Set<AnimatableLayerProperty>([
    ...(Object.keys(source.paintTracks) as AnimatableLayerProperty[]),
    ...(Object.keys(target.paintTracks) as AnimatableLayerProperty[]),
  ]);
  for (const property of paintProperties) {
    if (!isGradientStopOffsetProperty(property) && property !== 'strokeWidth') continue;
    const from = source.paintTracks[property]?.[0]?.value ?? 0;
    const to = target.paintTracks[property]?.[0]?.value ?? from;
    const eased = incomingProgress(layer, property, targetFrame, clampedProgress);
    paintTracks[property] = [
      {
        id: `${layer.id}:${property}:transition`,
        frame: 0,
        value: interpolate(from, to, eased),
        easing: 'linear',
      },
    ];
  }

  return { transform, effects, paintTracks, paintFrame: 0 };
}

function firstTransform(layer: CompiledLayer): LayerTransform {
  const first = [...layer.keyframes].sort((a, b) => a.frame - b.frame)[0]?.transform;
  if (!first) throw new Error(`Compiled layer "${layer.id}" has no transform key.`);
  return first;
}

/** Pure property sampling shared by realtime loops, non-realtime seeking, and editor preview. */
export function sampleCompiledLayerVisualState(
  layer: CompiledLayer,
  baseFrame: number,
  loopElapsedFrames?: number,
): CompiledLayerVisualState {
  const initial = firstTransform(layer);
  const transform = Object.fromEntries(
    TRANSFORM_ANIMATION_PROPERTIES.map((property) => [
      property,
      getTrackValueAtFrame(layer.animationTracks[property] ?? [], baseFrame, initial[property]),
    ]),
  ) as unknown as LayerTransform;
  const effects = { ...layer.effects };
  for (const property of EFFECT_ANIMATION_PROPERTIES) {
    effects[property] = getTrackValueAtFrame(
      layer.animationTracks[property] ?? [],
      baseFrame,
      effects[property],
    );
  }

  const loop = layer.loop;
  const localFrame =
    loop && loopElapsedFrames !== undefined
      ? getLoopFrameAtElapsed(loop, loopElapsedFrames)
      : undefined;
  if (loop && localFrame !== undefined) {
    for (const property of Object.keys(loop.tracks) as AnimatableLayerProperty[]) {
      const keys = loop.tracks[property] ?? [];
      if (
        keys.length === 0 ||
        isGradientStopOffsetProperty(property) ||
        property === 'strokeWidth'
      ) {
        continue;
      }
      if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)) {
        const transformProperty = property as keyof LayerTransform;
        transform[transformProperty] = getTrackValueAtFrame(
          keys,
          localFrame,
          transform[transformProperty],
        );
      } else if (EFFECT_ANIMATION_PROPERTIES.some((candidate) => candidate === property)) {
        const effectProperty = property as (typeof EFFECT_ANIMATION_PROPERTIES)[number];
        effects[effectProperty] = getTrackValueAtFrame(keys, localFrame, effects[effectProperty]);
      }
    }
  }

  const paintTracks: LayerAnimationTracks = {};
  const paintProperties = new Set<AnimatableLayerProperty>([
    ...(Object.keys(layer.animationTracks) as AnimatableLayerProperty[]),
    ...(Object.keys(loop?.tracks ?? {}) as AnimatableLayerProperty[]),
  ]);
  for (const property of paintProperties) {
    if (!isGradientStopOffsetProperty(property) && property !== 'strokeWidth') continue;
    const fallback =
      property === 'strokeWidth' && layer.element.type === 'text' ? layer.element.strokeWidth : 0;
    const baseValue = getTrackValueAtFrame(
      layer.animationTracks[property] ?? [],
      baseFrame,
      fallback,
    );
    const loopKeys = loop?.tracks[property] ?? [];
    const value =
      localFrame !== undefined && loopKeys.length > 0
        ? getTrackValueAtFrame(loopKeys, localFrame, baseValue)
        : baseValue;
    paintTracks[property] = [
      { id: `${layer.id}:${property}:sample`, frame: 0, value, easing: 'linear' },
    ];
  }

  return { transform, effects, paintTracks, paintFrame: 0 };
}

export function applyCompiledLayerVisualState(
  element: HTMLElement,
  state: CompiledLayerVisualState,
): void {
  const { transform } = state;
  gsap.set(element, {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    rotation: transform.rotation,
    opacity: transform.opacity,
    transformOrigin: `${transform.transformOriginX * 100}% ${transform.transformOriginY * 100}%`,
  });
  element.style.filter = layerEffectsToCssFilter(state.effects);
  applyAnimatedPaint(element, state.paintTracks, state.paintFrame);
}

/** Applies clipping after every participating layer pose has been resolved. */
export function applyCompiledClipPaths(
  descriptor: CompiledGraphicDescriptor,
  elements: Map<string, HTMLElement>,
  states: Map<string, CompiledLayerVisualState>,
): void {
  for (const layer of descriptor.layers) {
    if (!layer.clipParentId) continue;
    const child = elements.get(layer.id);
    const childState = states.get(layer.id);
    const parentState = states.get(layer.clipParentId);
    const parentLayer = descriptor.layers.find((candidate) => candidate.id === layer.clipParentId);
    if (!child || !childState || !parentState || !parentLayer) {
      if (child) child.style.clipPath = 'inset(50%)';
      continue;
    }
    const radius = parentLayer.element.type === 'rectangle' ? parentLayer.element.borderRadius : 0;
    child.style.clipPath = clipPathForParentBounds(
      childState.transform,
      parentState.transform,
      radius,
    );
  }
}
