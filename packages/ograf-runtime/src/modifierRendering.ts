import {
  evaluateLayerModifiers,
  evaluateModifierVisibility,
  layerModifierGeometryReferences,
  normalizeClockTimerSettings,
  type Element,
  type LayerModifier,
  type LayerTransform,
  type TextElement,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import type { CompiledLayerVisualState } from './loopRendering';
import { disposeElementContent, renderElementContent, resolveBoundElement } from './renderElement';
import {
  isRuntimeCollectionLayerActive,
  runtimeCollectionItemSelection,
} from './runtimeCollections';
import { visualRuleLayerVisible } from './runtimeVisualRules';
import { clockTimerStateAtTime, resolveClockTimerText } from './clockTimerRuntime';

export interface CompiledModifierContext {
  timestampMs?: number;
  /** Actual clock display for lifecycle/command-driven timers; never read from a previous DOM frame. */
  clockText?: ReadonlyMap<string, TextElement>;
}

export function resolveModifierElement(
  layer: CompiledGraphicDescriptor['layers'][number],
  data: Record<string, unknown>,
  context: CompiledModifierContext = {},
): Element {
  const element = resolveBoundElement(layer, data);
  if (element.type !== 'text' || !element.clock) return element;
  const displayed = context.clockText?.get(layer.id);
  if (displayed) {
    const { clock: _clock, ...text } = element;
    return { ...text, content: displayed.content, runs: displayed.runs };
  }
  return resolveClockTimerText(
    element,
    clockTimerStateAtTime(
      normalizeClockTimerSettings(element.clock),
      Math.max(0, context.timestampMs ?? 0),
    ).valueMs,
  );
}

interface TextMeasurementCache {
  generation: number;
  sizes: Map<string, { width: number; height: number }>;
}
const textMeasurements = new WeakMap<Document, TextMeasurementCache>();
/** Natural dimensions survive the same frame's fit -> flow -> dependency passes, not frame seeks. */
const preLayoutTextSizes = new WeakMap<
  CompiledLayerVisualState,
  { width: number; height: number }
>();

function cacheFor(document: Document): TextMeasurementCache {
  let cache = textMeasurements.get(document);
  if (cache) return cache;
  cache = { generation: 0, sizes: new Map() };
  textMeasurements.set(document, cache);
  const invalidate = () => {
    cache!.generation += 1;
    cache!.sizes.clear();
  };
  document.fonts?.addEventListener('loadingdone', invalidate);
  document.fonts?.addEventListener('loadingerror', invalidate);
  return cache;
}

function measurementElement(element: Extract<Element, { type: 'text' }>) {
  if (element.clock)
    element = resolveClockTimerText(
      element,
      clockTimerStateAtTime(normalizeClockTimerSettings(element.clock), 0).valueMs,
    );
  // Paint, reveal progress, clocks and editor zoom cannot change natural glyph geometry.
  const measured = {
    ...element,
    fill: '#ffffff',
    color: '#ffffff',
    strokeColor: '#ffffff',
    autoFit: 'auto-size' as const,
    overflowPolicy: 'visible' as const,
    textAnimation: { ...element.textAnimation, type: 'none' as const },
  };
  delete measured.strokePaint;
  delete measured.clock;
  return measured;
}

/** Build every missing probe first, then read them together; ordinary frame ticks hit the cache. */
export function primeModifierTextMeasurements(
  document: Document | undefined,
  elements: readonly Element[],
): void {
  if (!document?.body) return;
  const cache = cacheFor(document),
    fragment = document.createDocumentFragment();
  const pending = new Map<string, { host: HTMLElement; content: HTMLElement; stroke: number }>();
  try {
    for (const element of elements) {
      if (element.type !== 'text') continue;
      const measured = measurementElement(element);
      const key = `${cache.generation}:${JSON.stringify(measured)}`;
      if (cache.sizes.has(key) || pending.has(key)) continue;
      const host = document.createElement('div');
      Object.assign(host.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        width: 'max-content',
        height: 'max-content',
        visibility: 'hidden',
        pointerEvents: 'none',
        contain: 'layout style',
      });
      renderElementContent(host, measured);
      const content = host.querySelector<HTMLElement>('[data-ograf-modifier-text]');
      if (!content) {
        disposeElementContent(host);
        continue;
      }
      Object.assign(content.style, {
        display: 'block',
        width: 'max-content',
        height: 'max-content',
        minWidth: '0',
        minHeight: '0',
        maxWidth: 'none',
        maxHeight: 'none',
        whiteSpace: 'pre',
        transform: 'none',
      });
      fragment.appendChild(host);
      pending.set(key, { host, content, stroke: Math.max(0, element.strokeWidth) * 2 });
    }
    if (!pending.size) return;
    document.body.appendChild(fragment);
    for (const [key, { content, stroke }] of pending) {
      const rect = content.getBoundingClientRect();
      const size = {
        width: Math.max(1, rect.width + stroke),
        height: Math.max(1, rect.height + stroke),
      };
      if (Number.isFinite(size.width) && Number.isFinite(size.height)) cache.sizes.set(key, size);
    }
    while (cache.sizes.size > 512) cache.sizes.delete(cache.sizes.keys().next().value!);
  } finally {
    for (const { host } of pending.values()) {
      disposeElementContent(host);
      host.remove();
    }
  }
}

