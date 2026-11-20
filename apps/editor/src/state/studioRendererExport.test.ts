import { expect, it } from 'vitest';
import {
  createChartLayer,
  createLayerKeyframe,
  createProject,
  createRendererPluginSnapshot,
  defaultTransformFor,
  studioPluginReference,
} from '@ograf-editor/scene-model';
import { buildExportArtifacts } from './ografCompatibility';
import { useRendererPluginSettingsStore } from './pluginSettingsStore';

it('exports the trusted installed same-version renderer without changing the saved pin', () => {
  const saved = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      id: 'test.chart',
      version: '1.0.0',
      kind: 'chart',
      name: 'Test chart',
      presets: ['bar'],
      license: 'MIT',
    },
    source: '// saved build\nexport default {apiVersion:1,create(){}};',
    licenseText: 'MIT',
  });
  const local = createRendererPluginSnapshot({
    manifest: saved.manifest,
    source: '// installed build\nexport default {apiVersion:1,create(){}};',
    licenseText: saved.licenseText,
  });
  const project = createProject();
  const composition = project.compositions[0]!;
  const chart = createChartLayer();
  if (chart.element.type !== 'chart') throw new Error('Expected chart.');
  chart.element.provider = studioPluginReference(saved);
  chart.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
  composition.layers.push(chart);
  composition.rendererPlugins = [saved];
  const before = structuredClone(project);
  const { installed } = useRendererPluginSettingsStore.getState();

  try {
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: local, installedAt: '', enabled: true, trusted: true }],
    });
    const artifact = buildExportArtifacts(project, composition);

    expect(artifact.errors).toEqual([]);
    expect(artifact.descriptor?.rendererPlugins?.map(({ sha256 }) => sha256)).toEqual([
      local.sha256,
    ]);
    expect(artifact.resources).toContainEqual({
      path: `plugins/test.chart/1.0.0/${local.sha256}/renderer.js`,
      data: local.source,
      base64: false,
      mimeType: 'text/javascript',
    });
    expect(artifact.mainJs).not.toContain(saved.sha256);
    expect(project).toEqual(before);
  } finally {
    useRendererPluginSettingsStore.setState({ installed });
  }
});
