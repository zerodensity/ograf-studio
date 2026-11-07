import {
  cornerRadiiToCss,
  effectEnabled,
  effectParams,
  getEffectStack,
  layerCropPolygon,
  type Element,
  type LayerCrop,
  type LayerEffects,
} from '@ograf-editor/scene-model';

interface StyleValue {
  value: string;
  priority: string;
}

const MASK_PROPERTIES = [
  'mask-image',
  'mask-mode',
  'mask-repeat',
  'mask-size',
  'mask-position',
  '-webkit-mask-composite',
  'mask-composite',
] as const;
type MaskProperty = (typeof MASK_PROPERTIES)[number];
type MaskStyles = Record<MaskProperty, StyleValue>;

interface MountedBackdrop {
  originalRadius: StyleValue;
  originalFilter: StyleValue;
  originalWebkitFilter: StyleValue;
  baseMask: MaskStyles;
  appliedMask?: MaskStyles;
  clipSignature?: string;
  clipImage?: string;
}

const mounted = new WeakMap<HTMLElement, MountedBackdrop>();
const geometry = new WeakMap<HTMLElement, Element>();
const serializedGeometry = new WeakMap<HTMLElement, { source: string; element: Element }>();
const boundaries = new WeakMap<HTMLElement, { original: StyleValue; applied?: string }>();

function readStyle(host: HTMLElement, property: string): StyleValue {
  return {
    value: host.style.getPropertyValue(property),
    priority: host.style.getPropertyPriority(property),
  };
}

function writeStyle(host: HTMLElement, property: string, style: StyleValue): void {
  const current = readStyle(host, property);
  if (current.value === style.value && current.priority === style.priority) return;
  if (style.value) host.style.setProperty(property, style.value, style.priority);
  else host.style.removeProperty(property);
}

function readMask(host: HTMLElement): MaskStyles {
  return Object.fromEntries(
    MASK_PROPERTIES.map((property) => [property, readStyle(host, property)]),
  ) as MaskStyles;
}

function writeMask(host: HTMLElement, styles: MaskStyles): void {
  for (const property of MASK_PROPERTIES) writeStyle(host, property, styles[property]);
}

/** Capture mask-renderer changes without mistaking our own composite settings for authored ones. */
function adoptMaskChanges(host: HTMLElement, entry: MountedBackdrop): void {
  const current = readMask(host);
  for (const property of MASK_PROPERTIES) {
    const applied = entry.appliedMask?.[property];
    if (
      !applied ||
      current[property].value !== applied.value ||
      current[property].priority !== applied.priority
    )
      entry.baseMask[property] = current[property];
  }
}

function renderedElement(host: HTMLElement): Element | undefined {
  const first = host.firstElementChild as HTMLElement | null;
  const content = first?.classList?.contains('layer-content-host') ? first : host;
  const known = geometry.get(content);
  if (known) return known;
  const source = content.dataset?.ografRenderedElement;
  if (!source) return undefined;
  const cached = serializedGeometry.get(content);
  if (cached?.source === source) return cached.element;
  try {
    const element = JSON.parse(source) as Element;
    serializedGeometry.set(content, { source, element });
    return element;
  } catch {
    return undefined;
  }
}

/** Native backdrop pixels use the object's border box and radii, independent of its fill alpha. */
export function backdropBorderRadius(element: Element): string | undefined {
  if (element.type === 'rectangle') return cornerRadiiToCss(element.borderRadius);
  if (element.type === 'ellipse') return '50%';
  return undefined;
}

/** Store resolved geometry as it changes; the effect host can be above Studio's content wrapper. */
export function rememberBackdropElement(container: HTMLElement, element: Element): void {
  geometry.set(container, element);
  const host = mounted.has(container)
    ? container
    : container.classList?.contains('layer-content-host')
      ? container.parentElement
      : null;
  if (!host || !mounted.has(host)) return;
  const radius = backdropBorderRadius(element);
  if (radius === undefined) disposeLayerBackdropFilter(host);
  else host.style.borderRadius = radius;
}

/** A composition containing even a bypassed entry needs a stable boundary for later activation. */
export function compositionHasBackdropBlur(layers: readonly { effects: LayerEffects }[]): boolean {
  return layers.some((layer) =>
    getEffectStack(layer.effects).some((effect) => effect.type === 'backdrop-blur'),
  );
}

