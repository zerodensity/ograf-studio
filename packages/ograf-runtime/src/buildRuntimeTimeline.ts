import gsap from 'gsap';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import {
  clipPathForParentBounds,
  EFFECT_ANIMATION_PROPERTIES,
  getTrackValueAtFrame,
  parseEffectProperty,
  isGradientStopOffsetProperty,
  layerEffectsToCssFilter,
  TRANSFORM_ANIMATION_PROPERTIES,
  type AnimatableLayerProperty,
  type LayerEffects,
  type LayerTransform,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import { easingForGsap } from './easing';
import { applyAnimatedPaint, resolveBoundEffects } from './renderElement';
import { applyCompiledMasks } from './maskRendering';
import { sampleCompiledLayerVisualState, applyCompiledLayerVisualState } from './loopRendering';
import { compiledLoopElapsedFrames } from './loopRendering';
import { renderPatternAtElapsed } from './patternRendering';

const DIRECT_GSAP_PROPERTIES: Partial<Record<keyof LayerTransform, string>> = {
  x: 'x',
  y: 'y',
  width: 'width',
  height: 'height',
  rotation: 'rotation',
  opacity: 'opacity',
};

function compiledPoseAtFrame(layer: CompiledLayer, frame: number): LayerTransform {
  const first = [...layer.keyframes].sort((a, b) => a.frame - b.frame)[0]?.transform;
  if (!first) throw new Error(`Compiled layer "${layer.id}" has no transform key.`);
  return Object.fromEntries(
    TRANSFORM_ANIMATION_PROPERTIES.map((property) => [
      property,
      getTrackValueAtFrame(layer.animationTracks[property] ?? [], frame, first[property]),
    ]),
  ) as unknown as LayerTransform;
}

/**
 * Builds one paused GSAP timeline spanning every keyframe in sequence, from an already-compiled
 * descriptor (frame positions precomputed — this never re-derives them, unlike the editor's own
 * apps/editor/src/canvas/masterTimeline.ts, which builds the analogous authoring-time timeline
 * directly from Composition data). Layers are first snapped to Keyframe 0's pose via `gsap.set`
 * so the first tween in the chain has a correct "from" value.
 */
export function buildRuntimeTimeline(
  descriptor: CompiledGraphicDescriptor,
  layerEls: Map<string, HTMLElement>,
  dataProvider: () => Record<string, unknown> = () => ({}),
): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });
  const frameRate = descriptor.frameRate;
  const applyInitialStates: Array<() => void> = [];

  for (const keyframe of descriptor.keyframes) {
    tl.addLabel(keyframe.id, keyframe.frame / frameRate);
  }

  for (const layer of descriptor.layers) {
    const el = layerEls.get(layer.id);
    if (!el) continue;
    const tracks = layer.animationTracks;
    const firstTransform = Object.fromEntries(
      TRANSFORM_ANIMATION_PROPERTIES.map((property) => [
        property,
        [...(tracks[property] ?? [])].sort((a, b) => a.frame - b.frame)[0]?.value ??
          [...layer.keyframes].sort((a, b) => a.frame - b.frame)[0]?.transform[property] ??
          0,
      ]),
    ) as unknown as LayerTransform;
    const originState = {
      transformOriginX: firstTransform.transformOriginX,
      transformOriginY: firstTransform.transformOriginY,
    };
    const effectState = { ...layer.effects };
    for (const property of EFFECT_ANIMATION_PROPERTIES) {
      const first = [...(tracks[property] ?? [])].sort((a, b) => a.frame - b.frame)[0];
      if (first) effectState[property] = first.value;
    }
    const firstEffects = { ...effectState };

    const updateOrigin = () => {
      el.style.transformOrigin = `${originState.transformOriginX * 100}% ${originState.transformOriginY * 100}%`;
    };
    const updateEffects = () => {
      el.style.filter = layerEffectsToCssFilter(
        resolveBoundEffects(layer, dataProvider(), effectState),
      );
    };
    const applyInitialState = () => {
      originState.transformOriginX = firstTransform.transformOriginX;
      originState.transformOriginY = firstTransform.transformOriginY;
      Object.assign(effectState, firstEffects);
      gsap.set(el, {
        x: firstTransform.x,
        y: firstTransform.y,
        width: firstTransform.width,
        height: firstTransform.height,
        rotation: firstTransform.rotation,
        opacity: firstTransform.opacity,
        transformOrigin: `${firstTransform.transformOriginX * 100}% ${firstTransform.transformOriginY * 100}%`,
      });
      updateEffects();
    };
    applyInitialStates.push(applyInitialState);
    applyInitialState();

    for (const property of Object.keys(tracks) as AnimatableLayerProperty[]) {
      if (
        isGradientStopOffsetProperty(property) ||
        property === 'strokeWidth' ||
        parseEffectProperty(property)
      )
        continue;
      const keyframes = [...(tracks[property] ?? [])].sort((a, b) => a.frame - b.frame);
      for (let index = 1; index < keyframes.length; index++) {
        const from = keyframes[index - 1]!;
        const to = keyframes[index]!;
        const common = {
          duration: (to.frame - from.frame) / frameRate,
          ease: easingForGsap(to.easing, to.curve),
        };
        const directProperty = DIRECT_GSAP_PROPERTIES[property as keyof LayerTransform];
        if (directProperty) {
          tl.to(el, { [directProperty]: to.value, ...common }, from.frame / frameRate);
        } else if (property === 'transformOriginX' || property === 'transformOriginY') {
          tl.to(
            originState,
            { [property]: to.value, ...common, onUpdate: updateOrigin },
            from.frame / frameRate,
          );
        } else {
          tl.to(
            effectState,
            {
              [property]: to.value,
              ...common,
              onUpdate: updateEffects,
            } as gsap.TweenVars & Partial<LayerEffects>,
            from.frame / frameRate,
          );
        }
      }
    }
  }

  // A lifecycle boundary may extend beyond every layer's last animation key.
  const endFrame = descriptor.keyframes.at(-1)?.frame ?? 0;
  const updateDynamicRendering = () => {
    const frame = tl.time() * frameRate;
    for (const layer of descriptor.layers) {
      const child = layerEls.get(layer.id);
      if (child && layer.effects.stack?.some((e) => !e.legacy))
        child.style.filter = layerEffectsToCssFilter(
          sampleCompiledLayerVisualState(layer, frame, undefined, dataProvider()).effects,
        );
      if (child) applyAnimatedPaint(child, layer.animationTracks, frame);
      if (child && layer.element.type === 'pattern')
        renderPatternAtElapsed(child, compiledLoopElapsedFrames(descriptor, layer, frame) ?? 0);
      if (child && layer.lighting)
        applyCompiledLayerVisualState(
          child,
          sampleCompiledLayerVisualState(
            layer,
            frame,
            compiledLoopElapsedFrames(descriptor, layer, frame),
            dataProvider(),
          ),
        );
      if (!layer.clipParentId) continue;
      const parent = layerEls.get(layer.clipParentId);
      if (!child || !parent) {
        if (child) child.style.clipPath = 'inset(50%)';
        continue;
      }
      const parentLayer = descriptor.layers.find(
        (candidate) => candidate.id === layer.clipParentId,
      );
      const radius =
        parentLayer?.element.type === 'rectangle' ? parentLayer.element.borderRadius : 0;
      if (parentLayer) {
        child.style.clipPath = clipPathForParentBounds(
          layer.lighting
            ? sampleCompiledLayerVisualState(
                layer,
                frame,
                compiledLoopElapsedFrames(descriptor, layer, frame),
              ).transform
            : compiledPoseAtFrame(layer, frame),
          parentLayer.lighting
            ? sampleCompiledLayerVisualState(
                parentLayer,
                frame,
                compiledLoopElapsedFrames(descriptor, parentLayer, frame),
              ).transform
            : compiledPoseAtFrame(parentLayer, frame),
          radius,
        );
      }
    }
    applyCompiledMasks(
      descriptor,
      layerEls,
      new Map(
        descriptor.layers.map((layer) => [
          layer.id,
          sampleCompiledLayerVisualState(
            layer,
            frame,
            compiledLoopElapsedFrames(descriptor, layer, frame),
            dataProvider(),
          ),
        ]),
      ),
    );
  };
  const hasDynamicRendering = descriptor.layers.some(
    (layer) =>
      layer.clipParentId ||
      layer.mask ||
      layer.element.type === 'pattern' ||
      layer.lighting ||
      layer.effects.stack?.some((e) => !e.legacy) ||
      layer.isMaskOnly ||
      Object.keys(layer.animationTracks).some(
        (property) => isGradientStopOffsetProperty(property) || property === 'strokeWidth',
      ),
  );
  if (hasDynamicRendering) {
    const clipClock = { progress: 0 };
    tl.to(
      clipClock,
      {
        progress: 1,
        duration: endFrame / frameRate,
        ease: 'none',
        onUpdate: updateDynamicRendering,
      },
      0,
    );
    updateDynamicRendering();
  }
  tl.to({}, { duration: 0 }, endFrame / frameRate);

  // GSAP's CSSPlugin retains the destination style when a timeline that has already advanced is
  // sought back to the exact zero boundary. Reassert the authored first pose after such seeks;
  // otherwise a transparent Start frame can remain visibly stuck at the on-air Step pose until an
  // unrelated React render touches the element. Keeping this at the shared runtime boundary also
  // makes editor stop/scrub and exported non-realtime goToTime(0) agree.
  const nativeSeek = tl.seek.bind(tl);
  tl.seek = ((position: gsap.Position, suppressEvents?: boolean) => {
    const result = nativeSeek(position, suppressEvents);
    if (tl.time() === 0) {
      for (const applyInitialState of applyInitialStates) applyInitialState();
    }
    updateDynamicRendering();
    return result;
  }) as typeof tl.seek;

  return tl;
}
