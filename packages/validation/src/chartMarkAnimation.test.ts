import { describe, expect, it } from 'vitest';
import {
  applyChartMarkAnimationPreset,
  createAnimationPresetPluginSnapshot,
  createChartLayer,
  createLayerKeyframe,
  createProject,
  createRendererPluginSnapshot,
  defaultTransformFor,
  studioPluginReference,
  type ChartElement,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  composition.transitions.forEach((transition) => {
    transition.durationFrames = 40;
  });
  const chart = createChartLayer();
  chart.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
  if (chart.element.type !== 'chart') throw Error('Expected chart');
  const provider = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version: '1.3.0',
      name: 'Mark provider',
      license: 'MIT',
      presets: ['bar', 'line'],
      chartFeatures: ['mark-animation-v1'],
    },
    source: 'export default {};',
    licenseText: 'MIT',
  });
  chart.element.provider = studioPluginReference(provider);
  composition.rendererPlugins = [provider];
  composition.layers = [chart];
  const plugin = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.mark-motion',
      version: '1.0.0',
      name: 'Mark motion',
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
        },
      },
    ],
    licenseText: 'MIT',
  });
  applyChartMarkAnimationPreset(composition, chart, plugin, 'fade', 'in', {
    durationFrames: 10,
    delayFrames: 2,
    staggerFrames: 3,
  });
  return { project, composition, chart, element: chart.element as ChartElement, provider, plugin };
}

describe('chart mark animation validation', () => {
  it('accepts exact pinned data-only packs and a capable renderer', () => {
    expect(validateProject(fixture().project).errors).toEqual([]);
  });
  it('rejects a legacy renderer without silently ignoring individual mark motion', () => {
    const { project, composition, provider, element } = fixture();
    const legacy = createRendererPluginSnapshot({
      ...provider,
      manifest: { ...provider.manifest, chartFeatures: [] },
    });
    element.provider = studioPluginReference(legacy);
    composition.rendererPlugins = [legacy];
    expect(validateProject(project).errors.join(' ')).toContain('mark-animation-v1');
  });
  it('rejects missing catalog pins, altered identities and timing overflow', () => {
    for (const failure of ['missing', 'digest', 'timing', 'plot'] as const) {
      const { project, composition, element } = fixture();
      if (failure === 'missing') composition.animationPresetPlugins = [];
      if (failure === 'digest') element.markAnimations!.in!.reference.sha256 = 'a'.repeat(64);
      if (failure === 'timing') element.markAnimations!.in!.staggerFrames = 100;
      if (failure === 'plot') element.preset = 'line';
      expect(validateProject(project).errors.join(' ')).toContain(
        failure === 'timing'
          ? 'must fit'
          : failure === 'plot'
            ? 'only on bars and slices'
            : 'exact pinned',
      );
    }
  });
});
