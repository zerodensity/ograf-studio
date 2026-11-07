import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  migrateProject,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';
import { buildCoordinatedExportArtifactsWithRuntime } from './buildCoordinatedExportArtifacts';
import { getExportProfile } from './exportProfiles';

describe('portable native transform bindings', () => {
  it('preserves paths and numeric schemas through source roundtrip and both export kinds', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const actor = createLayerOfKind('rectangle');
    actor.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    const field = createFieldDefinition('object', {
      key: 'actor',
      properties: [
        createFieldDefinition('number', { key: 'x', defaultValue: 120 }),
        createFieldDefinition('number', { key: 'alpha', defaultValue: 1 }),
      ],
      defaultValue: { x: 120, alpha: 1 },
    });
    actor.bindings = [
      { fieldId: field.id, targetProperty: 'layer.x', sourcePath: ['x'] },
      { fieldId: field.id, targetProperty: 'layer.opacity', sourcePath: ['alpha'] },
    ];
    composition.layers = [actor];
    composition.dataFields = [field];
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(reopened.compositions[0]!.layers[0]!.bindings).toEqual(actor.bindings);
    const standalone = buildExportArtifactsWithRuntime(
      reopened,
      reopened.compositions[0]!,
      'class GraphicElement {}',
      getExportProfile('dual'),
    );
    expect(standalone.valid, standalone.errors.join('\n')).toBe(true);
    expect(standalone.descriptor!.layers[0]!.bindings).toEqual(
      expect.arrayContaining([
        { dataKey: 'actor', targetProperty: 'layer.x', sourcePath: ['x'] },
        { dataKey: 'actor', targetProperty: 'layer.opacity', sourcePath: ['alpha'] },
      ]),
    );
    const definition: TransitionLogicDefinition = {
      version: 4,
      id: 'logic',
      name: 'Actors',
      defaultTransitionId: 'cut',
      slots: [{ id: 'main', name: 'Main', order: 0 }],
      states: [{ id: 'actor', name: 'Actor', slotId: 'main', templateId: 'actor' }],
      transitions: [
        {
          id: 'cut',
          name: 'Cut',
          durationFrames: 0,
          incomingFrames: 0,
          outgoingFrames: 0,
          incomingStartFrame: 0,
          sharedFrames: 0,
          easing: 'linear',
        },
      ],
      sharedInstances: [],
      initialSharedValues: [],
      routes: [],
    };
    const coordinated = buildCoordinatedExportArtifactsWithRuntime(
      {
        id: 'actors',
        name: 'Actors',
        definition,
        templates: [{ id: 'actor', name: 'Actor', project: reopened }],
        componentAssets: [],
      },
      'class CoordinatedGraphicElement {}',
      getExportProfile('dual'),
    );
    expect(coordinated.valid, coordinated.errors.join('\n')).toBe(true);
    expect(coordinated.transitionDescriptor!.templates[0]!.descriptor.layers[0]!.bindings).toEqual(
      standalone.descriptor!.layers[0]!.bindings,
    );
  });
});
