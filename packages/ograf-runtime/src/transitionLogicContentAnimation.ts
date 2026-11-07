import type { CompiledLayer } from '@ograf-editor/ograf-types';
import { layerEffectsToCssFilter } from '@ograf-editor/scene-model';
import { revealClipPath, sampleCompiledLayerVisualState } from './loopRendering';
import type { TransitionLogicLifecyclePose } from './transitionLogicLifecycle';

export interface TransitionLogicContentAnimation {
  layer: CompiledLayer;
  durationFrames: number;
}

/** A plain style pose is reproducible for non-realtime, backward and repeated frame sampling. */
export interface TransitionLogicContentPose {
  opacity: string;
  transform: string;
  transformOrigin: string;
  clipPath: string;
  filter: string;
}

/**
 * Presets are baked on a synthetic full-canvas layer, with In at 0..D and Out at D..2D.
 * Keep the mounted content at its original dimensions: resizing a wrapper must not reflow text,
 * redraw a chart at a different backing size, or replace a playing media element.
 */
export function sampleTransitionLogicContentAnimation(
  animation: TransitionLogicContentAnimation,
  lifecycle: TransitionLogicLifecyclePose,
  frame: number,
  width: number,
  height: number,
): TransitionLogicContentPose {
  const progress =
    lifecycle.durationFrames <= 0
      ? frame < lifecycle.startFrame
        ? 0
        : 1
      : Math.min(1, Math.max(0, (frame - lifecycle.startFrame) / lifecycle.durationFrames));
  const bakedFrame =
    animation.durationFrames *
    (lifecycle.phase === 'out' ? 1 + progress : lifecycle.phase === 'in' ? progress : 1);
  const state = sampleCompiledLayerVisualState(animation.layer, bakedFrame, undefined, {});
  const transform = state.transform;
  const scale = Math.max(0, state.paintTracks.scale?.[0]?.value ?? 1);
  // Width/height keys produced by Grow use their authored origin; convert them to scaling instead.
  const scaleX = width > 0 ? (transform.width / width) * scale : scale;
  const scaleY = height > 0 ? (transform.height / height) * scale : scale;
  const x = transform.x + (transform.width - width) * transform.transformOriginX;
  const y = transform.y + (transform.height - height) * transform.transformOriginY;
  const shown =
    lifecycle.phase === 'in'
      ? frame >= lifecycle.startFrame
      : lifecycle.phase === 'out'
        ? frame < lifecycle.startFrame + lifecycle.durationFrames
        : true;
  return {
    opacity: String(shown ? transform.opacity : 0),
    transform:
      x || y || transform.rotation || scaleX !== 1 || scaleY !== 1
        ? `translate(${x}px, ${y}px) rotate(${transform.rotation}deg) scale(${scaleX}, ${scaleY})`
        : '',
    // A template may crop its host viewport. The baked origin still belongs to the full canvas,
    // not that smaller viewport, so percentages would rotate/scale around the wrong point.
    transformOrigin: `${transform.transformOriginX * width}px ${transform.transformOriginY * height}px`,
    clipPath: revealClipPath(state.paintTracks),
    filter: layerEffectsToCssFilter(state.effects),
  };
}

export function applyTransitionLogicContentPose(
  host: HTMLElement,
  pose: TransitionLogicContentPose,
): void {
  for (const property of ['opacity', 'transform', 'transformOrigin', 'clipPath', 'filter'] as const)
    if (host.style[property] !== pose[property]) host.style[property] = pose[property];
}
