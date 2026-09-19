import { describe, expect, it } from 'vitest';
import { createProject, createShaderResource } from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';
import { compileDescriptor } from './compileDescriptor';
import { compileDataSchema } from './compileDataSchema';
import { getExportProfile, projectForExportProfile } from './exportProfiles';

describe('unused shader library export boundary', () => {
  it('retains authoring resources in project copies without adding runtime layers, fields or package assets', () => {
    const project = createProject();
    const shader = createShaderResource();
    shader.paint.fragmentSource = `// unused-library-source-marker\n${shader.paint.fragmentSource}`;
    project.shaders = [shader];
    const composition = project.compositions[0]!;
    expect(compileDescriptor(composition).layers).toEqual([]);
    expect(compileDataSchema(composition).properties).toEqual({});
    expect(projectForExportProfile(project, getExportProfile('non-realtime')).shaders).toEqual(
      project.shaders,
    );
    const artifacts = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
    );
    expect(artifacts.valid).toBe(true);
    expect(artifacts.resources).toEqual([]);
    expect(artifacts.mainJs).not.toContain('unused-library-source-marker');
    expect(artifacts.manifest.schema).toBeUndefined();
    expect(project.shaders).toHaveLength(1);
  });
});
