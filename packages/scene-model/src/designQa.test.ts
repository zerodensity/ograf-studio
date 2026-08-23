import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createLayerOfKind,
  getLayerTransformAtFrame,
  materializeLowerThird,
  reviewCompositionDesign,
} from './index';

describe('design and motion QA', () => {
  it('reports semantic coverage and lifecycle motion with stable layer references', () => {
    const composition = createComposition();
    const lowerThird = materializeLowerThird(composition);
    const stray = createLayerOfKind('text');
    stray.name = 'Unbound note';
    stray.keyframes = composition.keyframes.map((_, index) => ({
      id: `note-${index}`,
      frame: index * 12,
      easing: 'linear' as const,
      transform: {
        ...getLayerTransformAtFrame(composition.layers[0]!, index * 12),
        x: 100,
        y: 100,
        width: 300,
        height: 40,
        opacity: 1,
      },
    }));
    composition.layers.push(stray);

    const report = reviewCompositionDesign(composition);
    expect(report.metrics.semanticCoverage).toBeGreaterThan(0.5);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `semantics.missing-role.${stray.id}`,
          layerIds: [stray.id],
        }),
        expect.objectContaining({
          id: `motion.no-exit.${stray.id}`,
          category: 'motion',
        }),
      ]),
    );
    expect(report.previewFrames).toHaveLength(3);
    expect(
      report.findings.some((finding) => finding.layerIds.includes(lowerThird.layers.panel)),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          finding.id.startsWith('motion.no-entrance') &&
          Object.values(lowerThird.layers).some((layerId) => finding.layerIds.includes(layerId)),
      ),
    ).toBe(false);
  });
});
