import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createComposition,
  createDefaultGradient,
  createLayerOfKind,
  createMediaPaint,
  createProject,
  createShaderPaint,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';

describe('portable composition background paints', () => {
  it('retains the legacy solid background without adding an exported object', () => {
    const composition = createComposition({ backgroundColor: '#112233' });
    const descriptor = compileDescriptor(composition);
    expect(descriptor.backgroundColor).toBe('#112233');
    expect(descriptor.layers).toEqual([]);
    expect(descriptor.paintOrder).toEqual([]);
  });

  it.each(['linear', 'radial', 'conic'] as const)(
    'exports an alpha-preserving %s background as the first ordinary rectangle',
    (kind) => {
      const foreground = createLayerOfKind('text');
      const composition = createComposition({
        backgroundColor: '#000000',
        backgroundPaint: createDefaultGradient(kind),
        backgroundStyleId: 'master-background',
        layers: [foreground],
      });
      const source = structuredClone(composition);
      const descriptor = compileDescriptor(composition);
      expect(descriptor.backgroundColor).toBe('transparent');
      expect(descriptor.layers).toHaveLength(2);
      expect(descriptor.layers[0]!.element).toMatchObject({
        type: 'rectangle',
        fill: {
          type: kind,
          stops: [{ opacity: 0.34 }, { opacity: 0.42 }],
        },
      });
      expect(descriptor.layers[1]!.id).toBe(foreground.id);
      expect(descriptor.paintOrder).toEqual([
        { type: 'layer', id: descriptor.layers[0]!.id },
        { type: 'layer', id: foreground.id },
      ]);
      expect(JSON.stringify(descriptor)).not.toContain('backgroundStyleId');
      expect(JSON.stringify(descriptor)).not.toContain('backgroundPaint');
      expect(composition).toEqual(source);
    },
  );

  it('does not put legacy opaque pixels behind a fully transparent paint', () => {
    const descriptor = compileDescriptor(
      createComposition({ backgroundColor: '#000000', backgroundPaint: 'transparent' }),
    );
    expect(descriptor.backgroundColor).toBe('transparent');
    expect(descriptor.layers[0]!.element).toMatchObject({ type: 'rectangle', fill: 'transparent' });
  });

  it('preserves a shader source, uniforms and clock settings in the ordinary layer path', () => {
    const paint = createShaderPaint({
      fragmentSource:
        '#pragma ograf gain slider min(0) max(1)\nconst float gain=0.5;\nvoid mainImage(out vec4 c,in vec2 p){c=vec4(gain, sin(iTime),0.0,0.5);}',
      speed: 2,
      resolutionScale: 0.5,
      parameters: { gain: 0.8 },
    });
    const composition = createComposition({ backgroundPaint: paint });
    const descriptor = compileDescriptor(composition);
    expect(descriptor.layers[0]!.element).toMatchObject({ type: 'rectangle', fill: paint });
    expect(descriptor.layers[0]!.bindings).toEqual([]);
    expect(composition.dataFields).toEqual([]);
    expect(compileDescriptor(composition)).toEqual(descriptor);
  });

  it('resolves and packages a Media background clip as a self-contained asset', () => {
    const project = createProject();
    project.supportsNonRealTime = false;
    const composition = project.compositions[0]!;
    composition.assets.push(
      createAsset({
        id: 'background-clip',
        name: 'Background clip',
        kind: 'media',
        mimeType: 'video/mp4',
        dataUri: 'data:video/mp4;base64,AAEC',
      }),
    );
    composition.backgroundPaint = createMediaPaint({
      source: { kind: 'clip', src: 'asset:background-clip' },
      fit: 'cover',
      offsetMs: 250,
      speed: 0.75,
    });
    const descriptor = compileDescriptor(composition);
    expect(descriptor.layers[0]!.element).toMatchObject({
      type: 'rectangle',
      fill: {
        type: 'media',
        source: { kind: 'clip', src: 'data:video/mp4;base64,AAEC' },
        offsetMs: 250,
        speed: 0.75,
      },
    });
    const artifacts = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
    );
    expect(artifacts.valid, artifacts.errors.join('\n')).toBe(true);
    expect(artifacts.descriptor!.layers[0]!.element).toMatchObject({
      type: 'rectangle',
      fill: { source: { kind: 'clip', src: 'assets/background-clip.mp4' } },
    });
    expect(artifacts.resources).toContainEqual(
      expect.objectContaining({ path: 'assets/background-clip.mp4', data: 'AAEC', base64: true }),
    );
  });

  it('keeps full-canvas coordinates and stable identity while output crops and dimensions change', () => {
    const composition = createComposition({
      width: 1280,
      height: 720,
      crop: { x: 160, y: 90, width: 960, height: 540 },
      backgroundPaint: '#112233',
    });
    const first = compileDescriptor(composition);
    expect(first.crop).toEqual(composition.crop);
    expect(first.layers[0]!.keyframes[0]!.transform).toMatchObject({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      opacity: 1,
    });
    composition.width = 1920;
    composition.height = 1080;
    const next = compileDescriptor(composition);
    expect(next.layers[0]!.id).toBe(first.layers[0]!.id);
    expect(next.layers[0]!.keyframes[0]!.transform).toMatchObject({ width: 1920, height: 1080 });
  });
});
