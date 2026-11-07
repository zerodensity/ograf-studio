import { describe, expect, it } from 'vitest';
import {
  createProject,
  createRectangleLayer,
  createTextLayer,
  createLayerKeyframe,
  defaultTransformFor,
  createShaderPackPluginSnapshot,
  createShaderPaint,
  resolveShaderPackPresetPaint,
  addEffect,
  updateEffect,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const pack = createShaderPackPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'shader-pack',
      id: 'test.shader-pack',
      version: '1.0.0',
      name: 'Test shaders',
      license: 'CC0-1.0',
    },
    licenseText: 'Exact original shader notice',
    shaders: [
      {
        id: 'color',
        name: 'Color',
        targets: ['fill', 'outline'],
        paint: createShaderPaint({
          fragmentSource: 'void mainImage(out vec4 c, in vec2 p) { c=vec4(0.2,0.4,0.8,1.0); }',
        }),
      },
      {
        id: 'pass',
        name: 'Pass',
        targets: ['effect'],
        paint: createShaderPaint({
          fragmentSource:
            'void mainImage(out vec4 c, in vec2 p) { c=texture(iChannel0,p/iResolution.xy); }',
        }),
      },
    ],
  });
  const rect = createRectangleLayer();
  rect.keyframes = [createLayerKeyframe(0, defaultTransformFor('rectangle'))];
  if (rect.element.type !== 'rectangle') throw new Error('Expected rectangle');
  rect.element.fill = resolveShaderPackPresetPaint(pack, 'color', 'fill');
  composition.layers = [rect];
  return { project, composition, pack, rect };
}

describe('portable copied shader pack exports', () => {
  it('keeps GLSL and attribution without a pack installation or renderer dependency', () => {
    const { project, composition, pack } = fixture();
    const artifacts = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
    );
    expect(artifacts.errors).toEqual([]);
    expect(artifacts.descriptor?.rendererPlugins ?? []).toEqual([]);
    expect(artifacts.mainJs).toContain('vec4(0.2,0.4,0.8,1.0)');
    expect(artifacts.resources).toContainEqual({
      path: `licenses/shader-packs/${pack.manifest.id}/${pack.manifest.version}/${pack.sha256}/LICENSE.txt`,
      data: pack.licenseText,
      base64: false,
      mimeType: 'text/plain',
    });
  });
  it('deduplicates notices across fill, text outline and effect copies', () => {
    const { project, composition, pack, rect } = fixture();
    const text = createTextLayer();
    text.keyframes = [createLayerKeyframe(0, defaultTransformFor('text'))];
    if (text.element.type !== 'text') throw new Error('Expected text');
    text.element.strokePaint = resolveShaderPackPresetPaint(pack, 'color', 'outline');
    text.element.strokeWidth = 2;
    const effect = addEffect(rect, 'shader');
    updateEffect(rect, effect.id, {
      blendMode: 'normal',
      shader: resolveShaderPackPresetPaint(pack, 'pass', 'effect'),
    });
    composition.layers.push(text);
    const artifacts = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
    );
    expect(artifacts.errors).toEqual([]);
    expect(
      artifacts.resources.filter((item) => item.path.startsWith('licenses/shader-packs/')),
    ).toHaveLength(1);
  });
  it('does not export unused project resources or guide-only notices', () => {
    const { project, composition, rect } = fixture();
    rect.isGuide = true;
    const artifacts = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
    );
    expect(artifacts.errors).toEqual([]);
    expect(
      artifacts.resources.filter((item) => item.path.startsWith('licenses/shader-packs/')),
    ).toHaveLength(0);
  });
});
