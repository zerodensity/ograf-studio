import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChartLayer,
  createFieldDefinition,
  createLayerKeyframe,
  createProject,
  createRendererPluginSnapshot,
  defaultTransformFor,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';
import {
  buildExportArtifactsWithRuntime,
  EXPORTED_RESOURCE_URLS_KEY,
  generateMainJs,
} from './buildExportArtifacts';

function snapshot(version: string): RendererPluginSnapshot {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version,
      name: 'Pinned Chart',
      presets: ['bar'],
      license: 'MIT',
    },
    source: `// exact source ${version}\nexport default {};\n`,
    licenseText: `MIT license ${version}\n`,
  });
}
function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const selected = snapshot('1.0.0');
  const unused = snapshot('2.0.0');
  const layer = createChartLayer();
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
  if (layer.element.type !== 'chart') throw new Error('Expected chart');
  layer.element.provider = { ...selected.manifest, sha256: selected.sha256 };
  composition.layers = [layer];
  composition.rendererPlugins = [selected, unused];
  return { project, composition, layer, selected, unused };
}
const runtime = 'class GraphicElement {}';

describe('exact pinned renderer export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves independent area chart series through descriptor and package compilation', () => {
    const { project, composition, layer } = fixture();
    const areaProvider = createRendererPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'chart',
        id: 'test.area',
        version: '1.0.0',
        name: 'Area chart renderer',
        presets: ['area'],
        license: 'MIT',
      },
      source: 'export default {};',
      licenseText: 'MIT license',
    });
    if (layer.element.type !== 'chart') throw new Error('Expected chart');
    layer.element.preset = 'area';
    layer.element.provider = { ...areaProvider.manifest, sha256: areaProvider.sha256 };
    layer.element.data.datasets.push({
      label: 'Series 2',
      data: [0, 8, 17, 3],
      backgroundColor: '#f472b6',
      borderColor: '#f472b6',
    });
    composition.rendererPlugins = [areaProvider];
    const source = structuredClone(layer.element.data);
    const descriptor = compileDescriptor(composition);
    expect(descriptor.layers[0]?.element).toMatchObject({ preset: 'area', data: source });
    const exported = buildExportArtifactsWithRuntime(project, composition, runtime);
    expect(exported.errors).toEqual([]);
    expect(exported.descriptor?.layers[0]?.element).toMatchObject({ preset: 'area', data: source });
    expect(layer.element.data).toEqual(source);
  });

  it('blocks unassigned rendered charts before certification but excludes guide-only unassigned charts', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const chart = createChartLayer();
    chart.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
    composition.layers = [chart];
    const unassigned = buildExportArtifactsWithRuntime(project, composition, runtime);
    expect(unassigned.valid).toBe(false);
    expect(unassigned.projectErrors.join(' ')).toContain('no assigned renderer provider');
    chart.isGuide = true;
    const guideOnly = buildExportArtifactsWithRuntime(project, composition, runtime);
    expect(guideOnly.errors).toEqual([]);
    expect(guideOnly.descriptor?.layers).toHaveLength(0);
    expect(
      guideOnly.resources.some((resource) => resource.path === 'licenses/chartjs-LICENSE.txt'),
    ).toBe(false);
  });

  it('compiles only the selected version regardless of catalog order or newer installed snapshots', () => {
    const { composition, selected, unused } = fixture();
    expect(compileDescriptor(composition).rendererPlugins).toEqual([selected]);
    composition.rendererPlugins = [unused, selected];
    expect(compileDescriptor(composition).rendererPlugins).toEqual([selected]);
    expect(composition.rendererPlugins).toEqual([unused, selected]);
  });

  it('includes providers used by runtime collection prototypes while excluding guide-only providers', () => {
    const { composition, layer, selected, unused } = fixture();
    const field = createFieldDefinition('array', {
      key: 'items',
      constraints: { maxItems: 2 },
      defaultValue: [],
      items: createFieldDefinition('object', { key: 'item', properties: [] }),
    });
    layer.groupId = 'prototype';
    composition.dataFields = [field];
    composition.runtimeCollections = [
      {
        id: 'collection',
        name: 'Charts',
        fieldId: field.id,
        prototypeLayerIds: [layer.id],
        offsetPerItem: { x: 0, y: 100 },
        capacity: 2,
        overflow: 'truncate',
      },
    ];
    const guide = structuredClone(layer);
    guide.id = 'guide';
    guide.isGuide = true;
    guide.groupId = null;
    if (guide.element.type !== 'chart') throw new Error('Expected chart');
    guide.element.provider = { ...unused.manifest, sha256: unused.sha256 };
    composition.layers.push(guide);
    const descriptor = compileDescriptor(composition);
    expect(descriptor.layers).toHaveLength(0);
    expect(descriptor.collections?.[0]?.prototypeLayers[0]?.element).toMatchObject({
      provider: {
        id: selected.manifest.id,
        version: selected.manifest.version,
        sha256: selected.sha256,
      },
    });
    expect(descriptor.rendererPlugins).toEqual([selected]);
  });

  it('ships exact module/license bytes as safe hash-pinned sidecars without changing the authoring catalog', () => {
    const { project, composition, selected, unused } = fixture();
    const before = structuredClone(composition);
    const artifacts = buildExportArtifactsWithRuntime(project, composition, runtime);
    const directory = `plugins/test.chart/1.0.0/${selected.sha256}`;
    expect(artifacts.errors).toEqual([]);
    expect(
      artifacts.resources.some((resource) => resource.path === 'licenses/chartjs-LICENSE.txt'),
    ).toBe(false);
    expect(artifacts.resources).toContainEqual({
      path: `${directory}/renderer.js`,
      data: selected.source,
      base64: false,
      mimeType: 'text/javascript',
    });
    expect(artifacts.resources).toContainEqual({
      path: `${directory}/LICENSE.txt`,
      data: selected.licenseText,
      base64: false,
      mimeType: 'text/plain',
    });
    expect(artifacts.mainJs).toContain(JSON.stringify(selected.source));
    expect(artifacts.descriptor?.rendererPlugins).toEqual([
      { ...selected, moduleUrl: `${directory}/renderer.js` },
    ]);
    const embedded = /const exportedDescriptor = (.*);\nconst exportedModuleBaseUrl/.exec(
      artifacts.mainJs,
    );
    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded![1]!)).toEqual(artifacts.descriptor);
    expect(artifacts.mainJs).not.toContain(unused.sha256);
    expect(composition).toEqual(before);
  });

  it.each(['https://renderer.example/package/main.js', 'blob:package-main'])(
    'resolves pinned module URLs in the %s realm using the package resource map',
    (moduleUrl) => {
      const { project, composition, selected } = fixture();
      const artifacts = buildExportArtifactsWithRuntime(project, composition, runtime);
      const path = `plugins/test.chart/1.0.0/${selected.sha256}/renderer.js`;
      const descriptor = compileDescriptor(composition);
      descriptor.rendererPlugins![0]!.moduleUrl = path;
      if (moduleUrl.startsWith('blob:'))
        vi.stubGlobal(EXPORTED_RESOURCE_URLS_KEY, {
          [moduleUrl]: { [path]: 'blob:pinned-plugin' },
        });
      const source = generateMainJs(
        descriptor,
        runtime,
        artifacts.resources.map((resource) => resource.path),
      )
        .replaceAll('import.meta.url', JSON.stringify(moduleUrl))
        .replace('export default ExportedGraphic;', 'return ExportedGraphic;');
      const Graphic = new Function(source)() as { descriptor: typeof descriptor };
      expect(Graphic.descriptor.rendererPlugins![0]!.moduleUrl).toBe(
        moduleUrl.startsWith('blob:')
          ? 'blob:pinned-plugin'
          : `https://renderer.example/package/${path}`,
      );
      expect(Graphic.descriptor.rendererPlugins![0]!.source).toBe(selected.source);
      expect(Graphic.descriptor.rendererPlugins![0]!.sha256).toBe(selected.sha256);
    },
  );
});
