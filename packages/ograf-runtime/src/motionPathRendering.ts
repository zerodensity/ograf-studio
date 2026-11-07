import { attachTransformToMotionPath } from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import type { CompiledLayerVisualState } from './loopRendering';

export function applyCompiledMotionPaths(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
): void {
  for (const layer of descriptor.layers) {
    const link = layer.motionPath;
    if (!link) continue;
    const source = descriptor.layers.find((candidate) => candidate.id === link.sourceLayerId);
    const sourceState = states.get(link.sourceLayerId);
    const targetState = states.get(layer.id);
    if (!source || source.element.type !== 'path' || !sourceState || !targetState) continue;
    const progress = targetState.paintTracks.motionPathProgress?.[0]?.value ?? link.progress;
    targetState.transform = attachTransformToMotionPath(
      targetState.transform,
      sourceState.transform,
      source.element,
      link,
      progress,
    );
  }
}
