import { describe, expect, it } from 'vitest';
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
import { validateProject } from './validateProject';
function fixture(markPaint = true) {
  const project = createProject(),
    composition = project.compositions[0]!,
    chart = createChartLayer();
  chart.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
  if (chart.element.type !== 'chart') throw Error('Expected chart');
  const plugin = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version: markPaint ? '1.2.0' : '1.1.0',
      name: 'Chart paint test',
      presets: ['bar'],
      license: 'MIT',
      chartFeatures: markPaint ? ['mark-paint-v1'] : [],
    },
    source: 'export default {};',
    licenseText: 'MIT test provider',
  });
  chart.element.provider = {
    id: plugin.manifest.id,
    version: plugin.manifest.version,
    sha256: plugin.sha256,
  };
  composition.rendererPlugins = [plugin];
  composition.layers = [chart];
  return { project, composition, chart, element: chart.element };
}
describe('chart mark paint validation', () => {
  it('preserves legacy palette charts on an old provider but requires mark-paint-v1 for a fill override', () => {
    const { project, element } = fixture(false);
    expect(validateProject(project).errors).toEqual([]);
    element.fill = '#2676ef';
    expect(validateProject(project).errors.join(' ')).toContain('mark-paint-v1');
  });
  it.each(['#2676ef', 'transparent', createDefaultGradient(), createShaderPaint()] as Paint[])(
    'accepts standard supported chart fill %j',
    (fill) => {
      const { project, element } = fixture();
      element.fill = fill;
      expect(validateProject(project).errors).toEqual([]);
    },
  );
  it.each([
    '',
    { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000000', opacity: 1 }] },
    {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: '#000000', opacity: 1 },
        { offset: 1, color: '#ffffff', opacity: 2 },
      ],
    },
  ])('rejects malformed chart fill %j', (fill) => {
    const { project, element } = fixture();
    element.fill = fill as Paint;
    expect(validateProject(project).valid).toBe(false);
  });
  it('validates media source asset kind and keeps media fills real-time-only', () => {
    const { project, composition, element } = fixture();
    const clip = createAsset({
      id: 'clip',
      name: 'Clip',
      kind: 'media',
      mimeType: 'video/mp4',
      dataUri: 'data:video/mp4;base64,AAAA',
    });
    composition.assets.push(clip);
    element.fill = createMediaPaint({ source: { kind: 'clip', src: 'asset:clip' } });
    expect(validateProject(project).errors.join(' ')).toContain('real-time-only');
    project.supportsNonRealTime = false;
    expect(validateProject(project).errors).toEqual([]);
    clip.kind = 'image';
    clip.mimeType = 'image/png';
    expect(validateProject(project).errors.join(' ')).toContain('video media asset');
  });
  it('validates a media chart fill using the same fit/timing constraints as other layers', () => {
    const { project, element } = fixture();
    project.supportsNonRealTime = false;
    element.fill = {
      ...createMediaPaint({ source: { kind: 'clip', src: 'https://example.com/clip.mp4' } }),
      fit: 'invalid',
    } as unknown as Paint;
    expect(validateProject(project).errors.join(' ')).toContain('media fit is invalid');
  });
});