/** A native CSS backdrop must never sample the editor checkerboard or an external video surface. */
export function setCompositionBackdropRoot(host: HTMLElement, enabled: boolean): void {
  const entry = boundaries.get(host);
  if (!enabled) {
    if (!entry) return;
    if (entry.applied !== undefined && host.style.filter === entry.applied)
      writeStyle(host, 'filter', entry.original);
    boundaries.delete(host);
    delete host.dataset.ografBackdropRoot;
    return;
  }
  if (!entry) {
    const original = readStyle(host, 'filter');
    if (!original.value || original.value === 'none') {
      host.style.filter = 'opacity(1)';
      boundaries.set(host, { original, applied: host.style.filter });
    } else {
      boundaries.set(host, { original });
    }
  }
  host.dataset.ografBackdropRoot = 'true';
}

/** Intersect the crop/wipe with the alpha/path mask that the shared mask renderer owns. */
export function refreshBackdropClip(host: HTMLElement): void {
  const entry = mounted.get(host);
  if (!entry) return;
  adoptMaskChanges(host, entry);
  const cropSource = host.dataset.ografLayerCrop ?? '';
  const insetSource = host.dataset.ografRevealInsets ?? '';
  const signature = `${cropSource}\n${insetSource}`;
  if (signature !== entry.clipSignature) {
    entry.clipSignature = signature;
    if (!cropSource && !insetSource) delete entry.clipImage;
    else {
      try {
        const crop: LayerCrop = cropSource
          ? { points: JSON.parse(cropSource) }
          : {
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
              ],
            };
        const insets = insetSource ? JSON.parse(insetSource) : [0, 0, 0, 0];
        const points = layerCropPolygon(crop, insets);
        const path = points.length
          ? `<polygon points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="white"/>`
          : '';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1" preserveAspectRatio="none">${path}</svg>`;
        entry.clipImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      } catch {
        // The ordinary reveal renderer owns malformed authoring input; retain its last valid mask.
      }
    }
  }
  if (!entry.clipImage) {
    writeMask(host, entry.baseMask);
    entry.appliedMask = readMask(host);
    return;
  }
  const base = entry.baseMask;
  const hasBase = Boolean(base['mask-image'].value && base['mask-image'].value !== 'none');
  const combine = (value: string, property: MaskProperty, fallback: string) =>
    hasBase ? `${value}, ${base[property].value || fallback}` : value;
  host.style.maskImage = combine(entry.clipImage, 'mask-image', 'none');
  host.style.maskMode = combine('alpha', 'mask-mode', 'match-source');
  host.style.maskRepeat = combine('no-repeat', 'mask-repeat', 'repeat');
  host.style.maskSize = combine('100% 100%', 'mask-size', 'auto');
  host.style.maskPosition = combine('0 0', 'mask-position', '0% 0%');
  host.style.setProperty(
    '-webkit-mask-composite',
    hasBase ? 'source-in, source-over' : 'source-over',
  );
  host.style.setProperty('mask-composite', hasBase ? 'intersect, add' : 'add');
  entry.appliedMask = readMask(host);
}

/** Backdrop passes operate before foreground effects; blend opacity scales each blur's strength. */
export function applyLayerBackdropFilter(host: HTMLElement, effects: LayerEffects): void {
  const filters: string[] = [];
  for (const effect of getEffectStack(effects)) {
    if (
      effect.type !== 'backdrop-blur' ||
      !effectEnabled(effect, effects) ||
      effect.blendOpacity === 0
    )
      continue;
    const radius = Number(effectParams(effect, effects).radius) * (effect.blendOpacity ?? 1);
    if (Number.isFinite(radius) && radius > 0) filters.push(`blur(${radius}px)`);
  }
  const element = renderedElement(host);
  const radius = element && backdropBorderRadius(element);
  if (filters.length === 0 || radius === undefined) {
    disposeLayerBackdropFilter(host);
    return;
  }
  if (!mounted.has(host)) {
    mounted.set(host, {
      originalRadius: readStyle(host, 'border-radius'),
      originalFilter: readStyle(host, 'backdrop-filter'),
      originalWebkitFilter: readStyle(host, '-webkit-backdrop-filter'),
      baseMask: readMask(host),
    });
  }
  host.style.borderRadius = radius;
  const filter = filters.join(' ');
  host.style.setProperty('-webkit-backdrop-filter', filter);
  host.style.backdropFilter = filter;
  host.dataset.ografBackdropFilter = 'true';
  refreshBackdropClip(host);
}

export function disposeLayerBackdropFilter(host: HTMLElement): void {
  const entry = mounted.get(host);
  if (!entry) return;
  adoptMaskChanges(host, entry);
  writeMask(host, entry.baseMask);
  writeStyle(host, 'border-radius', entry.originalRadius);
  writeStyle(host, '-webkit-backdrop-filter', entry.originalWebkitFilter);
  writeStyle(host, 'backdrop-filter', entry.originalFilter);
  mounted.delete(host);
  delete host.dataset.ografBackdropFilter;
}
