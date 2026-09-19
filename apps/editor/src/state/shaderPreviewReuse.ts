import {
  inspectShaderElement,
  getElementShaderPaint,
  getElementShaderPaints,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';

/** A parameter data update can retain an on-air instance; other authoring edits still rebuild it. */
export function canReusePreviewForShaderParameters(
  previous: CompiledGraphicDescriptor,
  next: CompiledGraphicDescriptor,
): boolean {
  if (previous === next) return true;
  let changedParameters = false;
  const stripBoundParameters = (layer: CompiledLayer, previousLayer?: CompiledLayer) => {
    let element = layer.element;
    for (const { slot, paint } of getElementShaderPaints(layer.element)) {
      const previousPaint = previousLayer
        ? getElementShaderPaint(previousLayer.element, slot)
        : undefined;
      if (!inspectShaderElement(paint).valid) continue;
      const parameters = { ...(paint.parameters ?? {}) };
      const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
      for (const binding of bindings) {
        if (binding.sourcePath?.length || binding.itemIndex !== undefined || binding.valueMap)
          continue;
        const prefix =
          slot === 'stroke'
            ? 'strokePaint.parameters.'
            : binding.targetProperty.startsWith('fill.parameters.')
              ? 'fill.parameters.'
              : 'parameters.';
        if (!binding.targetProperty.startsWith(prefix)) continue;
        const name = binding.targetProperty.slice(prefix.length);
        if (
          previousPaint &&
          JSON.stringify(previousPaint.parameters?.[name]) !== JSON.stringify(parameters[name])
        ) {
          changedParameters = true;
        }
        delete parameters[name];
      }
      element =
        layer.element.type === 'shader'
          ? ({ ...element, parameters } as typeof element)
          : { ...element, [slot === 'stroke' ? 'strokePaint' : 'fill']: { ...paint, parameters } };
    }
    return { ...layer, element };
  };
  const previousStructure = {
    ...previous,
    layers: previous.layers.map((layer) => stripBoundParameters(layer)),
  };
  const nextStructure = {
    ...next,
    layers: next.layers.map((layer) =>
      stripBoundParameters(
        layer,
        previous.layers.find((candidate) => candidate.id === layer.id),
      ),
    ),
  };
  return changedParameters && JSON.stringify(previousStructure) === JSON.stringify(nextStructure);
}
