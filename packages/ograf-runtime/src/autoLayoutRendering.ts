import { applyAutoLayoutTransforms, DEFAULT_LAYER_AUTO_LAYOUT } from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import type { CompiledLayerVisualState } from './loopRendering';
import { isRuntimeCollectionLayerActive } from './runtimeCollections';
import { visualRuleLayerVisible } from './runtimeVisualRules';
import {
  measureModifierText,
  prepareCompiledModifierVisibility,
  prepareCompiledModifierTextFits,
  primeModifierTextMeasurements,
  resolveModifierElement,
  type CompiledModifierContext,
} from './modifierRendering';

function naturalTextSize(content: HTMLElement): { width: number; height: number } | null {
  const document = content.ownerDocument;
  if (!document.body) return null;
  const probe = content.cloneNode(true) as HTMLElement;
  Object.assign(probe.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: 'max-content',
    height: 'max-content',
    minWidth: '0',
    maxWidth: 'none',
    minHeight: '0',
    maxHeight: 'none',
    transform: 'none',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  return rect.width > 0 && rect.height > 0
    ? { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
    : null;
}

export function applyCompiledAutoLayout(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
  data: Record<string, unknown> = {},
  elements?: Map<string, HTMLElement>,
  context: CompiledModifierContext = {},
): void {
  prepareCompiledModifierVisibility(descriptor, states, data, context);
  prepareCompiledModifierTextFits(descriptor, states, data, elements, context);
  if (!descriptor.layers.some((layer) => layer.autoLayout && layer.autoLayout.direction !== 'none'))
    return;
  const measured = new Map<string, { width: number; height: number }>();
  for (const [id, state] of states) {
    if (state.textFit)
      measured.set(id, { width: state.transform.width, height: state.transform.height });
  }
  if (elements) {
    const resolvedElements = new Map(
      descriptor.layers.map((layer) => [layer.id, resolveModifierElement(layer, data, context)]),
    );
    primeModifierTextMeasurements(
      elements.values().next().value?.ownerDocument,
      [...resolvedElements.values()].filter(
        (element) => element.type === 'text' && element.autoFit === 'auto-size',
      ),
    );
    for (const layer of descriptor.layers) {
      if (measured.has(layer.id)) continue;
      const resolvedElement = resolvedElements.get(layer.id)!;
      if (resolvedElement.type !== 'text' || resolvedElement.autoFit !== 'auto-size') continue;
      const outer = elements.get(layer.id);
      if (!outer || typeof outer.querySelector !== 'function') continue;
      const state = states.get(layer.id);
      const naturalCached = state
        ? measureModifierText(outer.ownerDocument, resolvedElement, state.transform)
        : null;
      if (naturalCached) {
        measured.set(layer.id, naturalCached);
        continue;
      }
      const host = outer?.querySelector<HTMLElement>('.layer-content-host') ?? outer ?? undefined;
      const content = host
        ? ([...host.children].find(
            (child) => child.getAttribute('data-ograf-runtime-auxiliary') !== 'true',
          ) as HTMLElement | undefined)
        : undefined;
      if (!content) continue;
      const natural = naturalTextSize(content);
      if (!natural) continue;
      const stroke = Math.max(0, resolvedElement.strokeWidth) * 2;
      const width = Math.ceil(natural.width + stroke);
      const height = Math.ceil(natural.height + stroke);
      if (width > 0 && height > 0) measured.set(layer.id, { width, height });
    }
  }
  applyAutoLayoutTransforms(
    descriptor.layers.map((layer) => ({
      id: layer.id,
      parentId: layer.layoutParentId ?? null,
      isVisible:
        states.get(layer.id)?.isVisible ??
        (visualRuleLayerVisible(layer, data) && isRuntimeCollectionLayerActive(layer, data)),
      autoLayout: layer.autoLayout ?? DEFAULT_LAYER_AUTO_LAYOUT,
    })),
    new Map([...states.entries()].map(([id, state]) => [id, state.transform])),
    measured,
  );
}
