import { describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

describe('Nodos field metadata through authoring operations', () => {
  it('preserves top-level and nested engine types and clears only explicit type assignments', () => {
    const session = new AuthoringSession(createProject(), 'nodos-fields');
    session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_data_field',
          fieldType: 'object',
          key: 'position',
          nodosType: 'test.Position',
          properties: [
            { key: 'x', fieldType: 'number', defaultValue: 1 },
            {
              key: 'mode',
              fieldType: 'select',
              nodosType: 'test.Mode',
              options: [{ value: 'ON', label: 'On' }],
              defaultValue: 'ON',
            },
          ],
          defaultValue: { x: 1, mode: 'ON' },
        },
      ],
    });
    const field = session.snapshot().project.compositions[0]!.dataFields[0]!;
    expect(field.nodosType).toBe('test.Position');
    expect(field.properties[1]!.nodosType).toBe('test.Mode');
    session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_data_field',
          fieldId: field.id,
          label: 'Live position',
          defaultValue: { x: 2, mode: 'ON' },
        },
      ],
    });
    expect(session.snapshot().project.compositions[0]!.dataFields[0]!.nodosType).toBe(
      'test.Position',
    );
    session.apply({
      expectedRevision: 2,
      operations: [{ type: 'update_data_field', fieldId: field.id, nodosType: null }],
    });
    const cleared = session.snapshot().project.compositions[0]!.dataFields[0]!;
    expect(cleared).not.toHaveProperty('nodosType');
    expect(cleared.defaultValue).toEqual({ x: 2, mode: 'ON' });
    expect(cleared.properties[1]!.nodosType).toBe('test.Mode');
    session.apply({
      expectedRevision: 3,
      operations: [{ type: 'update_data_field', fieldId: field.id, nodosType: 'test.Position' }],
    });
    session.apply({
      expectedRevision: 4,
      operations: [
        { type: 'update_data_field', fieldId: field.id, fieldType: 'text', defaultValue: 'plain' },
      ],
    });
    expect(session.snapshot().project.compositions[0]!.dataFields[0]!).not.toHaveProperty(
      'nodosType',
    );
  });

  it('reports invalid stored type names during a non-mutating preview', () => {
    const session = new AuthoringSession(createProject(), 'invalid-nodos-field');
    for (const nodosType of ['', '../native', 'array[type]', 'a'.repeat(257)]) {
      const result = session.apply({
        expectedRevision: 0,
        dryRun: true,
        operations: [{ type: 'add_data_field', fieldType: 'text', key: 'value', nodosType }],
      });
      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors.join(' ')).toContain('nodosType');
      expect(session.revision).toBe(0);
      expect(session.snapshot().project.compositions[0]!.dataFields).toHaveLength(0);
    }
  });
});
