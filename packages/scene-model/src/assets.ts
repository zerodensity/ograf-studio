import type { Asset, Composition, Element } from './types';

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
  if (element.type === 'image') {
    return element.src ? { ...element, src: resolveAssetValue(element.src, assets) } : element;
  }
  if (element.type === 'image-sequence') {
    return { ...element, frames: element.frames.map((frame) => resolveAssetValue(frame, assets)) };
  }
  return element;
}

export interface AssetConsumers {
  layerIds: string[];
  fieldIds: string[];
  fontLayerIds: string[];
}

/** Finds every direct source-model use before an asset is renamed or removed. */
export function findAssetConsumers(composition: Composition, asset: Asset): AssetConsumers {
  const reference = assetReference(asset.id);
  const layerIds = composition.layers
    .filter(
      (layer) =>
        (layer.element.type === 'image' && layer.element.src === reference) ||
        (layer.element.type === 'image-sequence' && layer.element.frames.includes(reference)),
    )
    .map((layer) => layer.id);
  const fieldIds = composition.dataFields
    .filter(
      (field) =>
        (field.type === 'image-url' || field.type === 'file-path') &&
        field.defaultValue === reference,
    )
    .map((field) => field.id);
  const fontLayerIds =
    asset.kind === 'font' && asset.fontFamily
      ? composition.layers
          .filter(
            (layer) =>
              layer.element.type === 'text' &&
              layer.element.fontFamily
                .split(',')
                .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'))
                .includes(asset.fontFamily!),
          )
          .map((layer) => layer.id)
      : [];
  return { layerIds, fieldIds, fontLayerIds };
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
    else if (layer.element.type === 'image-sequence') layer.element.frames.forEach(check);
  }
  for (const field of composition.dataFields) {
    if (field.type === 'image-url' && typeof field.defaultValue === 'string') {
      check(field.defaultValue);
    }
  }
  return [...missing].sort();
}
