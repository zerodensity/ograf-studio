import { applyMotionBlur, sampleMotionBlur, type MotionBlurSample } from './motionBlurRendering';
import { applyLayerEffectsFilter } from './effectCompositing';
import { resolveLayerBindingTransform } from './runtimeBindings';
import { refreshBackdropClip } from './backdropEffectRendering';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  layerTransformBindingChannel,
  clipPathForParentBounds,
  cubicBezierProgress,
  EFFECT_ANIMATION_PROPERTIES,
  easedProgress,
  getLoopFrameAtElapsed,
  patternLightLoopFrame,
  applyPatternLighting,
  getTrackValueAtFrame,
  effectParameterValue,
  sampleEffectStack,
  isGradientStopOffsetProperty,
  isRevealAnimationProperty,
  revealPropertyDefault,
  parseShaderAnimationProperty,
  shaderAnimationPropertySpec,
  getShaderAnimationValue,
  getShaderTrackValueAtFrame,
  TRANSFORM_ANIMATION_PROPERTIES,
  type AnimatableLayerProperty,
  type LayerAnimationTracks,
  type LayerEffects,
  type LayerTransform,
  type LayerCrop,
  layerCropPolygon,
  sampleLayerModifiers,
  modifierParameterValue,
  valueAtSourcePath,
  type LayerModifier,
  applyLayerRuleGeometry,
} from '@ograf-editor/scene-model';
import { applyModifierTextFit, type ModifierTextFit } from './modifierTextRendering';
import { runtimeCollectionItemSelection } from './runtimeCollections';
import { applyAnimatedPaint, resolveBoundEffects, resolveBoundElement } from './renderElement';
import { renderPatternAtElapsed } from './patternRendering';
import { visualRuleLayerModifiers } from './runtimeVisualRules';
import {
  applyRevealToComposite,
  REVEAL_CHANGED_EVENT,
  type RevealInsets,
} from './revealPresentation';

export interface CompiledLayerVisualState {
  modifiers?: LayerModifier[];
  isVisible?: boolean;
  textFit?: ModifierTextFit;
  crop?: LayerCrop;
  transform: LayerTransform;
  /** Unbound sampled pose retained only for live data overrides during direct lifecycle fades. */
  bindingBaseTransform?: LayerTransform;
  effects: LayerEffects;
  paintTracks: LayerAnimationTracks;
  paintFrame: number;
  patternFrame?: number;
  motionBlur?: MotionBlurSample;
}

