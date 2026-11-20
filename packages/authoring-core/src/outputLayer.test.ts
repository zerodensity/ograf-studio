import { describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { AuthoringSession, RevisionConflictError } from './session';
import type { AuthoringOperation } from './types';

describe('output layer authoring', () => {
  it('uses revision-checked undoable metadata edits and canonical zero', () => {
    const session = new AuthoringSession(createProject());
    const edit = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_project_metadata', outputLayer: -12 }],
    });
    expect(edit.project.outputLayer).toBe(-12);
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [{ type: 'set_project_metadata', outputLayer: 4 }],
      }),
    ).toThrow(RevisionConflictError);
    expect(session.undo(1).project.outputLayer).toBe(0);
    expect(session.redo(2).project.outputLayer).toBe(-12);
    expect(
      session.apply({
        expectedRevision: 3,
        operations: [{ type: 'set_project_metadata', outputLayer: -0 }],
      }).project.outputLayer,
    ).toBe(0);
  });

  it.each([null, '4', 1.5, Infinity, 2 ** 53])(
    'atomically rejects invalid metadata %j',
    (outputLayer) => {
      const session = new AuthoringSession(createProject());
      const before = session.snapshot();
      expect(() =>
        session.apply({
          expectedRevision: 0,
          operations: [
            { type: 'set_project_metadata', name: 'Must not persist' },
            { type: 'set_project_metadata', outputLayer } as AuthoringOperation,
          ],
        }),
      ).toThrow(/safe integer/);
      expect(session.snapshot()).toEqual(before);
    },
  );
});
