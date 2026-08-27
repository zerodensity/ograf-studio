import { describe, expect, it } from 'vitest';
import {
  assetReference,
  createAsset,
  createFieldDefinition,
  createProject,
} from '@ograf-editor/scene-model';
import { buildPreviewDataFromTestValues, resolvePreviewDataRecord } from './previewData';

describe('preview data', () => {
  it('uses field defaults while preserving explicit falsey test values', () => {
    const composition = createProject().compositions[0]!;
    const headline = createFieldDefinition('text', { key: 'headline', defaultValue: 'Default' });
    const count = createFieldDefinition('number', { key: 'count', defaultValue: 7 });
    composition.dataFields.push(headline, count);

    expect(buildPreviewDataFromTestValues(composition, { [headline.id]: '' })).toMatchObject({
      headline: '',
      count: 7,
    });
  });

  it('resolves local image assets for both test-value and keyed-form payloads', () => {
    const composition = createProject().compositions[0]!;
    const asset = createAsset({
      name: 'Portrait',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,cG9ydHJhaXQ=',
    });
    const portrait = createFieldDefinition('image-url', {
      key: 'portrait',
      defaultValue: assetReference(asset.id),
    });
    composition.assets.push(asset);
    composition.dataFields.push(portrait);

    expect(buildPreviewDataFromTestValues(composition, {})).toEqual({
      portrait: asset.dataUri,
    });
    expect(resolvePreviewDataRecord(composition, { portrait: assetReference(asset.id) })).toEqual({
      portrait: asset.dataUri,
    });
  });
});
