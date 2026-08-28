import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { GraphicElement } from './GraphicElement';

export { GraphicElement } from './GraphicElement';
export { buildRuntimeTimeline } from './buildRuntimeTimeline';
export {
  applyAnimatedPaint,
  disposeElementContent,
  renderElementContent,
  renderAnimatedElementAtTime,
  resolveBoundElement,
} from './renderElement';
export { easingForGsap } from './easing';
export {
  applyCompiledClipPaths,
  applyCompiledLayerVisualState,
  compiledLoopElapsedFrames,
  sampleCompiledLayerVisualState,
  type CompiledLayerVisualState,
} from './loopRendering';
export { expandRuntimeCollections, isRuntimeCollectionLayerActive } from './runtimeCollections';
export { resolvePlayTarget, type LifecycleTarget } from './lifecycle';

/** A concrete (non-abstract), constructible GraphicElement subclass — `typeof GraphicElement`
 * itself is an abstract-constructor type and can't be passed to `customElements.define`. */
type ConcreteGraphicElement = CustomElementConstructor & (new () => GraphicElement);

/** A concrete, instantiable GraphicElement bound to one descriptor — see GraphicElement's own doc comment. */
export function createGraphicClass(descriptor: CompiledGraphicDescriptor): ConcreteGraphicElement {
  return class extends GraphicElement {
    static override descriptor = descriptor;
  };
}

let registrationCounter = 0;

/**
 * Registers a fresh Custom Element tag for this descriptor and returns the tag name — used by the
 * live preview harness, which needs a new tag every recompile (`customElements.define` can't be
 * called twice for the same name, and there's no way to update an already-defined element's class).
 */
export function registerGraphicElement(descriptor: CompiledGraphicDescriptor): string {
  let tagName: string;
  do {
    tagName = `ograf-preview-graphic-${registrationCounter++}`;
  } while (customElements.get(tagName));
  customElements.define(tagName, createGraphicClass(descriptor));
  return tagName;
}
