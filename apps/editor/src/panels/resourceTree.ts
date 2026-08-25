import type { Asset, Composition } from '@ograf-editor/scene-model';

export interface ResourceAssetsByKind {
  images: Asset[];
  fonts: Asset[];
  sources: Asset[];
}

export function partitionResourceAssets(assets: readonly Asset[]): ResourceAssetsByKind {
  return {
    images: assets.filter((asset) => asset.kind === 'image'),
    fonts: assets.filter((asset) => asset.kind === 'font'),
    sources: assets.filter((asset) => asset.kind === 'source'),
  };
}

export function resourceTreeBranchCounts(composition: Composition) {
  const assets = partitionResourceAssets(composition.assets);
  return {
    brandKit: composition.designSystem.tokens.length,
    components: composition.components.length,
    images: assets.images.length,
    fonts: assets.fonts.length,
    sources: assets.sources.length,
  };
}
