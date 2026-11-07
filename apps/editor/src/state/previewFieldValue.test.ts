import { describe, expect, it } from 'vitest';
import { createFieldDefinition } from '@ograf-editor/scene-model';
import { clearPreviewPath, resolvePreviewFieldValue } from './previewFieldValue';

describe('partial preview field values', () => {
  it('restores only a cleared nested leaf from current defaults, including undo and redo', () => {
    const field = createFieldDefinition('object', {
      defaultValue: { player: { name: 'Designer', score: 1 }, title: 'Default title' },
    });
    const original = {
      player: { name: 'Preview name', score: 7 },
      title: 'Preview title',
    };
    const partial = clearPreviewPath(original, ['player', 'name']);
    expect(original.player.name).toBe('Preview name');
    expect(partial).toEqual({ player: { score: 7 }, title: 'Preview title' });
    expect(resolvePreviewFieldValue(field, partial)).toEqual({
      player: { name: 'Designer', score: 7 },
      title: 'Preview title',
    });

    field.defaultValue = { player: { name: 'Before undo', score: 1 }, title: 'Default title' };
    expect(resolvePreviewFieldValue(field, partial)).toMatchObject({
      player: { name: 'Before undo', score: 7 },
    });
    field.defaultValue = { player: { name: 'Designer', score: 1 }, title: 'Default title' };
    expect(resolvePreviewFieldValue(field, partial)).toMatchObject({
      player: { name: 'Designer', score: 7 },
    });
  });

  it('keeps later collection items and explicit preview array lengths', () => {
    const field = createFieldDefinition('array', {
      defaultValue: [
        { title: 'First default', score: 1 },
        { title: 'Second default', score: 2 },
        { title: 'Third default', score: 3 },
      ],
    });
    const preview = [
      { title: 'First preview', score: 9 },
      { title: 'Second preview', score: 8 },
    ];
    const partial = clearPreviewPath(preview, ['0', 'title']);
    expect(resolvePreviewFieldValue(field, partial)).toEqual([
      { title: 'First default', score: 9 },
      { title: 'Second preview', score: 8 },
    ]);
    expect(resolvePreviewFieldValue(field, [])).toEqual([]);
    expect(resolvePreviewFieldValue(field, [{ score: 4 }])).toEqual([
      { title: 'First default', score: 4 },
    ]);
  });

  it('preserves explicit null and falsey values and does not reinterpret numeric object keys', () => {
    const field = createFieldDefinition('object', {
      defaultValue: { '0': { name: 'Default' }, empty: 'Default', flag: true, count: 5 },
    });
    const preview = { '0': { name: 'Preview' }, empty: '', flag: false, count: 0 };
    expect(resolvePreviewFieldValue(field, preview)).toBe(preview);
    expect(resolvePreviewFieldValue(field, null)).toBeNull();
    expect(resolvePreviewFieldValue(field, clearPreviewPath(preview, ['0', 'name']))).toEqual({
      '0': { name: 'Default' },
      empty: '',
      flag: false,
      count: 0,
    });
    expect(clearPreviewPath(preview, [])).toBeUndefined();
  });

  it('releases a scalar preview ancestor that would hide a designer-edited nested value', () => {
    const field = createFieldDefinition('object', {
      defaultValue: { player: { name: 'Authored name', score: 1 }, title: 'Default title' },
    });
    const partial = clearPreviewPath({ player: null, title: 'Preview title' }, ['player', 'name']);
    expect(resolvePreviewFieldValue(field, partial)).toEqual({
      player: { name: 'Authored name', score: 1 },
      title: 'Preview title',
    });
    expect(clearPreviewPath(null, ['player', 'name'])).toBeUndefined();
  });
});
