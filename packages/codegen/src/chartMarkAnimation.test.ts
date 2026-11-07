import { describe, expect, it } from 'vitest';
import {
  applyChartMarkAnimationPreset,
  createAnimationPresetPluginSnapshot,
  createChartLayer,
  createLayerKeyframe,
  createProject,
  createRendererPluginSnapshot,
  defaultTransformFor,
  sampleChartMarkAnimations,
  studioPluginReference,
  type ChartElement,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  composition.transitions.forEach((transition) => {
    transition.durationFrames = 40;
  });
  const chart = createChartLayer();
  chart.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
  if (chart.element.type !== 'chart') throw Error('Expected chart');
  chart.element.animation = { ...chart.element.animation!, type: 'none' };
  const provider = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart-mark',
      version: '1.3.0',
      name: 'Mark provider',
      presets: ['bar'],
      chartFeatures: ['mark-animation-v1'],
      license: 'MIT',
    },
    source: 'export default {};',
    licenseText: 'MIT test',
  });
  chart.element.provider = studioPluginReference(provider);
  composition.rendererPlugins = [provider];
  composition.layers = [chart];
  const animation = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.mark-fade',
      version: '1.0.0',
      name: 'Mark fade',
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
              mode: 'absolute',
              keys: [
                { at: 0, value: 0 },
                { at: 1, value: 'on-air' },
              ],
            },
          ],
          out: [
            {
              property: 'opacity',
              mode: 'absolute',
              keys: [
                { at: 0, value: 'on-air' },
                { at: 1, value: 0 },
              ],
            },
          ],
        },
      },
    ],
    licenseText: 'MIT animation test',
  });
  for (const side of ['in', 'out'] as const)
    applyChartMarkAnimationPreset(composition, chart, animation, 'fade', side, {
      durationFrames: 10,
      delayFrames: 2,
      staggerFrames: 3,
    });
  return { project, composition, chart, provider };
}

describe('chart mark animation export', () => {
  it('compiles deterministic numeric curves once per side and keeps source tracks untouched', () => {
    const { composition, chart } = fixture();
    const source = structuredClone(composition);
    const descriptor = compileDescriptor(composition);
    const marks = descriptor.layers[0]!.chartMarkAnimations!;
    expect(marks.in).toMatchObject({
      startFrame: 2,
      durationFrames: 10,
      staggerFrames: 3,
      staggerSlots: 4,
    });
    expect(marks.out?.startFrame).toBe(42);
    expect(sampleChartMarkAnimations(marks, 7, 0).opacity).toBe(0.5);
    expect(sampleChartMarkAnimations(marks, 7, 1).opacity).toBe(0.2);
    expect(sampleChartMarkAnimations(marks, 80, 999).opacity).toBe(0);
    expect(descriptor.layers[0]!.keyframes).toEqual(chart.keyframes);
    expect(compileDescriptor(composition)).toEqual(descriptor);
    expect(composition).toEqual(source);
    expect(JSON.stringify(marks)).not.toContain('reference');
    expect(JSON.stringify(descriptor)).not.toContain('MIT animation test');
  });

  it('includes baked curves in the standalone portable module without an installed animation pack', () => {
    const { project, composition } = fixture();
    const output = buildExportArtifactsWithRuntime(project, composition, 'class GraphicElement {}');
    expect(output.errors).toEqual([]);
    expect(output.descriptor!.layers[0]!.chartMarkAnimations).toBeDefined();
    expect(output.mainJs).toContain('chartMarkAnimations');
    expect(output.mainJs).not.toContain('MIT animation test');
  });

  it('rejects missing pinned packs and overflowing staggered lifecycle timing before compilation', () => {
    const { composition, chart } = fixture();
    composition.animationPresetPlugins = [];
    expect(() => compileDescriptor(composition)).toThrow('exact pinned');
    delete (chart.element as ChartElement).markAnimations;
    expect(compileDescriptor(composition).layers[0]!.chartMarkAnimations).toBeUndefined();
  });
});
