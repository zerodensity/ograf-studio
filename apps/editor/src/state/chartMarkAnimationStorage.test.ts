import { describe, expect, it } from 'vitest';
import {
  applyChartMarkAnimationPreset,
  computeKeyframeFrames,
  createAnimationPresetPluginSnapshot,
  createChartLayer,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createProject,
  createRendererPluginSnapshot,
  sampleChartMarkAnimations,
  studioPluginReference,
  type ChartElement,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
} from './projectSet';

function fixture() {
  const project = createProject({ name: 'Animated bars' });
  const composition = project.compositions[0]!;
  const chart = createChartLayer();
  chart.keyframes = computeKeyframeFrames(composition).map(({ frame }) =>
    createLayerKeyframe(frame, createDefaultTransform({ x: 100, y: 100, width: 640, height: 360 })),
  );
  chart.animationTracks.x = [
    createLayerPropertyKeyframe(0, 0),
    createLayerPropertyKeyframe(12, 100),
    createLayerPropertyKeyframe(24, 300),
  ];
  if (chart.element.type !== 'chart') throw new Error('Expected chart');
  const provider = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.portable-mark-renderer',
      version: '1.3.0',
      name: 'Portable mark renderer',
      license: 'MIT',
      presets: ['bar'],
      chartFeatures: ['mark-animation-v1'],
    },
    source: 'export default { apiVersion: 1, create() { throw new Error("Test source only"); } };',
    licenseText: 'MIT chart renderer fixture notice.',
  });
  chart.element.provider = studioPluginReference(provider);
  composition.rendererPlugins = [provider];
  composition.layers = [chart];
  const animationPack = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.portable-mark-motion',
      version: '1.0.0',
      name: 'Portable mark motion',
      license: 'MIT',
    },
    licenseText: 'MIT animation fixture notice retained exactly in editable source.',
    presets: [
      {
        id: 'move-fade',
        name: 'Move and fade',
        parameters: [{ id: 'distance', label: 'Distance', default: 40, min: 0, max: 200, step: 1 }],
        tracks: {
          in: [
            {
              property: 'x',
              mode: 'offset',
              keys: [
                { at: 0, value: { parameter: 'distance', multiplier: -1 } },
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
  });
  for (const side of ['in', 'out'] as const)
    applyChartMarkAnimationPreset(composition, chart, animationPack, 'move-fade', side, {
      durationFrames: 8,
      delayFrames: 1,
      staggerFrames: 1,
      parameters: { distance: 60 },
    });
  return createProjectSet('Portable chart motion', project);
}

describe('chart mark animation source portability', () => {
  it.each(['compact', 'compatible'] as const)(
    'round-trips %s source pins and choices while recompiling motion without local installation',
    async (archiveMode) => {
      const source = fixture();
      const before = structuredClone(source);
      const original = resolveProjectSetTemplate(source, source.templates[0]!.id).compositions[0]!;
      const expected = compileDescriptor(original);
      const archive = await createProjectSetArchive(source, { archiveMode });
      const opened = await openProjectSetArchive(new Uint8Array(await archive.arrayBuffer()));
      const reopened = resolveProjectSetTemplate(opened, opened.templates[0]!.id).compositions[0]!;
      const originalChart = original.layers[0]!,
        reopenedChart = reopened.layers[0]!;
      expect(source).toEqual(before);
      expect(reopened.rendererPlugins).toEqual(original.rendererPlugins);
      expect(reopened.animationPresetPlugins).toEqual(original.animationPresetPlugins);
      expect(reopened.animationPresetPlugins).toHaveLength(1);
      expect((reopenedChart.element as ChartElement).provider).toEqual(
        (originalChart.element as ChartElement).provider,
      );
      expect((reopenedChart.element as ChartElement).markAnimations).toEqual(
        (originalChart.element as ChartElement).markAnimations,
      );
      expect((reopenedChart.element as ChartElement).animation).toEqual(
        (originalChart.element as ChartElement).animation,
      );
      expect(reopenedChart.keyframes).toEqual(originalChart.keyframes);
      expect(reopenedChart.animationTracks).toEqual(originalChart.animationTracks);
      expect(reopenedChart.motion).toEqual(originalChart.motion);
      // Compilation consumes the retained source definitions, not a machine installation store.
      const compiled = compileDescriptor(reopened);
      expect(compiled.layers[0]!.chartMarkAnimations).toEqual(
        expected.layers[0]!.chartMarkAnimations,
      );
      const marks = compiled.layers[0]!.chartMarkAnimations!;
      expect(sampleChartMarkAnimations(marks, 5, 0).x).toBe(-30);
      expect(sampleChartMarkAnimations(marks, 5, 1).x).toBe(-37.5);
      expect(sampleChartMarkAnimations(marks, 24, 999).opacity).toBe(0);
      expect(JSON.stringify(marks)).not.toContain('reference');
      expect(JSON.stringify(compiled)).not.toContain('MIT animation fixture notice');
    },
  );
});
