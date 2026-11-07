import { describe, expect, it } from 'vitest';
import {
  createChartLayer,
  createProject,
  createRendererPluginSnapshot,
  type Layer,
  type RendererPluginSnapshot,
  createAnimationPresetPluginSnapshot,
  createShaderPackPluginSnapshot,
  createShaderPaint,
  createRectangleLayer,
  resolveShaderPackPresetPaint,
} from '@ograf-editor/scene-model';
import {
  requiredProjectRendererPlugins,
  requiredProjectStudioPlugins,
} from './configurationPlugins';

function plugin(version: string) {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version,
      name: 'Test provider',
      presets: ['bar'],
      license: 'MIT',
    },
    source: 'export default {apiVersion:1,create(){}};',
    licenseText: 'MIT',
  });
}

function selectProvider(layer: Layer, snapshot: RendererPluginSnapshot) {
  if (layer.element.type !== 'chart') throw new Error('Expected chart.');
  layer.element.provider = {
    id: snapshot.manifest.id,
    version: snapshot.manifest.version,
    sha256: snapshot.sha256,
  };
}

describe('Configuration required project plugins', () => {
  it('excludes unused prior providers and guide-only pins after selecting the built-in renderer', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const prior = plugin('1.0.0');
    const guideOnly = plugin('2.0.0');
    const builtin = createChartLayer();
    const guide = createChartLayer();
    guide.isGuide = true;
    selectProvider(guide, guideOnly);
    composition.layers = [builtin, guide];
    composition.rendererPlugins = [prior, guideOnly];
    expect(requiredProjectRendererPlugins(project)).toEqual([]);
  });

  it('includes selected collection-prototype providers and deduplicates identical selected pins', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const selected = plugin('1.0.0');
    const unused = plugin('2.0.0');
    const prototype = createChartLayer();
    const duplicate = createChartLayer();
    for (const layer of [prototype, duplicate]) selectProvider(layer, selected);
    composition.layers = [prototype, duplicate];
    composition.rendererPlugins = [unused, selected];
    composition.runtimeCollections = [
      {
        id: 'collection',
        name: 'Rows',
        fieldId: 'field',
        prototypeLayerIds: [prototype.id],
        offsetPerItem: { x: 0, y: 100 },
        capacity: 10,
        overflow: 'truncate',
      },
    ];
    expect(requiredProjectRendererPlugins(project)).toEqual([selected]);
  });

  it('does not compile the scene or throw on unrelated invalid data and malformed review metadata', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const selected = plugin('1.0.0');
    const layer = createChartLayer();
    selectProvider(layer, selected);
    composition.layers = [layer];
    composition.frameRate = NaN;
    composition.rendererPlugins = [
      { ...selected, manifest: null } as unknown as RendererPluginSnapshot,
      selected,
    ];
    expect(requiredProjectRendererPlugins(project)).toEqual([selected]);
  });
});

it('does not require an installed shader pack for an independently copied paint', () => {
  const pack = createShaderPackPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'shader-pack',
      id: 'example.shaders',
      version: '1.0.0',
      name: 'Shaders',
      license: 'CC0-1.0',
    },
    shaders: [{ id: '01', name: 'One', targets: ['fill'], paint: createShaderPaint() }],
    licenseText: 'CC0 fixture',
  });
  const project = createProject(),
    layer = createRectangleLayer();
  if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle');
  layer.element.fill = resolveShaderPackPresetPaint(pack, '01', 'fill');
  project.compositions[0]!.layers = [layer];
  expect(requiredProjectStudioPlugins(project)).toEqual([]);
});

it('offers exact saved animation packs for restoration without requiring runtime code', () => {
  const project = createProject(),
    composition = project.compositions[0]!;
  const pack = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'example.motion',
      version: '1.0.0',
      name: 'Motion',
      license: 'MIT',
    },
    presets: [
      {
        id: 'fade',
        name: 'Fade',
        tracks: {
          in: [
            {
              property: 'opacity',
              mode: 'factor',
              keys: [
                { at: 0, value: 0 },
                { at: 1, value: 'on-air' },
              ],
            },
          ],
        },
      },
    ],
    licenseText: 'MIT',
  });
  const layer = createChartLayer();
  layer.animationPresets = {
    in: {
      reference: { ...pack.manifest, sha256: pack.sha256 },
      presetId: 'fade',
      durationFrames: 10,
      parameters: {},
    },
  };
  composition.components = [{ id: 'saved', name: 'Saved', dataFields: [], layers: [layer] }];
  composition.animationPresetPlugins = [pack];
  expect(requiredProjectStudioPlugins(project)).toEqual([pack]);
  expect(requiredProjectRendererPlugins(project)).toEqual([]);
});
