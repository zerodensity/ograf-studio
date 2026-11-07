import { describe, expect, it } from 'vitest';
import {
  assetReference,
  createAsset,
  createFieldDefinition,
  createImageSequenceElement,
  createLayerOfKind,
  createProject,
  type FieldValue,
} from '@ograf-editor/scene-model';
import {
  buildPreviewDataFromTestValues,
  resolvePreviewDataFormSession,
  resolvePreviewDataRecord,
  resolvePreviewFormValue,
} from './previewData';

describe('preview data', () => {
  it('loads a newly selected template with its own values even when field keys match', () => {
    const previousField = createFieldDefinition('text', {
      key: 'headline',
      defaultValue: 'Previous template default',
    });
    const nextField = createFieldDefinition('text', {
      key: 'headline',
      defaultValue: 'Next template default',
    });
    const previous = resolvePreviewDataFormSession(null, 'template-a', [previousField], {});
    previous.values.headline = 'Previous operator input';
    const nextComposition = createProject().compositions[0]!;
    nextComposition.dataFields = [nextField];

    const next = resolvePreviewDataFormSession(
      previous,
      'template-b',
      nextComposition.dataFields,
      {},
    );

    // This is the first load payload, before any passive reset or delayed update can run.
    expect(resolvePreviewDataRecord(nextComposition, next.values)).toEqual({
      headline: 'Next template default',
    });
  });

  it('preserves operator edits during ordinary renders and rebuilds after schema edits', () => {
    const fields = [createFieldDefinition('text', { key: 'headline', defaultValue: 'Default' })];
    const original = resolvePreviewDataFormSession(null, 'template-a', fields, {});
    original.values.headline = 'Operator input';
    expect(resolvePreviewDataFormSession(original, 'template-a', fields, {})).toBe(original);

    const changedFields = [
      createFieldDefinition('text', { key: 'headline', defaultValue: 'Changed default' }),
    ];
    const changed = resolvePreviewDataFormSession(original, 'template-a', changedFields, {});
    expect(changed.values).toEqual({ headline: 'Changed default' });
  });

  it('separates template instances that share composition and field identities', () => {
    const fields = [createFieldDefinition('text', { key: 'headline', defaultValue: 'Default' })];
    const original = resolvePreviewDataFormSession(null, 'template-a/shared-project', fields, {});
    original.values.headline = 'First instance edit';
    const next = resolvePreviewDataFormSession(original, 'template-b/shared-project', fields, {});
    expect(next.values.headline).toBe('Default');
  });

  it('uses current test values when starting or explicitly resetting a form', () => {
    const boolean = createFieldDefinition('boolean', { key: 'visible', defaultValue: true });
    const count = createFieldDefinition('number', { key: 'count', defaultValue: 7 });
    const text = createFieldDefinition('text', { key: 'headline', defaultValue: 'Default' });
    const fields = [boolean, count, text];
    const testValues = { [boolean.id]: false, [count.id]: 0, [text.id]: '' };
    const form = resolvePreviewDataFormSession(null, 'template-a', fields, testValues);
    expect(form.values).toEqual({ visible: false, count: 0, headline: '' });
    form.values.headline = 'Operator input';
    expect(resolvePreviewDataFormSession(null, 'template-a', fields, testValues).values).toEqual({
      visible: false,
      count: 0,
      headline: '',
    });
  });

  it('normalizes stale Boolean and Select test values before the initial load', () => {
    const visible = createFieldDefinition('boolean', { key: 'visible', defaultValue: true });
    const status = createFieldDefinition('select', {
      key: 'status',
      defaultValue: 'live',
      options: [{ value: 'live', label: 'Live' }],
    });
    const form = resolvePreviewDataFormSession(null, 'template-a', [visible, status], {
      [visible.id]: 'false',
      [status.id]: 'removed-option',
    });
    expect(form.values).toEqual({ visible: false, status: 'live' });
  });

  it('falls back when a persisted test value is not a current Select option', () => {
    const field = createFieldDefinition('select', {
      defaultValue: 'latin',
      options: [
        { value: 'latin', label: 'Latin' },
        { value: 'arabic', label: 'Arabic' },
      ],
    });

    expect(resolvePreviewFormValue(field, 'arabic')).toBe('arabic');
    expect(resolvePreviewFormValue(field, 'old-font-stack')).toBe('latin');
  });

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

  it('fills cleared nested preview leaves before displaying forms or sending runtime data', () => {
    const composition = createProject().compositions[0]!;
    const field = createFieldDefinition('object', {
      key: 'player',
      defaultValue: { name: 'Authored name', score: 1 },
    });
    composition.dataFields.push(field);
    const partial = { score: 9 };
    expect(resolvePreviewFormValue(field, partial)).toEqual({ name: 'Authored name', score: 9 });
    expect(buildPreviewDataFromTestValues(composition, { [field.id]: partial })).toEqual({
      player: { name: 'Authored name', score: 9 },
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

  it('prepares complete ticker feeds with embedded images for independent and coordinated preview', () => {
    const composition = createProject().compositions[0]!;
    const asset = createAsset({
      name: 'Station logo',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,bG9nbw==',
    });
    composition.assets = [asset];
    const feed = [
      { id: 'logo', width: 96, element: { type: 'image', src: assetReference(asset.id) } },
      {
        id: 'sequence',
        width: 120,
        element: createImageSequenceElement({ frames: [assetReference(asset.id)] }),
      },
    ];
    const field = createFieldDefinition('array', {
      key: 'feed',
      defaultValue: JSON.parse(JSON.stringify(feed)) as FieldValue,
    });
    const ticker = createLayerOfKind('ticker');
    ticker.bindings = [{ fieldId: field.id, targetProperty: 'items' }];
    composition.layers = [ticker];
    composition.dataFields = [field];
    const expected = {
      feed: [
        { id: 'logo', width: 96, element: { type: 'image', src: asset.dataUri } },
        {
          id: 'sequence',
          width: 120,
          element: createImageSequenceElement({ frames: [asset.dataUri] }),
        },
      ],
    };
    expect(buildPreviewDataFromTestValues(composition, {})).toEqual(expected);
    expect(resolvePreviewDataRecord(composition, {})).toEqual(expected);
    expect(resolvePreviewDataRecord(composition, { feed: field.defaultValue })).toEqual(expected);
    expect(field.defaultValue).toEqual(feed);
  });

  it('does not copy optional old item settings into inserted feed IDs when initializing a form', () => {
    const composition = createProject().compositions[0]!;
    const old = [
      {
        id: 'removed',
        width: 96,
        height: 96,
        animation: { type: 'fade', durationMs: 500, delayMs: 0 },
        element: { type: 'image', src: 'https://example.test/old.png' },
      },
    ];
    const replacement = [
      {
        id: 'inserted',
        width: 96,
        element: { type: 'image', src: 'https://example.test/new.png' },
      },
    ];
    const field = createFieldDefinition('array', {
      key: 'feed',
      defaultValue: old,
    });
    const ticker = createLayerOfKind('ticker');
    ticker.bindings = [{ fieldId: field.id, targetProperty: 'items' }];
    composition.layers = [ticker];
    composition.dataFields = [field];
    const form = resolvePreviewDataFormSession(
      null,
      'ticker',
      [field],
      {
        [field.id]: replacement,
      },
      composition,
    );
    expect(form.values.feed).toEqual(replacement);
    expect(buildPreviewDataFromTestValues(composition, { [field.id]: replacement })).toEqual({
      feed: replacement,
    });
    expect(resolvePreviewDataRecord(composition, form.values)).toEqual({ feed: replacement });
  });
});
