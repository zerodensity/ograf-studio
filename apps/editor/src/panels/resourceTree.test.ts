import { describe, expect, it } from 'vitest';
import { createAsset, createComposition } from '@ograf-editor/scene-model';
import { partitionResourceAssets, resourceTreeBranchCounts } from './resourceTree';

describe('Resources tree model', () => {
  it('partitions each asset into one compact tree branch', () => {
    const image = createAsset({ id: 'image', kind: 'image' });
    const media = createAsset({ id: 'media', kind: 'media' });
    const audio = createAsset({ id: 'audio', kind: 'audio' });
    const font = createAsset({ id: 'font', kind: 'font' });
    const source = createAsset({ id: 'source', kind: 'source' });

    expect(partitionResourceAssets([source, audio, media, image, font])).toEqual({
      images: [image],
      media: [media],
      audio: [audio],
      fonts: [font],
      sources: [source],
    });
  });

  it('reports category counts without expanding item editors', () => {
    const composition = createComposition({
      assets: [
        createAsset({ kind: 'image' }),
        createAsset({ kind: 'media' }),
        createAsset({ kind: 'audio' }),
        createAsset({ kind: 'image' }),
        createAsset({ kind: 'font' }),
      ],
      designSystem: {
        name: 'Kit',
        tokens: [
          {
            id: 'token',
            key: 'brand.primary',
            name: 'Primary',
            type: 'color',
            value: '#ffffff',
            description: '',
          },
        ],
      },
    });

    expect(resourceTreeBranchCounts(composition)).toMatchObject({
      brandKit: 1,
      components: 0,
      images: 2,
      media: 1,
      audio: 1,
      fonts: 1,
      sources: 0,
    });
  });
});
