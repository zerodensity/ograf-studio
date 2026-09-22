import {
  effectStackNeedsCompositing,
  effectStackPadding,
  effectStackToSvg,
  layerEffectsToCssFilter,
  type LayerEffects,
} from '@ograf-editor/scene-model';

const mounted = new WeakMap<
  HTMLElement,
  { svg: SVGSVGElement; filter: SVGFilterElement; signature: string }
>();
let nextFilter = 0;

/** Definitions live with their layer, including inside the exported graphic's shadow root. */
export function applyLayerEffectsFilter(host: HTMLElement, effects: LayerEffects): void {
  let entry = mounted.get(host);
  if (!effectStackNeedsCompositing(effects)) {
    entry?.svg.remove();
    mounted.delete(host);
    host.style.filter = layerEffectsToCssFilter(effects);
    return;
  }
  if (!entry) {
    const doc = host.ownerDocument;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.dataset.ografEffectFilter = 'true';
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden' });
    const filter = doc.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id = `ograf-fx-${nextFilter++}`;
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    svg.appendChild(filter);
    host.appendChild(svg);
    entry = { svg, filter, signature: '' };
    mounted.set(host, entry);
  }
  if (entry.svg.parentNode !== host) host.appendChild(entry.svg);
  const signature = JSON.stringify(effects);
  if (signature !== entry.signature) {
    entry.filter.innerHTML = effectStackToSvg(effects);
    entry.signature = signature;
  }
  const pad = effectStackPadding(effects);
  const width = Number.parseFloat(host.style.width) || host.clientWidth || 1;
  const height = Number.parseFloat(host.style.height) || host.clientHeight || 1;
  entry.filter.setAttribute('x', String(-pad));
  entry.filter.setAttribute('y', String(-pad));
  entry.filter.setAttribute('width', String(width + 2 * pad));
  entry.filter.setAttribute('height', String(height + 2 * pad));
  host.style.filter = `url("#${entry.filter.id}")`;
}
