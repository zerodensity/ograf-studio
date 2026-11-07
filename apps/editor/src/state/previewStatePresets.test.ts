import { describe, expect, it } from 'vitest';
import { createAsset, createFieldDefinition, createProject } from '@ograf-editor/scene-model';
import { resolveStatePresetPreviewData } from './previewData';
function fixture() {
  const composition = createProject().compositions[0]!;
  const fields = [
    createFieldDefinition('text', { id: 'label-id', key: 'label', defaultValue: 'SOURCE' }),
    createFieldDefinition('color', { id: 'color-id', key: 'color', defaultValue: '#2676ef' }),
    createFieldDefinition('boolean', { id: 'visible-id', key: 'visible', defaultValue: true }),
    createFieldDefinition('number', { id: 'count-id', key: 'count', defaultValue: 7 }),
  ];
  composition.dataFields = fields;
  return { composition, fields };
}
describe('named-state preview data', () => {
  it('first Take uses state presets over automatically materialized standalone defaults', () => {
    const { composition } = fixture();
    expect(
      resolveStatePresetPreviewData(
        composition,
        { label: 'DEVELOPING', color: '#d49b22', visible: false },
        { label: 'SOURCE', color: '#2676ef', visible: true, count: 7 },
      ),
    ).toEqual({ label: 'DEVELOPING', color: '#d49b22', visible: false, count: 7 });
  });
  it('preserves explicit falsey test values over a preset even when equal to template defaults', () => {
    const { composition } = fixture();
    expect(
      resolveStatePresetPreviewData(
        composition,
        { label: 'DEVELOPING', visible: true, count: 9 },
        {},
        { 'label-id': '', 'visible-id': false, 'count-id': 0 },
      ),
    ).toEqual({ label: '', visible: false, count: 0, color: '#2676ef' });
  });
  it('preserves changed preview form values while a template becomes the context or trigger', () => {
    const { composition } = fixture();
    expect(
      resolveStatePresetPreviewData(
        composition,
        { label: 'DEVELOPING' },
        { label: 'Operator edit' },
      ).label,
    ).toBe('Operator edit');
  });
  it('uses the newer preview form value ahead of stale canvas test data', () => {
    const { composition } = fixture();
    expect(
      resolveStatePresetPreviewData(
        composition,
        { label: 'DEVELOPING' },
        { label: 'Current preview edit' },
        { 'label-id': 'Earlier canvas test' },
      ).label,
    ).toBe('Current preview edit');
  });
  it('preserves legacy precedence without a preset', () => {
    const { composition } = fixture();
    expect(
      resolveStatePresetPreviewData(
        composition,
        undefined,
        { label: 'Current preview edit' },
        { 'label-id': 'Earlier canvas test' },
      ).label,
    ).toBe('Current preview edit');
  });
  it('resolves local image preset values using the selected template assets', () => {
    const { composition } = fixture();
    composition.assets = [
      createAsset({
        id: 'portrait',
        name: 'Portrait',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,YQ==',
      }),
    ];
    composition.dataFields.push(
      createFieldDefinition('image-url', { key: 'portrait', defaultValue: '' }),
    );
    expect(
      resolveStatePresetPreviewData(composition, { portrait: 'asset:portrait' }).portrait,
    ).toBe('data:image/png;base64,YQ==');
  });
});