/** Completed, unwrapped glyph bounds, cached by content/style and document-font generation. */
export function measureModifierText(
  document: Document | undefined,
  element: Element,
  _transform: LayerTransform,
): { width: number; height: number } | null {
  if (element.type !== 'text' || !document?.body) return null;
  primeModifierTextMeasurements(document, [element]);
  const cache = cacheFor(document);
  return (
    cache.sizes.get(`${cache.generation}:${JSON.stringify(measurementElement(element))}`) ?? null
  );
}

function modifierInputs(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
  data: Record<string, unknown>,
  context: CompiledModifierContext = {},
) {
  const dataByFieldId: Record<string, unknown> = {};
  let nextField = 0;
  const layers = descriptor.layers.map((layer) => ({
    ...layer,
    parentId: layer.modifierParentId ?? null,
    ...(layer.motionPath
      ? {
          motionPath: {
            ...layer.motionPath,
            progress:
              states.get(layer.id)?.paintTracks.motionPathProgress?.[0]?.value ??
              layer.motionPath.progress,
          },
        }
      : {}),
    modifiers: (states.get(layer.id)?.modifiers ?? layer.modifiers ?? []).map(
      (modifier): LayerModifier => {
        if (modifier.type !== 'hide-empty' || modifier.params.source.kind !== 'field')
          return modifier;
        const source = modifier.params.source;
        const dataKey = descriptor.modifierDataKeys?.[source.fieldId];
        let root =
          dataKey !== undefined && Object.hasOwn(data, dataKey)
            ? data[dataKey]
            : descriptor.modifierDataDefaults?.[source.fieldId];
        if (layer.collectionItem && layer.collectionItem.dataKey === dataKey) {
          const index = runtimeCollectionItemSelection(layer, data)?.index;
          root = index !== undefined && Array.isArray(root) ? root[index] : undefined;
        }
        // Each expanded collection row resolves its own item before evaluating a field path.
        const fieldId = `modifier-field-${nextField++}`;
        dataByFieldId[fieldId] = root;
        return { ...modifier, params: { ...modifier.params, source: { ...source, fieldId } } };
      },
    ),
  }));
  const resolved = new Map(
    descriptor.layers.flatMap((layer) => {
      const state = states.get(layer.id);
      return state
        ? [
            [
              layer.id,
              {
                transform: { ...state.transform },
                element: resolveModifierElement(layer, data, context),
                scale: Math.max(0, state.paintTracks.scale?.[0]?.value ?? 1),
                isVisible:
                  visualRuleLayerVisible(layer, data) &&
                  isRuntimeCollectionLayerActive(layer, data),
              },
            ] as const,
          ]
        : [];
    }),
  );
  return { layers, states: resolved, dataByFieldId };
}

