import type { Asset, Composition, Element, FieldDefinition, FieldValue, Paint } from './types';
import { isMediaPaint, mediaPaintAssetReferences, normalizeMediaPaint } from './mediaPaint';
import { walkElementContents } from './ticker';
import { isShaderPaint } from './shader';

const ASSET_PREFIX = 'asset:';

export function assetReference(assetId: string): string {
  return `${ASSET_PREFIX}${assetId}`;
}

export function resolveAssetValue(value: string, assets: Asset[]): string {
  if (!value.startsWith(ASSET_PREFIX)) return value;
  const id = value.slice(ASSET_PREFIX.length);
  const asset = assets.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Asset reference points to an unknown asset: ${value}`);
  return asset.dataUri;
}

export function resolveElementAssetReferences(element: Element, assets: Asset[]): Element {
  const resolvePaint = (paint: Paint | undefined): Paint | undefined => {
    if (isShaderPaint(paint) && paint.inputImage)
      return {
        ...paint,
        inputImage: {
          ...paint.inputImage,
          source: resolveAssetValue(paint.inputImage.source, assets),
        },
      };
    if (!isMediaPaint(paint)) return paint;
    const source =
      paint.source.kind === 'clip'
        ? { ...paint.source, src: resolveAssetValue(paint.source.src, assets) }
        : {
            ...paint.source,
            ...(paint.source.fallback
              ? { fallback: resolveAssetValue(paint.source.fallback, assets) }
              : {}),
          };
    return normalizeMediaPaint({ ...paint, source });
  };
  if (element.type === 'ticker')
    return {
      ...element,
      items: element.items.map((item) => ({
        ...item,
        element: resolveElementAssetReferences(item.element, assets) as typeof item.element,
      })),
      ...(element.background ? { background: resolvePaint(element.background)! } : {}),
    };
  if (element.type === 'image') {
    return {
      ...element,
      ...(element.src ? { src: resolveAssetValue(element.src, assets) } : {}),
      ...(element.fill ? { fill: resolvePaint(element.fill) as typeof element.fill } : {}),
    };
  }
  if (element.type === 'audio') {
    return { ...element, ...(element.src ? { src: resolveAssetValue(element.src, assets) } : {}) };
  }
  if (element.type === 'image-sequence') {
    return {
      ...element,
      frames: element.frames.map((frame) => resolveAssetValue(frame, assets)),
      ...(element.fill ? { fill: resolvePaint(element.fill) as typeof element.fill } : {}),
    };
  }
  if ('fill' in element && element.fill)
    return { ...element, fill: resolvePaint(element.fill) as typeof element.fill } as Element;
  return element;
}

export interface AssetConsumers {
  layerIds: string[];
  fieldIds: string[];
  fontLayerIds: string[];
  mediaCueIds: string[];
  backgroundStyleIds?: string[];
  typographyStyleIds?: string[];
  compositionBackground?: boolean;
  componentIds?: string[];
}

/** Finds every direct source-model use before an asset is renamed or removed. */
export function findAssetConsumers(composition: Composition, asset: Asset): AssetConsumers {
  const reference = assetReference(asset.id);
  const layerIds = composition.layers
    .filter(
      (layer) =>
        (layer.element.type === 'image' && layer.element.src === reference) ||
        (layer.element.type === 'audio' && layer.element.src === reference) ||
        (layer.element.type === 'image-sequence' && layer.element.frames.includes(reference)) ||
        elementAssetReferences(layer.element).includes(reference),
    )
    .map((layer) => layer.id);
  const usesReference = (field: FieldDefinition, value: FieldValue): boolean => {
    if ((field.type === 'image-url' || field.type === 'file-path') && value === reference) {
      return true;
    }
    if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, FieldValue>;
      return field.properties.some(
        (property) =>
          record[property.key] !== undefined && usesReference(property, record[property.key]!),
      );
    }
    return (
      field.type === 'array' &&
      Boolean(field.items) &&
      Array.isArray(value) &&
      value.some((item) => usesReference(field.items!, item))
    );
  };
  const fieldIds = composition.dataFields
    .filter((field) => usesReference(field, field.defaultValue))
    .map((field) => field.id);
  const fontLayerIds =
    asset.kind === 'font' && asset.fontFamily
      ? composition.layers
          .filter((layer) =>
            walkElementContents(layer.element).some(
              (element) =>
                element.type === 'text' &&
                element.fontFamily
                  .split(',')
                  .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'))
                  .includes(asset.fontFamily!),
            ),
          )
          .map((layer) => layer.id)
      : [];
  const mediaCueIds = (composition.mediaCues ?? [])
    .filter((cue) =>
      cue.sources.some((source) =>
        source.kind === 'clip' ? source.src === reference : source.fallback === reference,
      ),
    )
    .map((cue) => cue.id);
  const backgroundStyleIds = (composition.designSystem.backgrounds ?? [])
    .filter(
      (style) =>
        isMediaPaint(style.paint) && mediaPaintAssetReferences(style.paint).includes(reference),
    )
    .map((style) => style.id);
  const typographyStyleIds =
    asset.kind === 'font' && asset.fontFamily
      ? (composition.designSystem.typography ?? [])
          .filter((style) =>
            style.properties.fontFamily
              .split(',')
              .some((family) => family.trim().replace(/^['"]|['"]$/g, '') === asset.fontFamily),
          )
          .map((style) => style.id)
      : [];
  const compositionBackground =
    isMediaPaint(composition.backgroundPaint) &&
    mediaPaintAssetReferences(composition.backgroundPaint).includes(reference);
  const componentIds = (composition.components ?? [])
    .filter(
      (definition) =>
        definition.resources?.some((resource) => resource.id === asset.id) ||
        definition.layers.some(
          (layer) =>
            (layer.element.type === 'image' && layer.element.src === reference) ||
            (layer.element.type === 'audio' && layer.element.src === reference) ||
            (layer.element.type === 'image-sequence' && layer.element.frames.includes(reference)) ||
            elementAssetReferences(layer.element).includes(reference) ||
            (asset.kind === 'font' &&
              !!asset.fontFamily &&
              walkElementContents(layer.element).some(
                (element) =>
                  element.type === 'text' &&
                  element.fontFamily
                    .split(',')
                    .some(
                      (family) => family.trim().replace(/^['"]|['"]$/g, '') === asset.fontFamily,
                    ),
              )),
        ) ||
        definition.dataFields.some((field) => usesReference(field, field.defaultValue)),
    )
    .map((definition) => definition.id);
  return {
    layerIds,
    fieldIds,
    fontLayerIds,
    mediaCueIds,
    ...(backgroundStyleIds.length ? { backgroundStyleIds } : {}),
    ...(typographyStyleIds.length ? { typographyStyleIds } : {}),
    ...(compositionBackground ? { compositionBackground: true } : {}),
    ...(componentIds.length ? { componentIds } : {}),
  };
}

export function isSafePackagePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.startsWith('\\') &&
    !path.includes('\\') &&
    !path.split('/').includes('..') &&
    !/^[a-z]:/i.test(path)
  );
}

export function dataUriByteSize(dataUri: string): number {
  const match = /^data:[^;,]+(;base64)?,(.*)$/s.exec(dataUri);
  if (!match) return 0;
  if (match[1]) {
    const payload = match[2]!.replace(/\s/g, '');
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(match[2]!)).byteLength;
  } catch {
    return new TextEncoder().encode(match[2]!).byteLength;
  }
}

export function findMissingAssetReferences(composition: Composition): string[] {
  const ids = new Set(composition.assets.map((asset) => asset.id));
  const missing = new Set<string>();
  const check = (value: string | null | undefined) => {
    if (!value?.startsWith(ASSET_PREFIX)) return;
    const id = value.slice(ASSET_PREFIX.length);
    if (!ids.has(id)) missing.add(value);
  };
  for (const layer of composition.layers) {
    if (layer.element.type === 'image') check(layer.element.src);
    else if (layer.element.type === 'audio') check(layer.element.src);
    else if (layer.element.type === 'image-sequence') layer.element.frames.forEach(check);
    elementAssetReferences(layer.element).forEach(check);
  }
  for (const cue of composition.mediaCues ?? []) {
    for (const source of cue.sources) {
      if (source.kind === 'clip') check(source.src);
      else check(source.fallback);
    }
  }
  for (const field of composition.dataFields) {
    const visit = (node: FieldDefinition, value: FieldValue) => {
      if (node.type === 'image-url' && typeof value === 'string') check(value);
      else if (
        node.type === 'object' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const record = value as Record<string, FieldValue>;
        for (const property of node.properties) {
          if (record[property.key] !== undefined) visit(property, record[property.key]!);
        }
      } else if (node.type === 'array' && node.items && Array.isArray(value)) {
        for (const item of value) visit(node.items, item);
      }
    };
    visit(field, field.defaultValue);
  }
  return [...missing].sort();
}

function mediaPaintAssetReferencesFromElement(element: Element): string[] {
  const fill = 'fill' in element ? element.fill : undefined;
  return isMediaPaint(fill) ? mediaPaintAssetReferences(fill) : [];
}

export function elementAssetReferences(element: Element): string[] {
  return walkElementContents(element).flatMap((entry) => {
    const direct =
      entry.type === 'image' || entry.type === 'audio'
        ? entry.src
          ? [entry.src]
          : []
        : entry.type === 'image-sequence'
          ? entry.frames
          : [];
    const paint =
      entry.type === 'ticker'
        ? entry.background
        : 'fill' in entry
          ? entry.fill
          : entry.type === 'shader'
            ? entry
            : undefined;
    const stroke = entry.type === 'text' ? entry.strokePaint : undefined;
    return [
      ...direct,
      ...mediaPaintAssetReferencesFromElement(entry),
      ...(isMediaPaint(paint) ? mediaPaintAssetReferences(paint) : []),
      ...(isShaderPaint(paint) && paint.inputImage ? [paint.inputImage.source] : []),
      ...(stroke?.inputImage ? [stroke.inputImage.source] : []),
      ...(entry.type === 'ticker'
        ? entry.items.flatMap((item) =>
            (Array.isArray(item.effects?.stack) ? item.effects.stack : []).flatMap((effect) =>
              effect?.shader?.inputImage ? [effect.shader.inputImage.source] : [],
            ),
          )
        : []),
    ];
  });
}
