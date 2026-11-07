import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  EFFECT_ANIMATION_PROPERTIES,
  effectParameterValue,
  getShaderAnimationValue,
  isRevealAnimationProperty,
  modifierParameterValue,
  revealPropertyDefault,
  sampleEffectStack,
  sampleLayerModifiers,
  shaderAnimationPropertySpec,
  type AnimatableLayerProperty,
} from '@ograf-editor/scene-model';
import {
  compiledLoopElapsedFrames,
  sampleCompiledLayerVisualState,
  type CompiledLayerVisualState,
} from './loopRendering';
import { resolveBoundElement } from './renderElement';
import { visualRuleLayerModifiers } from './runtimeVisualRules';

/** Global coordinator timing for one authored lifecycle segment, independent of wall clocks. */
export interface TransitionLogicLifecyclePose {
  phase: 'in' | 'out' | 'hold';
  startFrame: number;
  durationFrames: number;
  /** Defaults to the first on-air Step. An exit never visits unrelated later Steps. */
  stepKeyframeId?: string;
  /** The global frame at which independent on-air loops became active. */
  loopStartFrame?: number;
  /** A content-wrapper preset replaces authored In/Out geometry, not independent clocks/loops. */
  contentAtHold?: boolean;
}

export interface TransitionLogicLifecycleSample {
  frame: number;
  holdFrame: number;
  startFrame: number;
  loopHeldFrames: number;
  loopSampleFrame: number;
  transitioning: boolean;
  /** An OUT samples the final authored exit segment, corrected from the active Step/loop pose. */
  exit?: { fromFrame: number; remaining: number };
}

export function sampleTransitionLogicLifecycle(
  descriptor: CompiledGraphicDescriptor,
  frame: number,
  mountStartFrame: number,
  lifecycle?: TransitionLogicLifecyclePose,
): TransitionLogicLifecycleSample {
  const keyFrame = (id: string | undefined, fallback: number) =>
    descriptor.keyframes.find((key) => key.id === id)?.frame ?? fallback;
  const start = keyFrame(descriptor.startKeyframeId, 0);
  const hold = keyFrame(lifecycle?.stepKeyframeId ?? descriptor.stepKeyframeIds[0], start);
  const end = keyFrame(descriptor.endKeyframeId, hold);
  const progress = lifecycle
    ? lifecycle.durationFrames <= 0
      ? frame < lifecycle.startFrame
        ? 0
        : 1
      : Math.min(1, Math.max(0, (frame - lifecycle.startFrame) / lifecycle.durationFrames))
    : 1;
  const loopFrame = lifecycle?.phase === 'out' ? lifecycle.startFrame : frame;
  const loopStart = lifecycle?.loopStartFrame ?? mountStartFrame;
  const common = {
    holdFrame: hold,
    startFrame: start,
    loopHeldFrames: Math.max(0, loopFrame - loopStart),
    loopSampleFrame: loopFrame,
    transitioning:
      lifecycle !== undefined && lifecycle.phase !== 'hold' && !lifecycle.contentAtHold,
  };
  if (lifecycle?.contentAtHold) return { ...common, frame: hold };
  if (lifecycle?.phase === 'in') return { ...common, frame: start + (hold - start) * progress };
  if (lifecycle?.phase === 'out') {
    const finalHold =
      descriptor.exitTailStartFrame ?? keyFrame(descriptor.stepKeyframeIds.at(-1), hold);
    return {
      ...common,
      frame: finalHold + (end - finalHold) * progress,
      exit: { fromFrame: finalHold, remaining: 1 - progress },
    };
  }
  return { ...common, frame: hold };
}

export type TransitionLogicLoopSampler = (
  layer: CompiledLayer,
  elapsedFrames: number | undefined,
  frame: number,
) => number | undefined;

/**
 * Sample all authored channels together, before shared geometry, layout, paths and masks.
 * On OUT the active loop is frozen at the exit boundary and its difference decays to zero.
 * Sampling the final Step-to-End segment preserves authored exit staging without playing
 * another Step's content or jumping to its geometry first.
 */
