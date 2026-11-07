import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAsset,
  createChartLayer,
  createDefaultGradient,
  createLayerKeyframe,
  createMediaPaint,
  createProject,
  createRendererPluginSnapshot,
  createShaderPaint,
  defaultTransformFor,
  type Paint,
} from '@ograf-editor/scene-model';
import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
} from '@ograf-editor/ograf-types';
import {
  buildExportArtifactsWithRuntime,
  EXPORTED_RESOURCE_URLS_KEY,
} from './buildExportArtifacts';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type CoordinatedExportInput,
} from './buildCoordinatedExportArtifacts';
const runtime = 'class GraphicElement {} class CoordinatedGraphicElement {}';
function fixture() {
  const project = createProject({ supportsNonRealTime: false }),
    composition = project.compositions[0]!,
    chart = createChartLayer();
  chart.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
  if (chart.element.type !== 'chart') throw Error('Expected chart');
  const provider = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version: '1.2.0',
      name: 'Chart paint export',
      presets: ['bar'],
      license: 'MIT',
      chartFeatures: ['mark-paint-v1'],
    },
    source: 'export default {};',
    licenseText: 'MIT test provider',
  });
  chart.element.provider = {
    id: provider.manifest.id,
    version: provider.manifest.version,
    sha256: provider.sha256,
  };
  composition.rendererPlugins = [provider];
  composition.layers = [chart];
  const input: CoordinatedExportInput = {
    id: 'chart-paint-set',
    name: 'Chart paint set',
    definition: {
      version: 4,
      id: 'chart-logic',
      name: 'Chart logic',
      defaultTransitionId: 'fade',
      slots: [{ id: 'main', name: 'Main', order: 0 }],
      states: [{ id: 'chart', name: 'Chart', slotId: 'main', templateId: 'chart' }],
      transitions: [
        {
          id: 'fade',
          name: 'Fade',
          durationFrames: 0,
          outgoingFrames: 0,
          incomingStartFrame: 0,
          incomingFrames: 0,
          sharedFrames: 0,
          easing: 'linear',
        },
      ],
      routes: [],
      sharedInstances: [],
      initialSharedValues: [],
    },
    templates: [{ id: 'chart', name: 'Chart', project }],
    componentAssets: [],
  };
  return { project, composition, chart, element: chart.element, provider, input };
}
function evaluate(mainJs: string, url: string, coordinated = false) {
  return new Function(
    mainJs
      .replaceAll('import.meta.url', JSON.stringify(url))
      .replace(
        `export default ${coordinated ? 'ExportedCoordinatedGraphic' : 'ExportedGraphic'};`,
        `return ${coordinated ? 'ExportedCoordinatedGraphic' : 'ExportedGraphic'};`,
      ),
  )() as {
    descriptor: CompiledGraphicDescriptor;
    transitionDescriptor: CompiledTransitionLogicDescriptor;
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('chart standard Paint export resources', () => {
  it('preserves custom chart easing in single and coordinated descriptors', () => {
    const { project, composition, element, input } = fixture();
    const curve = { x1: 0.8, y1: 0, x2: 1, y2: 0.2 };
    element.animation = { ...element.animation!, curve };
    const single = buildExportArtifactsWithRuntime(project, composition, runtime);
    const coordinated = buildCoordinatedExportArtifactsWithRuntime(input, runtime);
    expect(single.errors).toEqual([]);
    expect(coordinated.errors).toEqual([]);
    expect(single.descriptor!.layers[0]!.element).toMatchObject({ animation: { curve } });
    expect(
      coordinated.transitionDescriptor!.templates[0]!.descriptor.layers[0]!.element,
    ).toMatchObject({ animation: { curve } });
  });
  it.each([createDefaultGradient(), createShaderPaint()] as Paint[])(
    'preserves non-media chart paint through standalone and coordinated export',
    (fill) => {
      const { project, composition, element, input } = fixture();
      project.supportsNonRealTime = true;
      element.fill = fill;
      const source = structuredClone(input);
      const single = buildExportArtifactsWithRuntime(project, composition, runtime),
        set = buildCoordinatedExportArtifactsWithRuntime(input, runtime);
      expect(single.errors).toEqual([]);
      expect(set.errors).toEqual([]);
      expect(single.descriptor!.layers[0]!.element).toMatchObject({ fill });
      expect(set.transitionDescriptor!.templates[0]!.descriptor.layers[0]!.element).toMatchObject({
        fill,
      });
      expect(input).toEqual(source);
    },
  );
  it('packages chart MediaPaint clip bytes once and rewrites normal/blob URLs', () => {
    const { project, composition, element, input } = fixture();
    composition.assets.push(
      createAsset({
        id: 'chart-clip',
        name: 'Chart texture',
        kind: 'media',
        mimeType: 'video/mp4',
        dataUri: 'data:video/mp4;base64,AAAA',
      }),
    );
    element.fill = createMediaPaint({ source: { kind: 'clip', src: 'asset:chart-clip' } });
    for (const coordinated of [false, true]) {
      const result = coordinated
        ? buildCoordinatedExportArtifactsWithRuntime(input, runtime)
        : buildExportArtifactsWithRuntime(project, composition, runtime);
      expect(result.errors).toEqual([]);
      const path = `${coordinated ? 'templates/0/' : ''}assets/chart-clip.mp4`;
      expect(result.resources.filter((resource) => resource.path === path)).toEqual([
        { path, data: 'AAAA', base64: true, mimeType: 'video/mp4' },
      ]);
      const normal = evaluate(
        result.mainJs,
        'https://renderer.example/graphic/main.js',
        coordinated,
      );
      const descriptor = coordinated
        ? normal.transitionDescriptor.templates[0]!.descriptor
        : normal.descriptor;
      expect(descriptor.layers[0]!.element).toMatchObject({
        fill: { type: 'media', source: { src: `https://renderer.example/graphic/${path}` } },
      });
      const url = `blob:https://renderer.example/${coordinated ? 'set' : 'single'}`;
      vi.stubGlobal(EXPORTED_RESOURCE_URLS_KEY, {
        [url]: Object.fromEntries(
          result.resources.map((resource) => [
            resource.path,
            `blob:https://renderer.example/${encodeURIComponent(resource.path)}`,
          ]),
        ),
      });
      const blob = evaluate(result.mainJs, url, coordinated);
      const blobDescriptor = coordinated
        ? blob.transitionDescriptor.templates[0]!.descriptor
        : blob.descriptor;
      expect(blobDescriptor.layers[0]!.element).toMatchObject({
        fill: { source: { src: `blob:https://renderer.example/${encodeURIComponent(path)}` } },
      });
    }
  });
  it('packages live chart fallback images and declares the existing live media engine requirement', () => {
    const { project, composition, element, input } = fixture();
    composition.assets.push(
      createAsset({
        id: 'fallback',
        name: 'Fallback',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,YQ==',
      }),
    );
    element.fill = createMediaPaint({
      source: { kind: 'live', tag: 'camera-main', fallback: 'asset:fallback' },
    });
    for (const coordinated of [false, true]) {
      const result = coordinated
        ? buildCoordinatedExportArtifactsWithRuntime(input, runtime)
        : buildExportArtifactsWithRuntime(project, composition, runtime);
      expect(result.errors).toEqual([]);
      const descriptor = coordinated
        ? result.transitionDescriptor!.templates[0]!.descriptor
        : result.descriptor!;
      expect(descriptor.layers[0]!.element).toMatchObject({
        fill: { source: { fallback: `${coordinated ? 'templates/0/' : ''}assets/fallback.png` } },
      });
      expect(result.manifest.renderRequirements![0]!.engine).toContainEqual({
        type: 'ZeroDensityHTML',
        version: { min: '1.0' },
      });
    }
  });
  it('declares internet access for a chart media URL and rejects NRT media export', () => {
    const { project, composition, element, input } = fixture();
    element.fill = createMediaPaint({
      source: { kind: 'clip', src: 'https://example.com/texture.mp4' },
    });
    let single = buildExportArtifactsWithRuntime(project, composition, runtime),
      set = buildCoordinatedExportArtifactsWithRuntime(input, runtime);
    for (const result of [single, set]) {
      expect(result.valid, result.errors.join(' ')).toBe(true);
      expect(result.manifest.renderRequirements![0]!.accessToPublicInternet).toEqual({
        exact: true,
      });
    }
    project.supportsNonRealTime = true;
    single = buildExportArtifactsWithRuntime(project, composition, runtime);
    set = buildCoordinatedExportArtifactsWithRuntime(input, runtime);
    for (const result of [single, set]) expect(result.errors.join(' ')).toContain('real-time-only');
  });
});
