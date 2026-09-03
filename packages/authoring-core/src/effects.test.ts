import { expect, it } from 'vitest';
import { createProject, effectProperty } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

it('owns effect instances in atomic undoable edits without touching other property tracks', () => {
  const session = new AuthoringSession(createProject());
  const first = session.apply({
    expectedRevision: 0,
    operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Tile' }],
  });
  const layer = first.project.compositions[0]!.layers[0]!;
  const added = session.apply({
    expectedRevision: 1,
    operations: [
      {
        type: 'add_effect',
        layerId: layer.id,
        effectType: 'glow',
        patch: { name: 'Bloom', params: { radius: 10 } },
      },
    ],
  });
  const fx = added.project.compositions[0]!.layers[0]!.effects.stack!.at(-1)!;
  expect(added.summary.generatedIds).toContainEqual(
    expect.objectContaining({ kind: 'effect', id: fx.id }),
  );
  const before = structuredClone(added.project.compositions[0]!.layers[0]!.animationTracks);
  const changed = session.apply({
    expectedRevision: 2,
    operations: [
      {
        type: 'update_effect',
        layerId: layer.id,
        effectId: fx.id,
        patch: { params: { radius: 20 } },
      },
      {
        type: 'reorder_effects',
        layerId: layer.id,
        effectIds: [fx.id, 'base-shadow', 'base-blur'],
      },
    ],
  });
  expect(changed.validation.valid).toBe(true);
  const tracks = changed.project.compositions[0]!.layers[0]!.animationTracks;
  expect(tracks.x).toEqual(before.x);
  expect(tracks.opacity).toEqual(before.opacity);
  expect(
    tracks[effectProperty(fx, 'radius') as `effects.${string}.${string}`]!.every(
      (k) => k.value === 20,
    ),
  ).toBe(true);
  expect(session.undo(3).project).toEqual(added.project);
});
