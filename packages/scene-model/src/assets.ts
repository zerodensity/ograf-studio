import type { Asset, Element } from './types';

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
