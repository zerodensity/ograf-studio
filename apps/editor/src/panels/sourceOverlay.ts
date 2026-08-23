import {
  assetReference,
  computeKeyframeFrames,
  getLayerTransformAtFrame,
  type Asset,
  type Composition,
} from '@ograf-editor/scene-model';

export interface SourceOverlayGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  transformOriginX: number;
  transformOriginY: number;
  source: 'authored-layer' | 'svg-bundle' | 'intrinsic';
}

function firstStepFrame(composition: Composition): number {
  const frameById = new Map(
    computeKeyframeFrames(composition).map((entry) => [entry.keyframeId, entry.frame]),
  );
  const step = composition.keyframes.find((keyframe) => keyframe.role === 'step');
  return step ? (frameById.get(step.id) ?? 0) : 0;
}

function dataPayload(dataUri: string): string | null {
  const comma = dataUri.indexOf(',');
  if (comma < 0 || !dataUri.slice(0, comma).toLowerCase().startsWith('data:')) return null;
  return dataUri.slice(comma + 1).replace(/\s/g, '');
}

function decodeDataUri(dataUri: string): string | null {
  const match = /^data:[^;,]+(;base64)?,(.*)$/s.exec(dataUri);
  if (!match) return null;
  try {
    if (!match[1]) return decodeURIComponent(match[2] ?? '');
    const binary = atob((match[2] ?? '').replace(/\s/g, ''));
    return new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

function attribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2] ?? null;
}

function numericAttribute(tag: string, name: string): number | null {
  const value = Number.parseFloat(attribute(tag, name) ?? '');
  return Number.isFinite(value) ? value : null;
}

function svgDimensions(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const width = numericAttribute(root, 'width');
  const height = numericAttribute(root, 'height');
  if (width && height && width > 0 && height > 0) return { width, height };
  const viewBox = (attribute(root, 'viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) {
    return { width: viewBox[2]!, height: viewBox[3]! };
  }
  return null;
}

function authoredLayerGeometry(
  composition: Composition,
  asset: Asset,
): SourceOverlayGeometry | null {
  const reference = assetReference(asset.id);
  const layer = composition.layers.find(
    (candidate) => candidate.element.type === 'image' && candidate.element.src === reference,
  );
  if (!layer) return null;
  return {
    ...getLayerTransformAtFrame(layer, firstStepFrame(composition)),
    source: 'authored-layer',
  };
}

interface SvgImageMapping {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

function svgBundleGeometry(
  composition: Composition,
  svg: string,
  dimensions: { width: number; height: number },
): SourceOverlayGeometry | null {
  const frame = firstStepFrame(composition);
  const imageAssets = composition.assets.filter((candidate) => candidate.kind === 'image');
  const mappings: SvgImageMapping[] = [];
  for (const match of svg.matchAll(/<image\b[^>]*>/gi)) {
    const tag = match[0];
    const href = attribute(tag, 'href') ?? attribute(tag, 'xlink:href');
    const payload = href ? dataPayload(href) : null;
    const x = numericAttribute(tag, 'x') ?? 0;
    const y = numericAttribute(tag, 'y') ?? 0;
    const width = numericAttribute(tag, 'width');
    const height = numericAttribute(tag, 'height');
    if (!payload || !width || !height || width <= 0 || height <= 0) continue;
    const embeddedAsset = imageAssets.find(
      (candidate) => dataPayload(candidate.dataUri) === payload,
    );
    if (!embeddedAsset) continue;
    const reference = assetReference(embeddedAsset.id);
    const layer = composition.layers.find(
      (candidate) => candidate.element.type === 'image' && candidate.element.src === reference,
    );
    if (!layer) continue;
    const pose = getLayerTransformAtFrame(layer, frame);
    if (Math.abs(pose.rotation) > 0.001) continue;
    const scaleX = pose.width / width;
    const scaleY = pose.height / height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0)
      continue;
    mappings.push({
      scaleX,
      scaleY,
      offsetX: pose.x - x * scaleX,
      offsetY: pose.y - y * scaleY,
    });
  }
  const first = mappings[0];
  if (!first) return null;
  const tolerance = (first.scaleX + first.scaleY) / 2;
  const coherent = mappings.every(
    (mapping) =>
      Math.abs(mapping.scaleX - mapping.scaleY) <= Math.max(0.01, tolerance * 0.02) &&
      Math.abs(mapping.scaleX - first.scaleX) <= Math.max(0.01, tolerance * 0.02) &&
      Math.abs(mapping.scaleY - first.scaleY) <= Math.max(0.01, tolerance * 0.02) &&
      Math.abs(mapping.offsetX - first.offsetX) <= 2 &&
      Math.abs(mapping.offsetY - first.offsetY) <= 2,
  );
  if (!coherent) return null;
  const scale = (first.scaleX + first.scaleY) / 2;
  return {
    x: first.offsetX,
    y: first.offsetY,
    width: dimensions.width * scale,
    height: dimensions.height * scale,
    rotation: 0,
    transformOriginX: 0,
    transformOriginY: 0,
    source: 'svg-bundle',
  };
}

/** Resolves a source-comparison asset into composition-space bounds without stretching it. */
export function resolveSourceOverlayGeometry(
  composition: Composition,
  asset: Asset,
): SourceOverlayGeometry | null {
  const authored = authoredLayerGeometry(composition, asset);
  if (authored) return authored;
  if (asset.mimeType !== 'image/svg+xml') return null;
  const svg = decodeDataUri(asset.dataUri);
  if (!svg) return null;
  const dimensions = svgDimensions(svg);
  if (!dimensions) return null;
  return (
    svgBundleGeometry(composition, svg, dimensions) ?? {
      x: 0,
      y: 0,
      ...dimensions,
      rotation: 0,
      transformOriginX: 0,
      transformOriginY: 0,
      source: 'intrinsic',
    }
  );
}
