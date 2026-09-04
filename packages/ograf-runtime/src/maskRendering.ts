import {
  layerMaskSvg,
  patternRows,
  patternRowOffset,
  type Element,
  type MaskRenderLayer,
  type MaskRenderState,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { isRuntimeCollectionLayerActive } from './runtimeCollections';

const mounted = new WeakMap<HTMLElement, { svg: SVGSVGElement; id: string; markup: string }>();
let nextId = 0;
const sourceCache = new WeakMap<HTMLElement, { serialized: string; element: Element }>();

/** Shared by Studio, PNG capture and playout; called after every layer's pose and paint resolve. */
export function applyCompiledMasks(
  descriptor: CompiledGraphicDescriptor,
  elements: Map<string, HTMLElement>,
  states: Map<string, MaskRenderState>,
  data?: Record<string, unknown>,
): void {
  const hasMasks = descriptor.layers.some((layer) => layer.mask);
  const sources = new Map<string, MaskRenderLayer>();
  for (const layer of descriptor.layers) {
    const element = elements.get(layer.id);
    if (element) element.style.visibility = layer.isMaskOnly ? 'hidden' : '';
    if (!hasMasks) continue;
    const host = element?.firstElementChild?.classList.contains('layer-content-host')
      ? (element.firstElementChild as HTMLElement)
      : element;
    const serialized = host?.dataset.ografRenderedElement;
    let resolvedElement = layer.element;
    if (host && serialized) {
      let cached = sourceCache.get(host);
      if (cached?.serialized !== serialized) {
        cached = { serialized, element: JSON.parse(serialized) as Element };
        sourceCache.set(host, cached);
      }
      resolvedElement = cached!.element;
    }
    sources.set(layer.id, {
      ...layer,
      element: resolvedElement,
      isVisible: layer.isVisible && (!data || isRuntimeCollectionLayerActive(layer, data)),
    });
  }
  for (const layer of descriptor.layers) {
    const target = elements.get(layer.id);
    if (!target) continue;
    let entry = mounted.get(target);
    if (!layer.mask) {
      if (entry) {
        target.style.maskImage = '';
        target.style.maskMode = '';
        target.style.maskRepeat = '';
        entry.svg.remove();
        mounted.delete(target);
        delete target.dataset.ografLayerMaskId;
      }
      continue;
    }
    if (!entry) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('data-ograf-runtime-auxiliary', 'true');
      Object.assign(svg.style, {
        position: 'absolute',
        width: '0',
        height: '0',
        pointerEvents: 'none',
      });
      entry = { svg, id: `ograf-layer-mask-${nextId++}`, markup: '' };
      mounted.set(target, entry);
    }
    if (entry.svg.parentNode !== target) target.appendChild(entry.svg);
    target.dataset.ografLayerMaskId = entry.id;
    const geometryStates = new Map(
      [...states].map(([id, state]) => [
        id,
        state.patternFrame === undefined ? state : { ...state, patternFrame: 0 },
      ]),
    );
    const markup = layerMaskSvg(layer.id, sources, geometryStates, entry.id);
    if (markup !== entry.markup) {
      entry.svg.innerHTML = `<defs>${markup}</defs>`;
      entry.markup = markup;
    }
    for (const svg of entry.svg.querySelectorAll<SVGSVGElement>('[data-ograf-pattern-source]')) {
      const sourceId = svg.dataset.ografPatternSource!,
        source = sources.get(sourceId),
        state = states.get(sourceId);
      if (source?.element.type === 'pattern' && source.element.definition && state) {
        for (const row of patternRows(source.element.definition))
          svg
            .querySelector(`[data-ograf-pattern-row="${row.row}"]`)
            ?.setAttribute(
              'x',
              String(patternRowOffset(source.element.definition, row, state.patternFrame ?? 0)),
            );
      }
    }
    target.style.maskImage = `url("#${entry.id}")`;
    target.style.maskMode = layer.mask.inverted ? 'luminance' : 'alpha';
    target.style.maskRepeat = 'no-repeat';
  }
}
