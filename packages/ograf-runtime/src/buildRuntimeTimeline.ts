import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { hasTextAnimation } from '@ograf-editor/scene-model';
import { FramePlayer } from './framePlayer';
import { resolveBoundElement } from './renderElement';
import { renderTextAnimationAtFrame } from './textAnimationRendering';
import { renderChartAnimationAtFrame } from './chartRendering';
import { applyCompiledMasks } from './maskRendering';
import {
  sampleCompiledLayerVisualState,
  applyCompiledLayerVisualState,
  applyCompiledClipPaths,
  compiledLoopElapsedFrames,
} from './loopRendering';
import { applyCompiledAutoLayout } from './autoLayoutRendering';
import { applyCompiledMotionPaths } from './motionPathRendering';
import { applyCompiledTextPaths } from './textPathRendering';
import { applyCompiledModifiers, type CompiledModifierContext } from './modifierRendering';

/** Composition-frame keys extend the player; independent local loops retain their own clocks. */
function descriptorDurationFrames(descriptor: CompiledGraphicDescriptor): number {
  let durationFrames = 0;
  for (const keyframe of descriptor.keyframes)
    durationFrames = Math.max(durationFrames, keyframe.frame);
  for (const layer of descriptor.layers) {
    for (const keyframe of layer.keyframes)
      durationFrames = Math.max(durationFrames, keyframe.frame);
    for (const keys of Object.values(layer.animationTracks))
      for (const keyframe of keys ?? []) durationFrames = Math.max(durationFrames, keyframe.frame);
  }
  return durationFrames;
}

/** One deterministic composition-frame renderer shared by Studio and the exported graphic. */
export function buildRuntimeTimeline(
  descriptor: CompiledGraphicDescriptor,
  layerEls: Map<string, HTMLElement>,
  dataProvider: () => Record<string, unknown> = () => ({}),
  modifierContextProvider?: () => CompiledModifierContext,
): FramePlayer {
  const renderFrame = (frame: number): void => {
    const elapsedMs = (frame / descriptor.frameRate) * 1000;
    const data = dataProvider();
    const modifierContext = { timestampMs: elapsedMs, ...modifierContextProvider?.() };
    const states = new Map(
      descriptor.layers.map((layer) => [
        layer.id,
        sampleCompiledLayerVisualState(
          layer,
          frame,
          compiledLoopElapsedFrames(descriptor, layer, frame),
          data,
        ),
      ]),
    );
    applyCompiledAutoLayout(descriptor, states, data, layerEls, modifierContext);
    applyCompiledMotionPaths(descriptor, states);
    applyCompiledModifiers(descriptor, states, data, layerEls, modifierContext);
    for (const layer of descriptor.layers) {
      const element = layerEls.get(layer.id);
      const state = states.get(layer.id);
      if (!element || !state) continue;
      applyCompiledLayerVisualState(element, state, elapsedMs);
      if (layer.element.type === 'chart' || layer.element.type === 'text') {
        const boundElement = resolveBoundElement(layer, data);
        if (boundElement.type === 'chart')
          renderChartAnimationAtFrame(element, boundElement, frame, frame);
        else if (
          boundElement.type === 'text' &&
          !boundElement.clock &&
          hasTextAnimation(boundElement)
        )
          renderTextAnimationAtFrame(element, boundElement, frame);
      }
    }
    applyCompiledTextPaths(descriptor, states, layerEls, (layer) =>
      resolveBoundElement(layer, data),
    );
    applyCompiledClipPaths(descriptor, layerEls, states);
    applyCompiledMasks(descriptor, layerEls, states, data);
  };

  const player = new FramePlayer({
    frameRate: descriptor.frameRate,
    durationFrames: descriptorDurationFrames(descriptor),
    renderFrame,
  });
  player.seek(0);
  return player;
}
