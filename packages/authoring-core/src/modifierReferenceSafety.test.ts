import { describe, expect, it } from 'vitest';
import {
  addLayerModifier,
  createFieldDefinition,
  createLayerOfKind,
  createProject,
  createShaderPaint,
  syncCompositionShaderParameterFields,
} from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

function fixture() {
  const project = createProject(),
    composition = project.compositions[0]!;
  const title = createLayerOfKind('text'),
    panel = createLayerOfKind('rectangle');
  title.groupId = 'smart';
  panel.groupId = 'smart';
  const field = createFieldDefinition('text', { key: 'headline', defaultValue: 'Name' });
  addLayerModifier(panel, 'auto-size', { source: { kind: 'layer', layerId: title.id } });
  addLayerModifier(panel, 'hide-empty', {
    source: { kind: 'field', fieldId: field.id, sourcePath: [] },
  });
  composition.layers = [title, panel];
  composition.dataFields = [field];
  return { project, title, panel, field, composition };
}
describe('atomic authoring modifier reference lifecycle', () => {
  it('retargets generated shader fields after copied shader declarations create their new identities', () => {
    const f = fixture();
    if (f.panel.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    f.panel.element.fill = createShaderPaint();
    syncCompositionShaderParameterFields(f.composition);
    const generated = f.composition.dataFields.find((field) => field.generatedShaderParameter)!;
    expect(generated).toBeDefined();
    addLayerModifier(f.title, 'hide-empty', {
      source: { kind: 'field', fieldId: generated.id, sourcePath: [] },
    });
    const session = new AuthoringSession(f.project, 'modifier-shader-fields');
    const result = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'duplicate_group',
          source: { groupId: 'smart' },
          count: 1,
          fieldKeyRewrite: { from: 'headline', to: 'headline_{n}' },
        },
      ],
    });
    const copy = result.summary.duplicateGroups[0]!.copies[0]!,
      title = result.project.compositions[0]!.layers.find(
        (layer) => layer.id === copy.layers[f.title.id],
      )!;
    expect(copy.fields[generated.id]).not.toBe(generated.id);
    expect(title.modifiers?.[0]).toMatchObject({
      params: { source: { fieldId: copy.fields[generated.id] } },
    });
  });
  it('duplicates internal geometry and modifier-only field references independently', () => {
    const f = fixture(),
      session = new AuthoringSession(f.project, 'modifier-copies');
    const result = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'duplicate_group',
          source: { groupId: 'smart' },
          count: 1,
          fieldKeyRewrite: { from: 'headline', to: 'headline_{n}' },
        },
      ],
    });
    const copy = result.summary.duplicateGroups[0]!.copies[0]!,
      panel = result.project.compositions[0]!.layers.find(
        (layer) => layer.id === copy.layers[f.panel.id],
      )!;
    expect(panel.modifiers?.[0]).toMatchObject({
      params: { source: { layerId: copy.layers[f.title.id] } },
    });
    expect(panel.modifiers?.[1]).toMatchObject({
      params: { source: { fieldId: copy.fields[f.field.id] } },
    });
    expect(copy.fields[f.field.id]).not.toBe(f.field.id);
  });
  it('blocks referenced layer/field deletion atomically, while force field removal clears only the owned Hide modifier', () => {
    const f = fixture(),
      session = new AuthoringSession(f.project, 'modifier-delete');
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [{ type: 'remove_layer', layerId: f.title.id }],
      }),
    ).toThrow(/Retarget/);
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [{ type: 'remove_data_field', fieldId: f.field.id }],
      }),
    ).toThrow(/Cannot remove/);
    expect(session.snapshot().revision).toBe(0);
    const removed = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'remove_data_field', fieldId: f.field.id, force: true }],
    });
    expect(removed.project.compositions[0]!.dataFields).toHaveLength(0);
    expect(
      removed.project.compositions[0]!.layers.find(
        (layer) => layer.id === f.panel.id,
      )?.modifiers?.map((modifier) => modifier.type),
    ).toEqual(['auto-size']);
  });
  it('rejects flattened subgroup copies and allows a complete group target copy without widening', () => {
    const f = fixture();
    const outside = createLayerOfKind('rectangle');
    outside.groupId = 'outside';
    f.composition.layers.push(outside);
    addLayerModifier(f.title, 'hide-empty', {
      source: { kind: 'layer', layerId: f.title.id, property: 'content' },
      target: { kind: 'group', groupId: 'smart' },
    });
    const session = new AuthoringSession(f.project, 'modifier-groups');
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [
          {
            type: 'duplicate_group',
            source: { layerIds: f.composition.layers.map((layer) => layer.id) },
            count: 1,
            bindings: 'share',
          },
        ],
      }),
    ).toThrow(/widen/);
    const result = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'duplicate_group', source: { groupId: 'smart' }, count: 1, bindings: 'share' },
      ],
    });
    const copy = result.summary.duplicateGroups[0]!.copies[0]!,
      title = result.project.compositions[0]!.layers.find(
        (layer) => layer.id === copy.layers[f.title.id],
      )!;
    expect(title.modifiers?.[0]).toMatchObject({ params: { target: { groupId: copy.groupId } } });
  });
});
