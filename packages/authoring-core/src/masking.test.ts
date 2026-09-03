import { describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { AuthoringSession } from './session';

function setup() {
  const session = new AuthoringSession(createProject(), 'masks');
  const added = session.apply({
    expectedRevision: 0,
    operations: [
      { type: 'add_layer', kind: 'rectangle', name: 'Paint' },
      { type: 'add_layer', kind: 'path', name: 'Glyph' },
    ],
  });
  const [target, source] = added.project.compositions[0]!.layers;
  return { session, target: target!, source: source! };
}
describe('mask authoring', () => {
  it('is atomic and undoable, preserves lifecycle keys, and refuses cycles and dangling sources', () => {
    const { session, target, source } = setup();
    const before = session.snapshot().project;
    const linked = session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'set_layer_mask', layerId: target.id, sourceLayerId: source.id, mode: 'path' },
      ],
    });
    expect(linked.validation.valid).toBe(true);
    expect(linked.project.compositions[0]!.keyframes).toEqual(before.compositions[0]!.keyframes);
    expect(linked.project.compositions[0]!.layers[0]!.animationTracks).toEqual(
      target.animationTracks,
    );
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [{ type: 'set_layer_mask', layerId: source.id, sourceLayerId: target.id }],
      }),
    ).toThrow('cyclic');
    expect(session.revision).toBe(2);
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [{ type: 'remove_layer', layerId: source.id }],
      }),
    ).toThrow('Detach masks');
    expect(session.revision).toBe(2);
    const undone = session.undo(2);
    expect(undone.project.compositions[0]!.layers[0]!.mask).toBeNull();
    expect(undone.project.compositions[0]!.layers[1]!.isMaskOnly).toBe(false);
  });
  it('duplicates references locally and detaches without exposing a source used by other consumers', () => {
    const { session, target, source } = setup();
    session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_layer_mask',
          layerId: target.id,
          sourceLayerId: source.id,
          mode: 'alpha',
          inverted: true,
        },
      ],
    });
    const copied = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'duplicate_group',
          source: { layerIds: [target.id, source.id] },
          count: 1,
          bindings: 'share',
        },
      ],
    });
    const copy = copied.summary.duplicateGroups[0]!.copies[0]!;
    const copiedTarget = copied.project.compositions[0]!.layers.find(
      (l) => l.id === copy.layers[target.id],
    )!;
    expect(copiedTarget.mask).toEqual({
      sourceLayerId: copy.layers[source.id],
      mode: 'alpha',
      inverted: true,
    });
    const detached = session.apply({
      expectedRevision: 3,
      operations: [{ type: 'set_layer_mask', layerId: target.id, sourceLayerId: null }],
    });
    expect(
      detached.project.compositions[0]!.layers.find((l) => l.id === source.id)!.isMaskOnly,
    ).toBe(true);
  });
  it('compiles a source-only matte without dropping its source', () => {
    const { session, target, source } = setup();
    const linked = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'set_layer_mask', layerId: target.id, sourceLayerId: source.id }],
    });
    const c = linked.project.compositions[0]!,
      descriptor = compileDescriptor(c);
    expect(descriptor.layers[1]!.isMaskOnly).toBe(true);
    expect(descriptor.layers[0]!.mask!.sourceLayerId).toBe(descriptor.layers[1]!.id);
  });
});
