import { describe, expect, it } from 'vitest';
import {
  createProject,
  isOutputLayer,
  migrateProject,
  requireOutputLayer,
  resolveOutputLayer,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime, getExportProfile } from '@ograf-editor/codegen';
import { validateManifest } from './validateManifest';
import { validateProject } from './validateProject';

const validLayers = [Number.MIN_SAFE_INTEGER, -100, -0, 0, 100, Number.MAX_SAFE_INTEGER];
const invalidLayers = [null, '1', 0.5, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53), {}, true];

describe('output layer metadata', () => {
  it.each(validLayers)(
    'exports safe integer %s as top-level metadata in every profile',
    (value) => {
      const project = createProject({ outputLayer: value });
      for (const mode of ['realtime', 'non-realtime', 'dual'] as const) {
        const artifacts = buildExportArtifactsWithRuntime(
          project,
          project.compositions[0]!,
          'class GraphicElement {}',
          getExportProfile(mode),
        );
        expect(artifacts.errors).toEqual([]);
        expect(artifacts.manifest.v_layer).toBe(value || 0);
        expect(validateManifest(artifacts.manifest).valid).toBe(true);
        expect(artifacts.descriptor).not.toHaveProperty('outputLayer');
      }
      expect(isOutputLayer(value)).toBe(true);
      expect(Object.is(requireOutputLayer(value), -0)).toBe(false);
    },
  );

  it('defaults new and legacy projects to zero without modifying the source', () => {
    const legacy = createProject();
    delete legacy.outputLayer;
    const migrated = migrateProject(legacy);
    expect(migrated.outputLayer).toBe(0);
    expect(legacy).not.toHaveProperty('outputLayer');
    expect(createProject().outputLayer).toBe(0);
    expect(resolveOutputLayer(undefined)).toBe(0);
    const artifacts = buildExportArtifactsWithRuntime(legacy, legacy.compositions[0]!, '');
    expect(artifacts.manifest.v_layer).toBe(0);
  });

  it.each(invalidLayers)(
    'rejects authored %j but resolves imported invalid metadata to zero',
    (value) => {
      expect(isOutputLayer(value)).toBe(false);
      expect(() => requireOutputLayer(value)).toThrow(/safe integer/);
      expect(resolveOutputLayer(value)).toBe(0);
      const project = createProject();
      Object.assign(project, { outputLayer: value });
      expect(validateProject(project).errors.join(' ')).toContain('Output layer');
      expect(() => migrateProject(project)).toThrow(/safe integer/);
      const artifacts = buildExportArtifactsWithRuntime(project, project.compositions[0]!, '');
      expect(artifacts.valid).toBe(false);
      expect(
        validateManifest({ ...artifacts.manifest, v_layer: value }).errors.join(' '),
      ).toContain('/v_layer');
    },
  );
});
