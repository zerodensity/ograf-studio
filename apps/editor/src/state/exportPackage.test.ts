import { describe, expect, it, vi } from 'vitest';
import {
  createAsset,
  createFieldDefinition,
  createImageLayer,
  createLayerKeyframe,
  createLottieElement,
  createProject,
  lottiePlayerFrameAtTime,
} from '@ograf-editor/scene-model';
import { buildExportArtifacts, exportProjectAsZip } from './exportPackage';
import {
  certificationSeekTimestamps,
  canvasPixelSignatures,
  certifyExportArtifacts,
  certifyProject,
} from './ografCompatibility';

describe('canvas pixel certification', () => {
  function webglFixture() {
    const pixels = new Uint8ClampedArray([10, 20, 30, 255]);
    const drawImage = vi.fn();
    const snapshotContext = { drawImage, getImageData: () => ({ data: pixels }) };
    const snapshot = { width: 0, height: 0, getContext: vi.fn(() => snapshotContext) };
    const binding = {};
    const gl = {
      READ_FRAMEBUFFER_BINDING: 1,
      READ_FRAMEBUFFER: 2,
      RGBA: 3,
      UNSIGNED_BYTE: 4,
      NO_ERROR: 0,
      isContextLost: vi.fn(() => false),
      getParameter: vi.fn(() => binding),
      bindFramebuffer: vi.fn(),
      readPixels: vi.fn(
        (
          _x: number,
          _y: number,
          _w: number,
          _h: number,
          _format: number,
          _type: number,
          target: Uint8Array,
        ) => target.set(pixels),
      ),
      getError: vi.fn(() => 0),
    };
    const source = {
      width: 1,
      height: 1,
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? gl : null)),
      hasAttribute: (name: string): boolean => name === 'data-ograf-shader-canvas',
      ownerDocument: { createElement: vi.fn(() => snapshot) },
    };
    const graphic = {
      shadowRoot: { querySelectorAll: () => [source] },
    } as unknown as Parameters<typeof canvasPixelSignatures>[0];
    return { pixels, drawImage, source, graphic, gl, binding };
  }

  it('hashes exact preserved GPU bytes, restores read bindings and detects changed frames', async () => {
    const fixture = webglFixture();
    const first = await canvasPixelSignatures(fixture.graphic);
    const repeated = await canvasPixelSignatures(fixture.graphic);
    expect(first.errors).toEqual([]);
    expect(first.shaderCanvasCount).toBe(1);
    expect(first.signatures[0]).toMatch(/^1x1:[0-9a-f]{64}$/);
    expect(repeated.signatures).toEqual(first.signatures);
    expect(fixture.source.getContext).toHaveBeenCalledWith('webgl2');
    expect(fixture.drawImage).not.toHaveBeenCalled();
    expect(fixture.gl.bindFramebuffer).toHaveBeenLastCalledWith(
      fixture.gl.READ_FRAMEBUFFER,
      fixture.binding,
    );

    fixture.pixels[0] = 11;
    const changed = await canvasPixelSignatures(fixture.graphic);
    expect(changed.signatures).not.toEqual(first.signatures);
  });

  it('does not count a shader whose pixels cannot be inspected', async () => {
    const fixture = webglFixture();
    fixture.gl.readPixels.mockImplementation(() => {
      throw new Error('Drawing buffer unavailable');
    });
    const result = await canvasPixelSignatures(fixture.graphic);
    expect(result.signatures).toEqual([]);
    expect(result.shaderCanvasCount).toBe(0);
    expect(result.errors).toEqual([
      'Canvas 1 pixels could not be inspected: Drawing buffer unavailable',
    ]);
  });
  it('rejects lost contexts and GPU read errors instead of certifying blank pixels', async () => {
    const fixture = webglFixture();
    fixture.gl.isContextLost.mockReturnValue(true);
    expect((await canvasPixelSignatures(fixture.graphic)).shaderCanvasCount).toBe(0);
    fixture.gl.isContextLost.mockReturnValue(false);
    fixture.gl.getError.mockReturnValue(1282);
    const failed = await canvasPixelSignatures(fixture.graphic);
    expect(failed.shaderCanvasCount).toBe(0);
    expect(failed.errors[0]).toContain('WebGL error 1282');
    expect(fixture.gl.bindFramebuffer).toHaveBeenLastCalledWith(
      fixture.gl.READ_FRAMEBUFFER,
      fixture.binding,
    );
  });
  it('freezes all canvas bytes before hashing can yield to another render', async () => {
    const first = webglFixture(),
      second = webglFixture();
    const expected = (await canvasPixelSignatures(first.graphic)).signatures[0];
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, data) => {
      queueMicrotask(() => {
        second.pixels[0] = 99;
      });
      return digest(algorithm, data);
    });
    try {
      const graphic = {
        shadowRoot: { querySelectorAll: () => [first.source, second.source] },
      } as unknown as Parameters<typeof canvasPixelSignatures>[0];
      expect((await canvasPixelSignatures(graphic)).signatures).toEqual([expected, expected]);
    } finally {
      spy.mockRestore();
    }
  });
  it('still reads ordinary Canvas2D artwork through a separate canvas', async () => {
    const fixture = webglFixture();
    fixture.source.hasAttribute = () => false;
    const result = await canvasPixelSignatures(fixture.graphic);
    expect(result.signatures).toHaveLength(1);
    expect(result.shaderCanvasCount).toBe(0);
    expect(fixture.source.getContext).not.toHaveBeenCalled();
    expect(fixture.drawImage).toHaveBeenCalledWith(fixture.source, 0, 0);
  });
});

describe('export package artifacts', () => {
  it('chooses a non-period-aligned Canvas seek for a one-second Lottie loop', () => {
    const lottie = createLottieElement({
      animationData: { v: '5.13.0', fr: 30, ip: 5, op: 35, w: 100, h: 100, layers: [] },
    });
    const timestamps = certificationSeekTimestamps([lottie]);
    expect(timestamps.exercisesAllLotties).toBe(true);
    expect(timestamps.rewind).not.toBe(2_000);
    expect(lottiePlayerFrameAtTime(lottie, timestamps.target)).not.toBe(
      lottiePlayerFrameAtTime(lottie, timestamps.rewind),
    );
  });

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
    expect(artifacts.mainJs).toContain('new URL(value, exportedModuleBaseUrl)');
  });

  it('resolves every relative packaged font path against the exported module', () => {
    const project = createProject();
    const artifacts = buildExportArtifacts(project, project.compositions[0]!);
    expect(artifacts.mainJs).toContain('font.source = exportedRelativeResourceUrl(font.source)');
    expect(artifacts.mainJs).not.toContain("font.source?.startsWith('assets/')");
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
