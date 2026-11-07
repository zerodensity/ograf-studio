import { describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

describe('native geometry binding authoring', () => {
  it('accepts nested numeric paths and rejects invalid defaults atomically', () => {
    const session = new AuthoringSession(createProject(), 'geometry');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'Actor' },
        {
          type: 'add_data_field',
          fieldType: 'object',
          key: 'actor',
          properties: [
            { key: 'x', fieldType: 'number', defaultValue: 10 },
            { key: 'width', fieldType: 'number', defaultValue: -1 },
          ],
          defaultValue: { x: 10, width: -1 },
        },
      ],
    });
    const composition = created.project.compositions[0]!;
    const layerId = composition.layers[0]!.id,
      fieldId = composition.dataFields[0]!.id;
    const valid = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_layer_bindings',
          layerId,
          bindings: [{ fieldId, sourcePath: ['x'], targetProperty: 'layer.x' }],
        },
      ],
    });
    expect(valid.validation.errors).toEqual([]);
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [
          {
            type: 'set_layer_bindings',
            layerId,
            bindings: [{ fieldId, sourcePath: ['width'], targetProperty: 'layer.width' }],
          },
        ],
      }),
    ).toThrow(/zero or greater/);
    expect(session.revision).toBe(2);
    expect(session.snapshot().project.compositions[0]!.layers[0]!.bindings[0]!.targetProperty).toBe(
      'layer.x',
    );
    const beforeKeys = structuredClone(
      session.snapshot().project.compositions[0]!.layers[0]!.keyframes,
    );
    const edited = session.apply({
      expectedRevision: 2,
      operations: [
        { type: 'update_transform', layerId, scope: 'frame', frame: 5, patch: { x: 55 } },
      ],
    });
    expect(edited.project.compositions[0]!.dataFields[0]!.defaultValue).toEqual({
      x: 55,
      width: -1,
    });
    expect(edited.project.compositions[0]!.layers[0]!.keyframes).toEqual(beforeKeys);
    expect(edited.project.compositions[0]!.layers[0]!.bindings[0]!.targetProperty).toBe('layer.x');
  });
});
