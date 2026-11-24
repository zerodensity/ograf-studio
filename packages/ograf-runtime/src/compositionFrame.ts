import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import type { Element } from '@ograf-editor/scene-model';
import { applyCompiledAutoLayout } from './autoLayoutRendering';
import { applyCompiledClipPaths, type CompiledLayerVisualState } from './loopRendering';
import { applyCompiledMasks } from './maskRendering';
import { applyCompiledModifiers, type CompiledModifierContext } from './modifierRendering';
import { applyCompiledMotionPaths } from './motionPathRendering';
import { applyCompiledTextPaths } from './textPathRendering';

/** Resolve geometry and modifier state before a player writes the layer poses. */
export function applyCompositionFrameLayout(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
  data: Record<string, unknown>,
  layerEls: Map<string, HTMLElement>,
  context: CompiledModifierContext,
): void {
  applyCompiledAutoLayout(descriptor, states, data, layerEls, context);
  applyCompiledMotionPaths(descriptor, states);
  applyCompiledModifiers(descriptor, states, data, layerEls, context);
}

/** Draw text paths and compositing constraints once all participating layer poses are present. */
export function finishCompositionFrame(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
  data: Record<string, unknown>,
  layerEls: Map<string, HTMLElement>,
  resolve: (layer: CompiledLayer) => Element,
): void {
  applyCompiledTextPaths(descriptor, states, layerEls, resolve);
  applyCompiledClipPaths(descriptor, layerEls, states);
  applyCompiledMasks(descriptor, layerEls, states, data);
}