/** Visibility is evaluated before flow; opacity zero remains an occupied layout item. */
export function prepareCompiledModifierVisibility(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
  data: Record<string, unknown>,
  context: CompiledModifierContext = {},
): void {
  if (!descriptor.layers.some((layer) => layer.modifiers?.length)) return;
  const input = modifierInputs(descriptor, states, data, context);
  const visibility = evaluateModifierVisibility(input);
  for (const [id, resolved] of visibility) {
    const state = states.get(id);
    if (state) state.isVisible = resolved;
  }
}

/** Text fitting supplies intrinsic dimensions to flow before siblings and hugged parents are placed. */
export function prepareCompiledModifierTextFits(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
  data: Record<string, unknown> = {},
  elements?: Map<string, HTMLElement>,
  context: CompiledModifierContext = {},
): void {
  if (
    !descriptor.layers.some((layer) =>
      layer.modifiers?.some((modifier) => modifier.enabled && modifier.type === 'max-text-width'),
    )
  )
    return;
  const input = modifierInputs(descriptor, states, data, context);
  const layers = input.layers.map((layer) => ({
    ...layer,
    modifiers: layer.modifiers.filter((modifier) => modifier.type === 'max-text-width'),
  }));
  const document = elements?.values().next().value?.ownerDocument;
  primeModifierTextMeasurements(
    document,
    layers.flatMap((layer) => {
      const resolved = input.states.get(layer.id);
      return resolved && layer.modifiers.some((modifier) => modifier.enabled)
        ? [resolved.element]
        : [];
    }),
  );
  const fitted = evaluateLayerModifiers({
    ...input,
    layers,
    measureText: (id, element, transform) => {
      const state = states.get(id)!;
      const natural = measureModifierText(document, element, transform) ??
        preLayoutTextSizes.get(state) ?? { width: transform.width, height: transform.height };
      preLayoutTextSizes.set(state, natural);
      return natural;
    },
  });
  for (const [id, fit] of fitted.textFits) {
    const state = states.get(id),
      resolved = fitted.states.get(id);
    if (!state || !resolved) continue;
    state.transform.width = resolved.transform.width;
    state.transform.height = resolved.transform.height;
    state.textFit = fit;
  }
}

/** Apply after flow/path poses: every reference reads the current frame, never the previous DOM. */
export function applyCompiledModifiers(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, CompiledLayerVisualState>,
  data: Record<string, unknown> = {},
  elements?: Map<string, HTMLElement>,
  context: CompiledModifierContext = {},
): void {
  if (!descriptor.layers.some((layer) => layer.modifiers?.length || layer.motionPath)) return;
  const input = modifierInputs(descriptor, states, data, context);
  const document = elements?.values().next().value?.ownerDocument;
  const sources = new Set(
    input.layers.flatMap((layer) =>
      layerModifierGeometryReferences(layer).flatMap((reference) =>
        reference.kind === 'layer'
          ? [reference.layerId]
          : input.layers
              .filter((candidate) => candidate.groupId === reference.groupId)
              .map((candidate) => candidate.id),
      ),
    ),
  );
  primeModifierTextMeasurements(
    document,
    input.layers.flatMap((layer) => {
      const state = input.states.get(layer.id);
      return state &&
        (sources.has(layer.id) ||
          layer.modifiers.some(
            (modifier) => modifier.enabled && modifier.type === 'max-text-width',
          ))
        ? [state.element]
        : [];
    }),
  );
  const result = evaluateLayerModifiers({
    ...input,
    measureText: (id: string, element: Element, transform: LayerTransform) =>
      preLayoutTextSizes.get(states.get(id)!) ?? measureModifierText(document, element, transform),
  });
  for (const [id, resolved] of result.states) {
    const state = states.get(id);
    if (!state) continue;
    state.transform = resolved.transform;
    state.isVisible = resolved.isVisible;
    const fit = result.textFits.get(id);
    if (fit) state.textFit = fit;
    else delete state.textFit;
  }
}
