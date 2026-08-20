import gsap from 'gsap';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  clipPathForParentBounds,
  EFFECT_ANIMATION_PROPERTIES,
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
      if (keys.length === 0 || isGradientStopOffsetProperty(property)) continue;
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
    if (!isGradientStopOffsetProperty(property)) continue;
    const baseValue = getTrackValueAtFrame(layer.animationTracks[property] ?? [], baseFrame, 0);
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