export function sampleTransitionLogicLayerVisualState(
  descriptor: CompiledGraphicDescriptor,
  layer: CompiledLayer,
  timing: TransitionLogicLifecycleSample,
  data: Record<string, unknown>,
  options: { skipRulePose?: boolean } = {},
  sampleLoop: TransitionLogicLoopSampler = (_layer, elapsed) => elapsed,
): CompiledLayerVisualState {
  const loop = (baseFrame: number) =>
    sampleLoop(
      layer,
      compiledLoopElapsedFrames(descriptor, layer, baseFrame, timing.loopHeldFrames),
      timing.loopSampleFrame,
    );
  const geometryRules =
    timing.transitioning && !options.skipRulePose ? visualRuleLayerModifiers(layer, data) : null;
  const held = geometryRules?.geometry
    ? sampleCompiledLayerVisualState(layer, timing.holdFrame, undefined, data, {
        skipRulePose: true,
      })
    : null;
  const sample = (baseFrame: number, loopFrame: number | undefined) => {
    const state = sampleCompiledLayerVisualState(layer, baseFrame, loopFrame, data, options);
    if (!held || !geometryRules?.geometry) return state;
    const raw = sampleCompiledLayerVisualState(layer, baseFrame, loopFrame, data, {
      skipRulePose: true,
    });
    // Width/height and positions authored by Rules describe the on-air layout. Keep the
    // authored lifecycle travel relative to it, so a one-story OTS still draws its bracket
    // instead of jumping directly to the Rules-controlled height before entry completes.
    for (const property of ['x', 'y', 'width', 'height'] as const) {
      const value = geometryRules.geometry[property];
      if (value === undefined) continue;
      const baseline = held.transform[property];
      state.transform[property] =
        (property === 'width' || property === 'height') && baseline !== 0
          ? value * (raw.transform[property] / baseline)
          : value + raw.transform[property] - baseline;
      if (property === 'x') state.transform.x += geometryRules.offsetX;
      if (property === 'y') state.transform.y += geometryRules.offsetY;
    }
    return state;
  };
  const state = sample(timing.frame, timing.exit ? undefined : loop(timing.frame));
  if (!timing.exit || timing.exit.remaining <= 0) return state;
  const source = sample(timing.holdFrame, loop(timing.holdFrame));
  const authored = sample(timing.exit.fromFrame, undefined);
  const remaining = timing.exit.remaining;
  for (const property of Object.keys(state.transform) as (keyof typeof state.transform)[])
    state.transform[property] +=
      (source.transform[property] - authored.transform[property]) * remaining;
  for (const property of EFFECT_ANIMATION_PROPERTIES)
    state.effects[property] += (source.effects[property] - authored.effects[property]) * remaining;
  state.effects = sampleEffectStack(
    state.effects,
    (property, value) =>
      value +
      (Number(effectParameterValue(source.effects, property) ?? value) -
        Number(effectParameterValue(authored.effects, property) ?? value)) *
        remaining,
  );
  const boundElement = resolveBoundElement(layer, data);
  for (const property of new Set<AnimatableLayerProperty>([
    ...(Object.keys(state.paintTracks) as AnimatableLayerProperty[]),
    ...(Object.keys(source.paintTracks) as AnimatableLayerProperty[]),
    ...(Object.keys(authored.paintTracks) as AnimatableLayerProperty[]),
  ])) {
    const shader = shaderAnimationPropertySpec(boundElement, property);
    const fallback = shader
      ? getShaderAnimationValue(boundElement, property)
      : isRevealAnimationProperty(property)
        ? revealPropertyDefault(property)
        : property === 'motionPathProgress'
          ? (layer.motionPath?.progress ?? 0)
          : 0;
    const value = state.paintTracks[property]?.[0]?.value ?? fallback;
    const from = source.paintTracks[property]?.[0]?.value ?? fallback;
    const base = authored.paintTracks[property]?.[0]?.value ?? fallback;
    state.paintTracks[property] = [
      {
        id: `${layer.id}:${property}:exit`,
        frame: 0,
        value: shader?.discrete ? from : value + (from - base) * remaining,
        easing: 'linear',
      },
    ];
  }
  if (state.modifiers?.length)
    state.modifiers = sampleLayerModifiers(
      { modifiers: state.modifiers },
      (property, value) =>
        value +
        ((modifierParameterValue(source.modifiers ?? [], property) ?? value) -
          (modifierParameterValue(authored.modifiers ?? [], property) ?? value)) *
          remaining,
    );
  return state;
}
