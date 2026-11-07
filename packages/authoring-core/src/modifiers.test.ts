import { describe, expect, it } from 'vitest';
import { createFieldDefinition, createProject, modifierProperty } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';
import type { AuthoringOperation } from './types';

function initialSession() {
  const project = createProject();
  const field = createFieldDefinition('number', {
    id: 'width-field',
    key: 'width',
    defaultValue: 300,
  });
  project.compositions[0]!.dataFields.push(field);
  const session = new AuthoringSession(project);
  const result = session.apply({
    expectedRevision: 0,
    operations: [
      {
        type: 'add_layer',
        id: 'label',
        kind: 'text',
        name: 'Presenter',
        element: { content: 'Ada Lovelace' },
      },
      { type: 'add_layer', id: 'bar', kind: 'rectangle', name: 'Background' },
      { type: 'add_layer', id: 'logo', kind: 'rectangle', name: 'Logo' },
    ],
  });
  expect(result.validation.errors).toEqual([]);
  return session;
}

describe('atomic modifier authoring', () => {
  it('creates the smart lower-third chain without rewriting authored transforms', () => {
    const session = initialSession();
    const before = session
      .snapshot()
      .project.compositions[0]!.layers.map((layer) => layer.keyframes);
    const result = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'add_modifier',
          layerId: 'label',
          modifierType: 'max-text-width',
          id: 'width',
          params: { maxWidth: 300 },
        },
        {
          type: 'add_modifier',
          layerId: 'bar',
          modifierType: 'auto-size',
          params: {
            source: { kind: 'layer', layerId: 'label' },
            height: false,
            paddingLeft: 20,
            paddingRight: 20,
          },
        },
        {
          type: 'add_modifier',
          layerId: 'logo',
          modifierType: 'auto-follow',
          params: {
            source: { kind: 'layer', layerId: 'bar' },
            axisY: false,
            sourceAnchorX: 1,
            offsetX: 12,
          },
        },
        {
          type: 'add_modifier',
          layerId: 'bar',
          modifierType: 'hide-empty',
          params: { source: { kind: 'layer', layerId: 'label', property: 'content' } },
        },
      ],
    });
    expect(result.validation.errors).toEqual([]);
    expect(result.summary.generatedIds.filter((item) => item.kind === 'modifier')).toHaveLength(4);
    expect(result.project.compositions[0]!.layers.map((layer) => layer.keyframes)).toEqual(before);
    expect(
      session.undo(2).project.compositions[0]!.layers.every((layer) => !layer.modifiers?.length),
    ).toBe(true);
  });

  it('keeps bound parameters editable, copies keys and links, then removes only owned channels', () => {
    const session = initialSession();
    session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'add_modifier',
          layerId: 'label',
          modifierType: 'max-text-width',
          id: 'width',
          params: { maxWidth: 300 },
        },
        {
          type: 'set_layer_bindings',
          layerId: 'label',
          bindings: [{ fieldId: 'width-field', targetProperty: 'modifiers.width.maxWidth' }],
        },
      ],
    });
    const changed = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'update_modifier',
          layerId: 'label',
          modifierId: 'width',
          patch: { params: { maxWidth: 500 } },
        },
        { type: 'duplicate_modifier', layerId: 'label', modifierId: 'width', id: 'copy' },
      ],
    });
    expect(changed.validation.errors).toEqual([]);
    const composition = changed.project.compositions[0]!;
    const layer = composition.layers[0]!;
    expect(composition.dataFields[0]!.defaultValue).toBe(500);
    expect(layer.modifiers?.find((entry) => entry.id === 'copy')?.enabled).toBe(false);
    expect(layer.animationTracks['modifiers.copy.maxWidth']).toEqual(
      layer.animationTracks['modifiers.width.maxWidth']!.map((key) =>
        expect.objectContaining({ frame: key.frame, value: key.value }),
      ),
    );
    expect(layer.bindings.map((binding) => binding.targetProperty)).toContain(
      'modifiers.copy.maxWidth',
    );
    const removed = session.apply({
      expectedRevision: 3,
      operations: [{ type: 'remove_modifier', layerId: 'label', modifierId: 'width' }],
    });
    expect(removed.validation.errors).toEqual([]);
    expect(
      removed.project.compositions[0]!.layers[0]!.animationTracks['modifiers.width.maxWidth'],
    ).toBeUndefined();
    expect(
      removed.project.compositions[0]!.layers[0]!.animationTracks['modifiers.copy.maxWidth'],
    ).toBeDefined();
  });

  it('rejects unknown params, invalid ranges and dependency cycles without advancing revision', () => {
    const session = initialSession();
    const operations: AuthoringOperation[][] = [
      [
        {
          type: 'add_modifier',
          layerId: 'label',
          modifierType: 'max-text-width',
          params: { maxWidth: -5 },
        },
      ],
      [
        {
          type: 'add_modifier',
          layerId: 'label',
          modifierType: 'max-text-width',
          params: { executable: 'alert(1)' },
        },
      ],
      [
        {
          type: 'add_modifier',
          layerId: 'bar',
          modifierType: 'auto-follow',
          params: { source: { kind: 'layer', layerId: 'logo' } },
        },
        {
          type: 'add_modifier',
          layerId: 'logo',
          modifierType: 'auto-follow',
          params: { source: { kind: 'layer', layerId: 'bar' } },
        },
      ],
    ];
    for (const batch of operations) {
      expect(() => session.apply({ expectedRevision: 1, operations: batch })).toThrow();
      expect(session.revision).toBe(1);
      expect(
        session
          .snapshot()
          .project.compositions[0]!.layers.every((layer) => !layer.modifiers?.length),
      ).toBe(true);
    }
  });

  it('accepts frame-scoped modifier keys and rejects keys for missing parameters', () => {
    const session = initialSession();
    const added = session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'add_modifier', layerId: 'label', modifierType: 'max-text-width', id: 'width' },
      ],
    });
    const entry = added.project.compositions[0]!.layers[0]!.modifiers![0]!;
    const property = modifierProperty(entry, 'maxWidth');
    const keyed = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'update_modifier',
          layerId: 'label',
          modifierId: entry.id,
          patch: { params: { maxWidth: 450 } },
          scope: 'frame',
          frame: 6,
        },
      ],
    });
    expect(keyed.validation.errors).toEqual([]);
    expect(
      keyed.project.compositions[0]!.layers[0]!.animationTracks[property]?.some(
        (key) => key.frame === 6 && key.value === 450,
      ),
    ).toBe(true);
    expect(() =>
      session.apply({
        expectedRevision: 3,
        operations: [
          {
            type: 'set_property_track',
            layerId: 'label',
            property: 'modifiers.width.notAParameter' as typeof property,
            replace: true,
            keys: [{ frame: 0, value: 5 }],
          },
        ],
      }),
    ).toThrow(/modifier parameter/i);
  });
});
