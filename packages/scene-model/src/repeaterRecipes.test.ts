import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  computeKeyframeFrames,
  defaultTransformForRole,
  materializeRepeater,
} from './index';

describe('semantic repeater recipe', () => {
  it('materializes grouped items with independent data fields and semantic tags', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('text');
    layer.name = 'Day label';
    const frameById = new Map(
      computeKeyframeFrames(composition).map((item) => [item.keyframeId, item.frame]),
    );
    layer.keyframes = composition.keyframes.map((keyframe) =>
      createLayerKeyframe(
        frameById.get(keyframe.id) ?? 0,
        defaultTransformForRole('text', keyframe.role),
      ),
    );
    const field = createFieldDefinition('text', {
      key: 'day',
      label: 'Day',
      defaultValue: 'MON',
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    composition.layers.push(layer);
    composition.dataFields.push(field);

    const result = materializeRepeater(composition, {
      name: 'Forecast days',
      layerIds: [layer.id],
      direction: 'horizontal',
      gap: 20,
      items: [
        { label: 'Monday', data: { day: 'MON' } },
        { label: 'Tuesday', data: { day: 'TUE' } },
        { label: 'Wednesday', data: { day: 'WED' } },
      ],
    });

    expect(result.items).toHaveLength(3);
    expect(composition.layers).toHaveLength(3);
    expect(composition.dataFields.map((candidate) => candidate.defaultValue)).toEqual([
      'MON',
      'TUE',
      'WED',
    ]);
    expect(new Set(composition.dataFields.map((candidate) => candidate.key)).size).toBe(3);
    expect(
      composition.layers.every((candidate) => candidate.semantics.tags.includes('repeater-item')),
    ).toBe(true);
    expect(composition.layers.every((candidate) => candidate.componentLink === null)).toBe(true);
  });
});
