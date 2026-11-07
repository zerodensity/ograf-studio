import { describe, expect, it } from 'vitest';
import {
  createCustomActionDefinition,
  createFieldDefinition,
  createMediaCue,
  createProject,
  type LogicFunctionDefinition,
} from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';
import { compileDescriptor } from '@ograf-editor/codegen';

function fixture() {
  const project = createProject({ supportsNonRealTime: false });
  const composition = project.compositions[0]!;
  composition.dataFields = [createFieldDefinition('number', { id: 'field', key: 'score' })];
  composition.customActions = [createCustomActionDefinition({ actionId: 'increment' })];
  composition.mediaCues = [
    createMediaCue({
      id: 'ding',
      activeSourceId: 'audio',
      sources: [
        {
          id: 'audio',
          name: 'Ding',
          kind: 'clip',
          mediaType: 'audio',
          src: 'data:audio/wav;base64,AQID',
        },
      ],
    }),
  ];
  const definition: LogicFunctionDefinition = {
    type: 'javascript',
    version: 1,
    id: 'counter',
    name: 'Counter',
    enabled: true,
    source: '({data}) => ({data:{score:data.score+1}})',
    inputs: { score: 'field' },
    outputs: { score: 'field' },
    actions: ['increment'],
    media: { ding: 'ding' },
  };
  return { session: new AuthoringSession(project, 'functions'), definition };
}

describe('function authoring operations', () => {
  it('keeps composition Functions outside saved component scopes during validation and canonical child edits', () => {
    const { session, definition } = fixture();
    const added = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Cell / editable block' }],
    });
    const layerId = added.project.compositions[0]!.layers[0]!.id;
    const saved = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'save_component', layerIds: [layerId], name: 'Cell / editable block' }],
    });
    const component = saved.project.compositions[0]!.components[0]!;
    expect(component.context).toBeDefined();
    expect(component.dataFields).toHaveLength(0);
    const configured = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'set_logic_functions', functions: [definition] }],
    });
    expect(configured.validation.errors).toEqual([]);
    const edited = session.apply({
      expectedRevision: 3,
      operations: [
        {
          type: 'update_component_layer',
          componentId: component.id,
          sourceLayerId: component.layers[0]!.id,
          patch: { element: { fill: '#112233' } },
        },
      ],
    });
    expect(edited.validation.errors).toEqual([]);
    const composition = edited.project.compositions[0]!;
    expect(composition.functions).toEqual([definition]);
    expect(composition.components[0]!.context).not.toHaveProperty('functions');
    expect(composition.components[0]!.layers[0]!.element).toMatchObject({ fill: '#112233' });
    expect(compileDescriptor(composition).functions).toHaveLength(1);
    expect(compileDescriptor(composition).functions![0]!.outputs).toEqual({ score: 'score' });
  });
  it('installs valid definitions atomically and uses the supported runtime profile', () => {
    const { session, definition } = fixture();
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [
          {
            type: 'set_logic_functions',
            functions: [{ ...definition, outputs: { score: 'missing' } }],
          },
        ],
      }),
    ).toThrow(/missing data field/);
    expect(session.revision).toBe(0);
    const result = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_logic_functions', functions: [definition] }],
    });
    expect(result.project.compositions[0]!.functions).toEqual([definition]);
    expect(result.project.supportsRealTime).toBe(true);
    expect(result.project.supportsNonRealTime).toBe(false);
  });
  it('preserves references even for forced deletion and allows removal after explicit function removal', () => {
    const { session, definition } = fixture();
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_logic_functions', functions: [definition] }],
    });
    for (const operation of [
      { type: 'remove_data_field', fieldId: 'field', force: true },
      { type: 'remove_media_cue', cueId: 'ding' },
      { type: 'remove_custom_action', actionId: 'increment' },
      { type: 'update_custom_action', actionId: 'increment', nextActionId: 'changed' },
    ] as const) {
      expect(() => session.apply({ expectedRevision: 1, operations: [operation] })).toThrow(
        /Remove or reconfigure the function first/,
      );
      expect(session.revision).toBe(1);
    }
    const result = session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'set_logic_functions', functions: [] },
        { type: 'remove_data_field', fieldId: 'field', force: true },
        { type: 'remove_media_cue', cueId: 'ding' },
        { type: 'remove_custom_action', actionId: 'increment' },
      ],
    });
    expect(result.project.compositions[0]!.functions).toBeUndefined();
  });
});
