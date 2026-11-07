import { describe, expect, it } from 'vitest';
import {
  createProject,
  createLayerOfKind,
  createLayerKeyframe,
  createDefaultTransform,
  createLayerLoopClip,
  createFieldDefinition,
  buildComponentDefinition,
  instantiateComponentDefinition,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const field = createFieldDefinition('number', { key: 'holdSeconds', defaultValue: 4 });
  composition.dataFields.push(field);
  const layer = createLayerOfKind('rectangle');
  layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
  layer.loop = createLayerLoopClip({
    durationFrames: 140,
    timing: {
      groupId: 'Headlines',
      holdFieldId: field.id,
      holdRanges: [{ startFrame: 0, endFrame: 100 }],
    },
  });
  composition.layers.push(layer);
  return { project, composition, layer, field };
}

describe('portable loop transport timing', () => {
  it('validates numeric hold fields and bounded ordered holds', () => {
    const { project, layer } = fixture();
    expect(validateProject(project).valid).toBe(true);
    layer.loop!.timing!.holdFieldId = 'missing';
    expect(validateProject(project).errors.join(' ')).toMatch(/numeric hold field/);
    layer.loop!.timing!.holdRanges = [{ startFrame: 50, endFrame: 160 }];
    expect(validateProject(project).errors.join(' ')).toMatch(/hold ranges/);
  });

  it('captures transport-only data fields and isolates two component instances', () => {
    const { project, composition, layer, field } = fixture();
    const definition = buildComponentDefinition(composition, [layer.id], 'Headlines');
    expect(definition.dataFields.map((entry) => entry.id)).toContain(field.id);
    composition.components.push(definition);
    const first = instantiateComponentDefinition(composition, definition);
    const second = instantiateComponentDefinition(composition, definition);
    expect(first.layers[0]!.loop!.timing!.holdFieldId).not.toBe(
      second.layers[0]!.loop!.timing!.holdFieldId,
    );
    expect(first.layers[0]!.loop!.timing!.groupId).not.toBe(
      second.layers[0]!.loop!.timing!.groupId,
    );
    expect(validateProject(project).valid).toBe(true);
  });
});