/** Resolves a layer loop's active composition-frame window from compiled lifecycle metadata. */
export function compiledLoopElapsedFrames(
  descriptor: CompiledGraphicDescriptor,
  layer: CompiledLayer,
  baseFrame: number,
  heldFrames = 0,
): number | undefined {
  const activation =
    layer.element.type === 'pattern' || layer.lighting
      ? { type: 'lifecycle' as const }
      : layer.loop?.activation;
  if (!activation) return undefined;
  if (activation.type === 'customAction') return undefined;
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
  data: Record<string, unknown> = {},
): CompiledLayerVisualState {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const liveBindings =
    source.bindingBaseTransform !== undefined || target.bindingBaseTransform !== undefined;
  const fromTransform = liveBindings
    ? (source.bindingBaseTransform ?? source.transform)
    : source.transform;
  const toTransform = liveBindings
    ? (target.bindingBaseTransform ?? target.transform)
    : target.transform;
  const transform = { ...fromTransform };
  for (const property of TRANSFORM_ANIMATION_PROPERTIES) {
    const eased = incomingProgress(layer, property, targetFrame, clampedProgress);
    transform[property] = interpolate(fromTransform[property], toTransform[property], eased);
  }
  const bindingBaseTransform = liveBindings ? { ...transform } : undefined;
  if (liveBindings) {
    Object.assign(transform, resolveLayerBindingTransform(layer, data, transform));
    const rules = visualRuleLayerModifiers(layer, data);
    if (rules) {
      Object.assign(transform, applyLayerRuleGeometry(transform, rules));
      transform.x += rules.offsetX;
      transform.y += rules.offsetY;
      transform.rotation += rules.rotation;
      transform.opacity *= rules.opacity;
    }
  }

  let effects = { ...source.effects };
  for (const property of EFFECT_ANIMATION_PROPERTIES) {
    const eased = incomingProgress(layer, property, targetFrame, clampedProgress);
    effects[property] = interpolate(source.effects[property], target.effects[property], eased);
  }

  const paintTracks: LayerAnimationTracks = {};
  effects = sampleEffectStack(effects, (property, from) =>
    interpolate(
      from,
      Number(effectParameterValue(target.effects, property) ?? from),
      incomingProgress(layer, property, targetFrame, clampedProgress),
    ),
  );
  const paintProperties = new Set<AnimatableLayerProperty>([
    ...(Object.keys(source.paintTracks) as AnimatableLayerProperty[]),
    ...(Object.keys(target.paintTracks) as AnimatableLayerProperty[]),
  ]);
  const boundElement = resolveBoundElement(layer, data);
  for (const property of paintProperties) {
    const shader = shaderAnimationPropertySpec(boundElement, property);
    const reveal = isRevealAnimationProperty(property);
    if (!isGradientStopOffsetProperty(property) && property !== 'strokeWidth' && !shader && !reveal)
      continue;
    const fallback = shader
      ? getShaderAnimationValue(boundElement, property)
      : reveal
        ? revealPropertyDefault(property)
        : 0;
    const from = source.paintTracks[property]?.[0]?.value ?? fallback;
    const to = target.paintTracks[property]?.[0]?.value ?? (shader ? fallback : from);
    const eased = incomingProgress(layer, property, targetFrame, clampedProgress);
    paintTracks[property] = [
      {
        id: `${layer.id}:${property}:transition`,
        frame: 0,
        value: shader?.discrete ? (clampedProgress < 1 ? from : to) : interpolate(from, to, eased),
        easing: 'linear',
      },
    ];
  }

  return {
    transform:
      liveBindings && layer.lighting
        ? applyPatternLighting(
            layer.lighting.definition.lighting,
            layer.lighting,
            transform,
            effects,
          ).transform
        : transform,
    ...(bindingBaseTransform ? { bindingBaseTransform } : {}),
    effects,
    ...(layer.modifiers?.length
      ? {
          modifiers: sampleLayerModifiers(
            { ...layer, modifiers: source.modifiers ?? layer.modifiers },
            (property, from) =>
              interpolate(
                from,
                modifierParameterValue(target.modifiers ?? layer.modifiers ?? [], property) ?? from,
                incomingProgress(layer, property, targetFrame, clampedProgress),
              ),
          ),
        }
      : {}),
    paintTracks,
    paintFrame: 0,
    ...(target.motionBlur ? { motionBlur: target.motionBlur } : {}),
    ...(layer.crop ? { crop: layer.crop } : {}),
    ...(layer.element.type === 'pattern'
      ? { patternFrame: (progress < 1 ? source.patternFrame : target.patternFrame) ?? 0 }
      : {}),
  };
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
  data: Record<string, unknown> = {},
  options: { skipRulePose?: boolean } = {},
): CompiledLayerVisualState {
  const initial = firstTransform(layer);
  const transform = Object.fromEntries(
    TRANSFORM_ANIMATION_PROPERTIES.map((property) => [
      property,
      getTrackValueAtFrame(layer.animationTracks[property] ?? [], baseFrame, initial[property]),
    ]),
  ) as unknown as LayerTransform;
  let effects = { ...resolveBoundEffects(layer, data) };
  for (const property of EFFECT_ANIMATION_PROPERTIES) {
    effects[property] = getTrackValueAtFrame(
      layer.animationTracks[property] ?? [],
      baseFrame,
      effects[property],
    );
  }

  const loop = layer.loop;
  const lighting = layer.lighting?.definition.lighting;
  const localFrame =
    loop && loopElapsedFrames !== undefined
      ? lighting?.enabled && layer.lighting
        ? patternLightLoopFrame(loop, lighting, layer.lighting, loopElapsedFrames)
        : getLoopFrameAtElapsed(loop, loopElapsedFrames)
      : undefined;
  if (loop && localFrame !== undefined) {
    for (const property of Object.keys(loop.tracks) as AnimatableLayerProperty[]) {
      const keys = loop.tracks[property] ?? [];
      if (
        keys.length === 0 ||
        isGradientStopOffsetProperty(property) ||
        property === 'strokeWidth' ||
        property === 'motionPathProgress' ||
        parseShaderAnimationProperty(property)
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

  effects = sampleEffectStack(effects, (property, value) => {
    const base = getTrackValueAtFrame(layer.animationTracks[property] ?? [], baseFrame, value);
    const loopKeys = loop?.tracks[property] ?? [];
    return localFrame !== undefined && loopKeys.length
      ? getTrackValueAtFrame(loopKeys, localFrame, base)
      : base;
  });
  effects = resolveBoundEffects(layer, data, effects);
  const paintTracks: LayerAnimationTracks = {};
  const paintProperties = new Set<AnimatableLayerProperty>([
    ...(Object.keys(layer.animationTracks) as AnimatableLayerProperty[]),
    ...(Object.keys(loop?.tracks ?? {}) as AnimatableLayerProperty[]),
  ]);
  const boundElement = resolveBoundElement(layer, data);
  for (const property of paintProperties) {
    const shader = shaderAnimationPropertySpec(boundElement, property);
    if (
      !isGradientStopOffsetProperty(property) &&
      property !== 'strokeWidth' &&
      property !== 'motionPathProgress' &&
      !isRevealAnimationProperty(property) &&
      !shader
    )
      continue;
    const timelineKeys = layer.animationTracks[property] ?? [];
    const loopKeys = loop?.tracks[property] ?? [];
    if (shader) {
      if (!timelineKeys.length && (localFrame === undefined || !loopKeys.length)) continue;
      const baseValue = getShaderTrackValueAtFrame(boundElement, property, timelineKeys, baseFrame);
      const value =
        localFrame !== undefined && loopKeys.length
          ? getShaderTrackValueAtFrame(boundElement, property, loopKeys, localFrame, baseValue)
          : baseValue;
      paintTracks[property] = [
        { id: `${layer.id}:${property}:sample`, frame: 0, value, easing: 'linear' },
      ];
      continue;
    }
    const fallback =
      property === 'strokeWidth' && layer.element.type === 'text'
        ? layer.element.strokeWidth
        : property === 'motionPathProgress'
          ? (layer.motionPath?.progress ?? 0)
          : isRevealAnimationProperty(property)
            ? revealPropertyDefault(property)
            : 0;
    const baseValue = getTrackValueAtFrame(
      layer.animationTracks[property] ?? [],
      baseFrame,
      fallback,
    );
    const value =
      localFrame !== undefined && loopKeys.length > 0
        ? getTrackValueAtFrame(loopKeys, localFrame, baseValue)
        : baseValue;
    paintTracks[property] = [
      { id: `${layer.id}:${property}:sample`, frame: 0, value, easing: 'linear' },
    ];
  }

  const bindingBaseTransform = (layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
    (binding) => layerTransformBindingChannel(binding.targetProperty),
  )
    ? { ...transform }
    : undefined;
  if (bindingBaseTransform)
    Object.assign(transform, resolveLayerBindingTransform(layer, data, transform));
  // Rule offsets sit on top of the data-bound animated pose.
  const modifiers = options.skipRulePose ? null : visualRuleLayerModifiers(layer, data);
  if (modifiers) {
    Object.assign(transform, applyLayerRuleGeometry(transform, modifiers));
    transform.x += modifiers.offsetX;
    transform.y += modifiers.offsetY;
    transform.rotation += modifiers.rotation;
    transform.opacity *= modifiers.opacity;
    if (modifiers.scale !== 1)
      paintTracks.scale = [
        {
          id: `${layer.id}:scale:rule`,
          frame: 0,
          value: (paintTracks.scale?.[0]?.value ?? 1) * modifiers.scale,
          easing: 'linear',
        },
      ];
  }
  const lit = layer.lighting
    ? applyPatternLighting(lighting, layer.lighting, transform, effects)
    : { transform, effects };
  const motionBlur = layer.motionBlur?.enabled
    ? sampleMotionBlur(layer, baseFrame, loopElapsedFrames, initial)
    : undefined;
  return {
    ...lit,
    ...(bindingBaseTransform ? { bindingBaseTransform } : {}),
    ...(layer.modifiers?.length
      ? {
          modifiers: sampleLayerModifiers(layer, (property, fallback) => {
            const base = getTrackValueAtFrame(
              layer.animationTracks[property] ?? [],
              baseFrame,
              fallback,
            );
            const localKeys = loop?.tracks[property] ?? [];
            let value =
              localFrame !== undefined && localKeys.length
                ? getTrackValueAtFrame(localKeys, localFrame, base)
                : base;
            for (const binding of layer.bindings ?? []) {
              if (binding.targetProperty !== property) continue;
              const root = data[binding.dataKey];
              const index = layer.collectionItem
                ? runtimeCollectionItemSelection(layer, data)?.index
                : binding.itemIndex;
              const item =
                index === undefined ? root : Array.isArray(root) ? root[index] : undefined;
              const bound = valueAtSourcePath(item, binding.sourcePath);
              const mapped = binding.valueMap?.[String(bound)] ?? bound;
              if (typeof mapped === 'number' && Number.isFinite(mapped)) value = mapped;
            }
            return value;
          }),
        }
      : {}),
    paintTracks,
    paintFrame: 0,
    ...(layer.crop ? { crop: layer.crop } : {}),
    ...(motionBlur ? { motionBlur } : {}),
    ...(layer.element.type === 'pattern' ? { patternFrame: loopElapsedFrames ?? 0 } : {}),
  };
}

/** `clip-path` for a layer's wipe insets, or '' when nothing is hidden. */
export function revealClipPath(tracks: LayerAnimationTracks): string {
  const inset = (property: 'clipTop' | 'clipRight' | 'clipBottom' | 'clipLeft') =>
    Math.min(1, Math.max(0, tracks[property]?.[0]?.value ?? 0));
  const top = inset('clipTop');
  const right = inset('clipRight');
  const bottom = inset('clipBottom');
  const left = inset('clipLeft');
  if (!top && !right && !bottom && !left) return '';
  return `inset(${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%)`;
}

/**
 * Wipes clip the layer's content child, leaving the host's own clip-path to a clipping parent.
 * Only a host this function clipped is ever cleared, so other clip owners are left alone.
 */
export function applyRevealClip(
  host: HTMLElement,
  tracks: LayerAnimationTracks,
  crop?: LayerCrop,
): void {
  const target = host.firstElementChild as HTMLElement | null;
  const values = ['clipTop', 'clipRight', 'clipBottom', 'clipLeft'].map((property) =>
    Math.min(1, Math.max(0, tracks[property as keyof LayerAnimationTracks]?.[0]?.value ?? 0)),
  ) as RevealInsets;
  const polygon = crop ? layerCropPolygon(crop, values) : undefined;
  const clip = polygon
    ? polygon.length
      ? `polygon(${polygon.map((point) => `${point.x * 100}% ${point.y * 100}%`).join(', ')})`
      : 'inset(0% 100% 0% 0%)'
    : revealClipPath(tracks);
  if (clip && target?.dataset) {
    target.style.clipPath = clip;
    target.dataset.ografRevealClip = 'true';
  } else if (target?.dataset?.ografRevealClip) {
    target.style.clipPath = '';
    delete target.dataset.ografRevealClip;
  }
  const previousCrop = host.dataset?.ografLayerCrop;
  const nextCrop = crop ? JSON.stringify(crop.points) : undefined;
  const previous = host.dataset?.ografRevealInsets;
  const next = values.some((value) => value > 0) ? JSON.stringify(values) : undefined;
  if (host.dataset) {
    if (next) host.dataset.ografRevealInsets = next;
    else delete host.dataset.ografRevealInsets;
    if (nextCrop) host.dataset.ografLayerCrop = nextCrop;
    else delete host.dataset.ografLayerCrop;
  }
  refreshBackdropClip(host);
  for (const output of host.querySelectorAll?.<HTMLCanvasElement>('canvas') ?? []) {
    if (output.dataset.ografShaderEffectOutput === 'true') applyRevealToComposite(host, output);
  }
  if (
    (previous !== next || previousCrop !== nextCrop) &&
    typeof host.dispatchEvent === 'function'
  ) {
    const EventConstructor = host.ownerDocument.defaultView?.Event ?? Event;
    host.dispatchEvent(new EventConstructor(REVEAL_CHANGED_EVENT, { bubbles: true }));
  }
}

/** The editor's transform reader accepts decimal coordinates, including very small samples. */
function cssTransformNumber(value: number): string {
  const source = String(value);
  if (!source.includes('e')) return source;
  const [coefficient, exponent] = source.split('e');
  const sign = coefficient!.startsWith('-') ? '-' : '';
  const unsigned = sign ? coefficient!.slice(1) : coefficient!;
  const point = unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const decimal = (point === -1 ? unsigned.length : point) + Number(exponent);
  if (decimal <= 0) return `${sign}0.${'0'.repeat(-decimal)}${digits}`;
  if (decimal >= digits.length) return `${sign}${digits}${'0'.repeat(decimal - digits.length)}`;
  return `${sign}${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
}

export function applyCompiledLayerVisualState(
  element: HTMLElement,
  state: CompiledLayerVisualState,
  elapsedMs = 0,
): void {
  const { transform } = state;
  const scale = Math.max(0, state.paintTracks.scale?.[0]?.value ?? 1);
  const width = `${transform.width}px`;
  const height = `${transform.height}px`;
  const opacity = String(transform.opacity);
  const origin = `${transform.transformOriginX * 100}% ${transform.transformOriginY * 100}%`;
  const pose = `translate(${cssTransformNumber(transform.x)}px, ${cssTransformNumber(transform.y)}px) rotate(${cssTransformNumber(transform.rotation)}deg) scale(${cssTransformNumber(scale)})`;
  if (element.style.width !== width) element.style.width = width;
  if (element.style.height !== height) element.style.height = height;
  if (element.style.opacity !== opacity) element.style.opacity = opacity;
  if (element.style.transformOrigin !== origin) element.style.transformOrigin = origin;
  if (element.style.transform !== pose) element.style.transform = pose;
  if (state.isVisible !== undefined) element.style.display = state.isVisible ? '' : 'none';
  applyModifierTextFit(element, state.textFit);
  applyRevealClip(element, state.paintTracks, state.crop);
  applyLayerEffectsFilter(element, state.effects, elapsedMs);
  applyMotionBlur(element, state.motionBlur);
  applyAnimatedPaint(element, state.paintTracks, state.paintFrame);
  if (state.patternFrame !== undefined) renderPatternAtElapsed(element, state.patternFrame);
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
