import {
  computeKeyframeFrames,
  createAnimationTracksFromLegacyLayer,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  type Composition,
  type Layer,
} from '@ograf-editor/scene-model';
import { editableSvgLayers } from './editableSvgImport';

/** Safely rasterize only unsupported subtrees, retaining their SVG ancestors and definitions. */
export async function prepareEditableSvg(
  source: string,
  composition: Composition,
): Promise<{ layers: Layer[]; warnings: string[] }> {
  if (source.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error('This SVG is too large or contains a document type declaration.');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || document.querySelector('parsererror'))
    throw new Error('The file is not a well-formed SVG.');
  const hasExternalUrl = (value: string) => {
    for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
      if (!isLocalResource(match[2]!.trim())) return true;
    }
    return false;
  };
  const hasStyleSheet = Boolean(root.querySelector('style'));
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (['script', 'foreignObject'].includes(element.localName))
      throw new Error('SVG scripts and foreign objects cannot be imported safely.');
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name))
        throw new Error('SVG event handlers cannot be imported safely.');
      if (/^(?:href|xlink:href|src)$/i.test(attribute.name) && !isLocalResource(attribute.value))
        throw new Error('SVG external resources must be embedded before import.');
      if (hasExternalUrl(attribute.value))
        throw new Error('SVG external resources must be embedded before import.');
    }
    if (
      element.localName === 'style' &&
      (/@import/i.test(element.textContent ?? '') || hasExternalUrl(element.textContent ?? ''))
    )
      throw new Error('SVG external styles or resources must be embedded before import.');
  }
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    viewBox.some((n) => !Number.isFinite(n)) ||
    viewBox[2]! <= 0 ||
    viewBox[3]! <= 0
  )
    throw new Error('SVG image fallback requires a finite viewBox.');
  const dimension = (name: string, value: number) => {
    const raw = root.getAttribute(name);
    if (!raw) return Math.ceil(value);
    if (!/^\d+(?:\.\d+)?(?:px)?$/i.test(raw))
      throw new Error('SVG image fallback requires numeric viewport dimensions.');
    return Math.ceil(Number.parseFloat(raw));
  };
  const width = dimension('width', viewBox[2]!),
    height = dimension('height', viewBox[3]!);
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 16_777_216)
    throw new Error('SVG is too large for safe raster fallback.');
  const warnings: string[] = [];
  if (root.querySelector('g g'))
    warnings.push(
      'Nested groups were flattened into their outer editable groups; independent inner group boundaries are not retained.',
    );
  const pending = new Map<string, string>();
  const fallback = (node: Element, ancestors: Element[], reason: string): Layer => {
    if (pending.size >= 32 || (pending.size + 1) * width * height > 67_108_864)
      throw new Error('SVG has too many unsupported parts to rasterize safely.');
    const wholeDocument = ancestors.length === 0;
    const copy = root.cloneNode(wholeDocument) as Element;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(width));
    copy.setAttribute('height', String(height));
    if (!wholeDocument) {
      for (const global of Array.from(root.children).filter((item) =>
        ['defs', 'style'].includes(item.localName),
      ))
        copy.appendChild(global.cloneNode(true));
      let parent = copy;
      for (const ancestor of ancestors.slice(1)) {
        const wrapper = ancestor.cloneNode(false) as Element;
        parent.appendChild(wrapper);
        parent = wrapper;
      }
      parent.appendChild(node.cloneNode(true));
    }
    const layer = createLayerOfKind('image');
    layer.name = `${node.getAttribute('id') || node.localName} (image fallback)`;
    if (layer.element.type !== 'image') throw new Error('Could not prepare SVG fallback.');
    pending.set(layer.id, new XMLSerializer().serializeToString(copy));
    layer.keyframes = composition.keyframes.map((_, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]?.frame ?? 0,
        createDefaultTransform({ x: 0, y: 0, width, height }),
      ),
    );
    layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
    warnings.push(`${layer.name}: ${reason}`);
    return layer;
  };
  let layers: Layer[];
  try {
    if (hasStyleSheet) {
      warnings.length = 0;
      layers = [fallback(root, [], 'SVG stylesheets require image fallback.')];
    } else {
      layers = editableSvgLayers(source, composition, fallback);
    }
  } catch (error) {
    pending.clear();
    warnings.length = 0;
    layers = [fallback(root, [], error instanceof Error ? error.message : String(error))];
  }
  for (const layer of layers) {
    const svg = pending.get(layer.id);
    if (!svg || layer.element.type !== 'image') continue;
    layer.element.src = await rasterize(svg, width, height);
  }
  return { layers, warnings };
}

function isLocalResource(value: string): boolean {
  return /^#[\w:.-]+$/.test(value) || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value);
}

function rasterize(svg: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => finish(new Error('SVG image fallback timed out.')), 15000);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
    };
    image.onerror = () => finish(new Error('Could not render an SVG fallback image.'));
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        context.drawImage(image, 0, 0, width, height);
        const png = canvas.toDataURL('image/png');
        finish();
        resolve(png);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
