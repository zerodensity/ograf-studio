import { describe, expect, it } from 'vitest';
import { createFieldDefinition } from '@ograf-editor/scene-model';
import { parseTransitionPresetValue } from './transitionPresetValue';
describe('structured transition presets', () => {
  it('rejects valid JSON with the wrong declared field type', () => {
    const field = createFieldDefinition('array', {
      key: 'items',
      items: createFieldDefinition('text'),
    });
    expect(() => parseTransitionPresetValue(field, '42')).toThrow();
    expect(parseTransitionPresetValue(field, '["one"]')).toEqual(['one']);
  });
  it('preserves nested schemas and item constraints', () => {
    const item = createFieldDefinition('number', { constraints: { minimum: 0 }, defaultValue: 1 });
    const field = createFieldDefinition('array', { key: 'items', items: item });
    expect(() => parseTransitionPresetValue(field, '[-1]')).toThrow();
    expect(() => parseTransitionPresetValue(field, '[NaN]')).toThrow();
  });
});
