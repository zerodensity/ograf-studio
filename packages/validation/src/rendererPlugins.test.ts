import { describe, expect, it } from 'vitest';
import {
  createChartLayer,
  createLayerKeyframe,
  createProject,
  defaultTransformFor,
  createRendererPluginSnapshot,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

function snapshot(version = '1.0.0', source = 'export default {};'): RendererPluginSnapshot {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version,
      name: 'Test',
      presets: ['bar'],
      license: 'MIT',
    },
    source,
    licenseText: 'MIT test license',
  });
}
function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const plugin = snapshot();
  const layer = createChartLayer();
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
  if (layer.element.type !== 'chart') throw new Error('Expected chart');
  layer.element.provider = {
    id: plugin.manifest.id,
    version: plugin.manifest.version,
    sha256: plugin.sha256,
  };
  composition.layers = [layer];
  composition.rendererPlugins = [plugin];
  return { project, composition, layer, plugin };
}

describe('renderer plugin project integrity', () => {
  it('keeps unassigned legacy charts valid and repairable while warning that a provider is required', () => {
    const { project, layer } = fixture();
    if (layer.element.type !== 'chart') throw new Error('Expected chart');
    layer.element.provider = null;
    const result = validateProject(project);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('no assigned chart renderer provider');
  });
  it('accepts a selected exact snapshot and permits a second version without upgrading the chart', () => {
    const { project, composition } = fixture();
    composition.rendererPlugins!.push(snapshot('2.0.0'));
    expect(validateProject(project).errors).toEqual([]);
  });

  it.each(['missing', 'version', 'digest', 'preset', 'source'] as const)(
    'rejects a %s mismatch instead of substituting another installed version',
    (problem) => {
      const { project, composition, layer, plugin } = fixture();
      if (layer.element.type !== 'chart') throw new Error('Expected chart');
      if (problem === 'missing') composition.rendererPlugins = [];
      else if (problem === 'version') layer.element.provider!.version = '2.0.0';
      else if (problem === 'digest') layer.element.provider!.sha256 = '0'.repeat(64);
      else if (problem === 'preset') layer.element.preset = 'pie';
      else plugin.source += '// changed';
      expect(validateProject(project).valid).toBe(false);
      expect(validateProject(project).errors.join(' ')).toMatch(
        /pinned renderer|integrity|support preset/,
      );
    },
  );

  it('rejects duplicate snapshots and excessive catalog entry counts', () => {
    const { project, composition, plugin } = fixture();
    composition.rendererPlugins!.push(structuredClone(plugin));
    expect(validateProject(project).errors.join(' ')).toContain('duplicate renderer plugin');
    composition.rendererPlugins = Array.from({ length: 17 }, (_, index) =>
      snapshot(`1.0.${index}`),
    );
    expect(validateProject(project).errors.join(' ')).toContain('16 snapshots');
  });

  it('limits total catalog bytes even when each individual source fits its limit', () => {
    const { project, composition } = fixture();
    composition.rendererPlugins = Array.from({ length: 5 }, (_, index) =>
      snapshot(`1.0.${index}`, `export default {};${' '.repeat(2 * 1024 * 1024 - 100)}`),
    );
    expect(validateProject(project).errors.join(' ')).toContain('8 MiB');
  });
});
