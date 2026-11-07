import { describe, expect, it } from 'vitest';
import {
  addEffect,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  createShaderPackPluginSnapshot,
  createShaderPaint,
  createShaderResource,
  defaultTransformFor,
  resolveShaderPackPresetPaint,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

function fixture() {
  const snapshot = createShaderPackPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'shader-pack',
      id: 'test.shaders',
      version: '1.0.0',
      name: 'Shaders',
      license: 'CC0-1.0',
    },
    licenseText: 'CC0 fixture',
    shaders: [
      {
        id: 'solid',
        name: 'Solid',
        targets: ['fill', 'outline', 'effect'],
        paint: createShaderPaint({
          fragmentSource: 'void mainImage(out vec4 c,in vec2 p){c=vec4(1.0);}',
          parameters: {},
        }),
      },
    ],
  });
  const project = createProject();
  const layer = createLayerOfKind('text');
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('text'))];
  if (layer.element.type !== 'text') throw Error('Expected text');
  layer.element.fill = resolveShaderPackPresetPaint(snapshot, 'solid', 'fill');
  layer.element.strokePaint = resolveShaderPackPresetPaint(snapshot, 'solid', 'outline');
  addEffect(layer, 'shader', { shader: resolveShaderPackPresetPaint(snapshot, 'solid', 'effect') });
  project.compositions[0]!.layers = [layer];
  project.shaders = [
    createShaderResource({ paint: resolveShaderPackPresetPaint(snapshot, 'solid', 'fill') }),
  ];
  return { project, layer };
}
describe('copied shader pack attribution validation', () => {
  it('accepts fill/outline/effect/resource copies with no installed pack dependency', () => {
    expect(validateProject(fixture().project).errors).toEqual([]);
  });
  it('rejects malformed copied provenance wherever an ordinary shader paint is used', () => {
    const { project, layer } = fixture();
    if (layer.element.type !== 'text') throw Error('Expected text');
    const paint = layer.element.strokePaint!;
    paint.packProvenance!.reference.sha256 = 'bad';
    expect(validateProject(project).errors.join(' ')).toContain('provenance');
    paint.packProvenance!.reference.sha256 = '0'.repeat(64);
    project.shaders[0]!.paint.packProvenance!.licenseText = '';
    expect(validateProject(project).errors.join(' ')).toContain('licenseText');
  });
});
