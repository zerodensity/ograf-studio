import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAsset,
  createComposition,
  createImageLayer,
  createProject,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { compileDescriptor } from './compileDescriptor';
import {
  buildExportArtifactsWithRuntime,
  EXPORTED_RESOURCE_URLS_KEY,
  generateMainJs,
} from './buildExportArtifacts';

const runtime = `class GraphicElement { load(params) { return params; } updateAction(params) { return params; } setActionsSchedule(params) { return params; } }`;
const paths = ['assets/icon.svg', 'frames/second.png', 'fonts/test.woff2'];
function descriptor() {
  const composition = createComposition({ layers: [createImageLayer()] });
  const compiled = compileDescriptor(composition);
  const image = compiled.layers[0]!;
  if (image.element.type !== 'image') throw new Error('Expected image');
  image.element.src = paths[0]!;
  image.bindings = [{ dataKey: 'image', targetProperty: 'src' }];
  compiled.layers.push({
    ...structuredClone(image),
    id: 'sequence',
    bindings: [],
    element: { type: 'image-sequence', frames: [paths[0]!, paths[1]!], fps: 25, loop: true },
  });
  compiled.fonts = [{ family: 'Test', source: paths[2]!, mimeType: 'font/woff2' }];
  compiled.collections = [
    {
      id: 'collection',
      name: 'Items',
      dataKey: 'items',
      capacity: 2,
      overflow: 'truncate',
      offsetPerItem: { x: 0, y: 0 },
      prototypeLayers: [
        {
          ...structuredClone(image),
          id: 'prototype',
          bindings: [{ dataKey: 'items', sourcePath: ['icon'], targetProperty: 'src' }],
        },
      ],
    },
  ];
  return compiled;
}
function evaluate(
  moduleUrl: string,
  compiled = descriptor(),
  resourcePaths: readonly string[] = paths,
) {
  const source = generateMainJs(compiled, runtime, resourcePaths)
    .replaceAll('import.meta.url', JSON.stringify(moduleUrl))
    .replace('export default ExportedGraphic;', 'return ExportedGraphic;');
  return new Function(source)() as {
    new (): {
      load(params: { data: Record<string, unknown> }): { data: Record<string, unknown> };
      updateAction(params: { data: Record<string, unknown> }): { data: Record<string, unknown> };
      setActionsSchedule(params: unknown): {
        schedule: Array<{ action: { params: { data: Record<string, unknown> } } }>;
      };
    };
    descriptor: CompiledGraphicDescriptor;
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('exported package resource resolution', () => {
  it('retains PR8 resolution for every relative font path without depending on resource enumeration', () => {
    vi.stubGlobal('document', { baseURI: 'https://wrong.example/editor/' });
    const compiled = descriptor();
    compiled.fonts = [
      'fonts/Unlisted.ttf',
      '../shared/Other.woff2',
      '/fonts/Root.otf',
      '//cdn.example/Protocol.woff2',
      'https://cdn.example/Absolute.woff2',
      'data:font/woff2;base64,d09GMg==',
      'blob:https://editor.example/existing-font',
    ].map((source) => ({ family: 'Custom', source, mimeType: 'font/woff2' }));
    const Graphic = evaluate('https://renderer.example/packages/graphic/main.js', compiled, []);
    expect(Graphic.descriptor.fonts?.map((font) => font.source)).toEqual([
      'https://renderer.example/packages/graphic/fonts/Unlisted.ttf',
      'https://renderer.example/packages/shared/Other.woff2',
      'https://renderer.example/fonts/Root.otf',
      'https://cdn.example/Protocol.woff2',
      'https://cdn.example/Absolute.woff2',
      'data:font/woff2;base64,d09GMg==',
      'blob:https://editor.example/existing-font',
    ]);
  });

  it('uses the exact blob resource map for custom font paths and fails when their bytes are absent', () => {
    const compiled = descriptor();
    compiled.layers = [];
    compiled.collections = [];
    compiled.fonts = [{ family: 'Custom', source: 'fonts/Brand.ttf', mimeType: 'font/ttf' }];
    const moduleUrl = 'blob:https://editor.example/font-module';
    expect(() => evaluate(moduleUrl, compiled, [])).toThrow('fonts/Brand.ttf');
    vi.stubGlobal(EXPORTED_RESOURCE_URLS_KEY, {
      [moduleUrl]: { 'fonts/Brand.ttf': 'blob:https://editor.example/exact-font-bytes' },
    });
    expect(evaluate(moduleUrl, compiled, []).descriptor.fonts?.[0]?.source).toBe(
      'blob:https://editor.example/exact-font-bytes',
    );
  });

  it('resolves image, sequence, collection and custom font paths against the module URL', () => {
    vi.stubGlobal('document', { baseURI: 'https://wrong.example/editor/' });
    const Graphic = evaluate('https://renderer.example/packages/graphic/main.js');
    const compiled = Graphic.descriptor;
    expect(compiled.layers[0]!.element).toMatchObject({
      src: 'https://renderer.example/packages/graphic/assets/icon.svg',
    });
    expect(compiled.layers[1]!.element).toMatchObject({
      frames: [
        'https://renderer.example/packages/graphic/assets/icon.svg',
        'https://renderer.example/packages/graphic/frames/second.png',
      ],
    });
    expect(compiled.collections![0]!.prototypeLayers[0]!.element).toMatchObject({
      src: 'https://renderer.example/packages/graphic/assets/icon.svg',
    });
    expect(compiled.fonts![0]!.source).toBe(
      'https://renderer.example/packages/graphic/fonts/test.woff2',
    );
  });

  it('normalizes only image-bound data and schedules without changing text or caller data', () => {
    const Graphic = evaluate('https://renderer.example/package/main.js');
    const graphic = new Graphic();
    const data = {
      image: 'assets/icon.svg',
      headline: 'assets/icon.svg',
      items: [{ icon: 'frames/second.png', caption: 'frames/second.png' }],
    };
    const expected = {
      image: 'https://renderer.example/package/assets/icon.svg',
      headline: 'assets/icon.svg',
      items: [
        {
          icon: 'https://renderer.example/package/frames/second.png',
          caption: 'frames/second.png',
        },
      ],
    };
    expect(graphic.load({ data }).data).toEqual(expected);
    expect(graphic.updateAction({ data }).data).toEqual(expected);
    expect(
      graphic.setActionsSchedule({
        schedule: [{ timestamp: 100, action: { type: 'updateAction', params: { data } } }],
      }).schedule[0]!.action.params.data,
    ).toEqual(expected);
    expect(data.image).toBe('assets/icon.svg');
    expect(data.items[0]!.icon).toBe('frames/second.png');
  });

  it('requires an explicit per-module exact-resource map when imported from a blob', () => {
    const moduleUrl = 'blob:https://editor.example/cert-module';
    expect(() => evaluate(moduleUrl)).toThrow('Packaged resource is unavailable');
    vi.stubGlobal(EXPORTED_RESOURCE_URLS_KEY, {
      [moduleUrl]: Object.fromEntries(
        paths.map((path, index) => [path, `blob:https://editor.example/resource-${index}`]),
      ),
    });
    const Graphic = evaluate(moduleUrl);
    expect(Graphic.descriptor.layers[0]!.element).toMatchObject({
      src: 'blob:https://editor.example/resource-0',
    });
    expect(new Graphic().updateAction({ data: { image: 'assets/icon.svg' } }).data.image).toBe(
      'blob:https://editor.example/resource-0',
    );
  });

  it('packages percent-encoded SVG as decoded UTF-8 bytes with its MIME type at a custom path', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>ö</title></svg>';
    const asset = createAsset({
      name: 'SVG',
      mimeType: 'image/svg+xml',
      dataUri: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      packagePath: 'artwork/custom.resource',
    });
    composition.assets.push(asset);
    const image = createImageLayer();
    if (image.element.type !== 'image') throw new Error('Expected image');
    image.element.src = `asset:${asset.id}`;
    composition.layers.push(image);
    const artifacts = buildExportArtifactsWithRuntime(project, composition, runtime);
    expect(artifacts.resources).toContainEqual({
      path: 'artwork/custom.resource',
      data: svg,
      base64: false,
      mimeType: 'image/svg+xml',
    });
    expect(artifacts.mainJs).toContain('artwork/custom.resource');
  });
});
