import { describe, expect, it } from 'vitest';
import {
  applyTypographyPresetBinding,
  computeKeyframeFrames,
  createAsset,
  createDefaultGradient,
  createDefaultTypographyPresets,
  createMediaPaint,
  createLayerKeyframe,
  createProject,
  createFieldDefinition,
  createRectangleLayer,
  createShaderPaint,
  createTextLayer,
  defaultTransformForRole,
  type BackgroundStyle,
  type Paint,
  type TypographyPreset,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  composition.designSystem.typography = createDefaultTypographyPresets();
  composition.designSystem.backgrounds = [
    { id: 'background', name: 'Background', paint: createDefaultGradient() },
  ];
  const layer = createTextLayer();
  layer.keyframes = composition.keyframes.map((keyframe, index) =>
    createLayerKeyframe(
      computeKeyframeFrames(composition)[index]!.frame,
      defaultTransformForRole('text', keyframe.role),
    ),
  );
  composition.layers.push(layer);
  applyTypographyPresetBinding(composition, layer, composition.designSystem.typography[0]!);
  composition.backgroundStyleId = 'background';
  composition.backgroundPaint = createDefaultGradient();
  return { project, composition, layer };
}

describe('combined Brand Kit style validation', () => {
  it('compares equivalent hex colors by value and retains warnings for real alpha changes', () => {
    const { project, composition } = fixture();
    composition.designSystem.tokens.push({
      id: 'color',
      key: 'ink',
      name: 'Ink',
      type: 'color',
      value: '#123A63',
      description: '',
    });
    const field = createFieldDefinition('color', {
      key: 'shader_color',
      defaultValue: '#123a63ff',
      defaultTokenId: 'color',
    });
    composition.dataFields.push(field);
    expect(validateProject(project).warnings.join(' ')).not.toContain(
      'Brand Kit default is out of sync',
    );
    field.defaultValue = '#123a6380';
    expect(validateProject(project).warnings.join(' ')).toContain(
      'Brand Kit default is out of sync',
    );
  });
  it('accepts materialized typography, valid local overrides and an independent gradient background', () => {
    const { project, composition, layer } = fixture();
    expect(validateProject(project).errors).toEqual([]);
    layer.typographyBinding!.overrides = ['fontSize', 'textAlign'];
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.fontSize = 80;
    layer.element.textAlign = 'right';
    composition.backgroundPaintOverridden = true;
    composition.backgroundPaint = createDefaultGradient('conic');
    expect(validateProject(project).errors).toEqual([]);
    composition.designSystem.defaultBackgroundStyleId = null;
    expect(validateProject(project).errors).toEqual([]);
  });

  it('rejects malformed typography catalogs and references without throwing', () => {
    for (const presets of [null, {}, [null], [{ id: 'bad', name: 'Bad', properties: {} }]]) {
      const { project, composition } = fixture();
      composition.designSystem.typography = presets as unknown as TypographyPreset[];
      expect(() => validateProject(project)).not.toThrow();
      expect(validateProject(project).valid).toBe(false);
    }
    const { project, composition, layer } = fixture();
    composition.designSystem.typography!.push(
      structuredClone(composition.designSystem.typography![0]!),
    );
    expect(validateProject(project).errors.join(' ')).toContain('Duplicate typography');
    composition.designSystem.typography!.pop();
    layer.typographyBinding!.presetId = 'missing';
    expect(validateProject(project).errors.join(' ')).toContain('missing preset');
  });

  it('rejects invalid binding metadata and typography links on non-text layers', () => {
    const { project, composition, layer } = fixture();
    layer.typographyBinding = {
      presetId: 'typography-headline',
      overrides: ['fontSize', 'fontSize'],
    };
    expect(validateProject(project).errors.join(' ')).toContain('Typography overrides');
    layer.typographyBinding = {
      presetId: 'typography-headline',
      extra: true,
    } as unknown as typeof layer.typographyBinding;
    expect(validateProject(project).errors.join(' ')).toContain('only presetId and overrides');
    layer.typographyBinding = null as unknown as typeof layer.typographyBinding;
    expect(validateProject(project).errors.join(' ')).toContain('binding must be an object');
    delete layer.typographyBinding;
    const rectangle = createRectangleLayer();
    rectangle.typographyBinding = { presetId: 'typography-headline' };
    composition.layers.push(rectangle);
    expect(validateProject(project).errors.join(' ')).toContain('only to text layers');
  });

  it('validates typography references inside reusable component snapshots', () => {
    const { project, composition, layer } = fixture();
    const componentLayer = structuredClone(layer);
    composition.components.push({
      id: 'headline-component',
      name: 'Headline',
      layers: [componentLayer],
      dataFields: [],
    });
    expect(validateProject(project).errors).toEqual([]);
    componentLayer.typographyBinding!.presetId = 'missing';
    expect(validateProject(project).errors.join(' ')).toContain('missing preset');
  });

  it('rejects malformed background catalog shapes and paints without crashing', () => {
    const gradient = createDefaultGradient();
    for (const styles of [
      null,
      {},
      [null],
      [{ id: 'bad', name: 'Bad', paint: null }],
      [{ id: 'bad', name: 'Bad', paint: { ...gradient, stops: [null, null] } }],
      [{ id: 'bad', name: 3, paint: '#ffffff' }],
      [{ id: 'bad', name: 'Bad', paint: '#ffffff', extra: true }],
    ]) {
      const { project, composition } = fixture();
      delete composition.backgroundStyleId;
      composition.designSystem.backgrounds = styles as unknown as BackgroundStyle[];
      expect(() => validateProject(project)).not.toThrow();
      expect(validateProject(project).valid).toBe(false);
    }
    const { project, composition } = fixture();
    composition.designSystem.backgrounds!.push(
      structuredClone(composition.designSystem.backgrounds![0]!),
    );
    expect(validateProject(project).errors.join(' ')).toContain('Duplicate background');
  });

  it('checks output and default background links plus explicit override flags', () => {
    const { project, composition } = fixture();
    composition.backgroundStyleId = 'missing';
    expect(validateProject(project).errors.join(' ')).toContain('missing');
    composition.backgroundStyleId = 'background';
    composition.backgroundPaintOverridden = 'true' as unknown as boolean;
    expect(validateProject(project).errors.join(' ')).toContain('override');
    composition.backgroundPaintOverridden = true;
    composition.designSystem.defaultBackgroundStyleId = 'missing';
    expect(validateProject(project).errors.join(' ')).toContain('missing');
  });

  it('rejects malformed output gradient paint safely even when the local background is overridden', () => {
    const { project, composition } = fixture();
    composition.backgroundPaintOverridden = true;
    composition.backgroundPaint = {
      type: 'linear',
      angle: 0,
      stops: [null, null],
    } as unknown as Paint;
    expect(() => validateProject(project)).not.toThrow();
    expect(validateProject(project).valid).toBe(false);
  });

  it('accepts shader output backgrounds under either render profile', () => {
    const { project, composition } = fixture();
    composition.backgroundPaint = createShaderPaint({
      fragmentSource: 'void mainImage(out vec4 c,in vec2 p){c=vec4(0.1,0.2,0.3,0.5);}',
    });
    expect(validateProject(project).errors).toEqual([]);
    project.supportsRealTime = false;
    expect(validateProject(project).errors).toEqual([]);
  });

  it('requires video clip assets and real-time-only profiles for Media output backgrounds', () => {
    const { project, composition } = fixture();
    const paint = createMediaPaint({ source: { kind: 'clip', src: 'asset:video' } });
    composition.backgroundPaint = paint;
    composition.designSystem.backgrounds = [{ id: 'background', name: 'Video', paint }];
    expect(validateProject(project).errors.join(' ')).toContain('missing asset');
    composition.assets.push(
      createAsset({
        id: 'video',
        kind: 'media',
        mimeType: 'video/mp4',
        dataUri: 'data:video/mp4;base64,AAAA',
      }),
    );
    expect(validateProject(project).errors.join(' ')).toContain('real-time-only');
    project.supportsNonRealTime = false;
    expect(validateProject(project).errors).toEqual([]);
    composition.assets[0]!.kind = 'image';
    composition.assets[0]!.mimeType = 'image/png';
    expect(validateProject(project).errors.join(' ')).toContain('wrong asset kind');
  });

  it('checks live fallback image assets for both catalog and output backgrounds', () => {
    const { project, composition } = fixture();
    project.supportsNonRealTime = false;
    const paint = createMediaPaint({
      source: { kind: 'live', tag: 'camera-1', fallback: 'asset:fallback' },
    });
    composition.backgroundPaint = paint;
    composition.designSystem.backgrounds = [{ id: 'background', name: 'Live', paint }];
    expect(validateProject(project).errors.join(' ')).toContain('missing asset');
    composition.assets.push(
      createAsset({
        id: 'fallback',
        kind: 'image',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,AAAA',
      }),
    );
    expect(validateProject(project).errors).toEqual([]);
    composition.assets[0]!.kind = 'media';
    composition.assets[0]!.mimeType = 'video/mp4';
    expect(validateProject(project).errors.join(' ')).toContain('wrong asset kind');
  });

  it('does not make an unused Media background catalog entry real-time-only', () => {
    const { project, composition } = fixture();
    composition.designSystem.backgrounds!.push({
      id: 'live-unused',
      name: 'Live unused',
      paint: createMediaPaint({ source: { kind: 'live', tag: 'camera-1' } }),
    });
    expect(validateProject(project).errors).toEqual([]);
  });
});
