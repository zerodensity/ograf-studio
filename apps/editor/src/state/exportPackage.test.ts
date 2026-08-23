import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createFieldDefinition,
  createImageLayer,
  createLayerKeyframe,
  createProject,
} from '@ograf-editor/scene-model';
import { buildExportArtifacts, exportProjectAsZip } from './exportPackage';
import { certifyExportArtifacts, certifyProject } from './ografCompatibility';

describe('export package artifacts', () => {
  it('extracts and deduplicates data URIs instead of embedding asset bytes in main.js', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const first = createImageLayer();
    const second = createImageLayer();
    if (first.element.type !== 'image' || second.element.type !== 'image') {
      throw new Error('Image layer factory returned the wrong element type.');
    }
    first.element.src = dataUri;
    second.element.src = dataUri;
    for (const layer of [first, second]) {
      layer.keyframes = composition.keyframes.map((keyframe, index) =>
        createLayerKeyframe(index * 12, {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: keyframe.role === 'step' ? 1 : 0,
          transformOriginX: 0.5,
          transformOriginY: 0.5,
        }),
      );
    }
    composition.layers.push(first, second);

    const artifacts = buildExportArtifacts(project, composition);
    expect(artifacts.valid).toBe(true);
    expect(artifacts.resources).toHaveLength(1);
    expect(artifacts.manifestFileName).toBe(`${project.id}.ograf.json`);
    expect(artifacts.mainJs).not.toContain(dataUri);
    expect(artifacts.mainJs).toContain('new URL(layer.element.src, exportedModuleBaseUrl)');
  });

  it('packages asset references once across elements and image-url field defaults', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const asset = createAsset({
      name: 'Weather icon',
      mimeType: 'image/svg+xml',
      dataUri: 'data:image/svg+xml;base64,PHN2Zy8+',
    });
    composition.assets.push(asset);
    const layer = createImageLayer();
    if (layer.element.type !== 'image') throw new Error('Expected an image layer.');
    layer.element.src = `asset:${asset.id}`;
    layer.keyframes = composition.keyframes.map((_, index) =>
      createLayerKeyframe(index * 12, {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    );
    composition.layers.push(layer);
    composition.dataFields.push(
      createFieldDefinition('image-url', {
        key: 'weather_icon',
        defaultValue: `asset:${asset.id}`,
      }),
    );

    const artifacts = buildExportArtifacts(project, composition);
    expect(artifacts.errors).toEqual([]);
    expect(artifacts.resources).toEqual([
      expect.objectContaining({ path: `assets/${asset.id}.svg`, base64: true }),
    ]);
    expect(artifacts.mainJs).not.toContain(`asset:${asset.id}`);
    const properties = artifacts.manifest.schema?.properties as Record<string, unknown> | undefined;
    expect(properties?.weather_icon).toMatchObject({
      default: `assets/${asset.id}.svg`,
    });
  });

  it('deduplicates identical resources and packages custom paths plus font license text', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const dataUri = 'data:font/woff2;base64,d09GMg==';
    composition.assets.push(
      createAsset({
        name: 'Rubik Regular',
        kind: 'font',
        mimeType: 'font/woff2',
        dataUri,
        fontFamily: 'Rubik',
        fontWeight: '400',
        packagePath: 'fonts/rubik-regular.woff2',
        licenseText: 'OFL test license',
      }),
      createAsset({
        name: 'Duplicate bytes',
        kind: 'font',
        mimeType: 'font/woff2',
        dataUri,
        fontFamily: 'Rubik Duplicate',
      }),
    );

    const artifacts = buildExportArtifacts(project, composition);

    expect(artifacts.resources).toEqual([
      expect.objectContaining({ path: 'fonts/rubik-regular.woff2' }),
      expect.objectContaining({
        path: expect.stringMatching(/^licenses\/.+-LICENSE\.txt$/),
        data: 'OFL test license',
        base64: false,
      }),
    ]);
  });

  it('blocks packaging before invoking a save flow when validation fails', async () => {
    const project = createProject({ name: '' });
    await expect(exportProjectAsZip(project, project.compositions[0]!)).rejects.toThrow(
      /Export blocked/,
    );
  });

  it('fails certification before browser execution for an unsafe package path', async () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const artifacts = buildExportArtifacts(project, composition);
    artifacts.resources.push({ path: '../outside.png', data: '', base64: true });

    const result = await certifyExportArtifacts(artifacts);
    expect(result.valid).toBe(false);
    expect(result.checks.find((check) => check.id === 'package')?.errors.join(' ')).toMatch(
      /safe relative URL/,
    );
    expect(result.checks.find((check) => check.id === 'module')?.valid).toBe(false);
  });

  it('rejects a project whose main composition reference is broken', async () => {
    const project = createProject({ mainCompositionId: 'missing' });
    const result = await certifyProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/mainCompositionId/);
  });
});
