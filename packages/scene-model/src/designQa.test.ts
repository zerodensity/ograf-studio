import { describe, expect, it } from 'vitest';
import {
  createAnimationTracksFromLegacyLayer,
  createComposition,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  getLayerTransformAtFrame,
  materializeLowerThird,
  reviewCompositionDesign,
  type Layer,
  type LayerTransform,
  type NewLayerKind,
} from './index';

function authoredLayer(
  kind: NewLayerKind,
  name: string,
  transforms: [LayerTransform, LayerTransform, LayerTransform],
  easing: 'cubic-in' | 'cubic-out' | 'linear' = 'linear',
): Layer {
  const layer = createLayerOfKind(kind);
  layer.name = name;
  layer.semantics.role = kind === 'text' ? 'label' : 'decorative';
  layer.keyframes = [
    createLayerKeyframe(0, transforms[0]),
    createLayerKeyframe(12, transforms[1], { easing }),
    createLayerKeyframe(24, transforms[2], { easing: 'cubic-in' }),
  ];
  layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
  return layer;
}

function staticTransform(overrides: Partial<LayerTransform>): LayerTransform {
  return createDefaultTransform({ opacity: 1, ...overrides });
}

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

  it('detects lockstep timing, missing stagger, and entrance easing in the wrong direction', () => {
    const composition = createComposition();
    const groupId = 'lockstep-group';
    composition.layers = [100, 300, 500].map((x, index) => {
      const layer = authoredLayer(
        'rectangle',
        `Lockstep ${index + 1}`,
        [
          staticTransform({ x: x - 300, y: 700 }),
          staticTransform({ x, y: 700 }),
          staticTransform({ x, y: 700 }),
        ],
        'cubic-in',
      );
      layer.groupId = groupId;
      return layer;
    });

    const report = reviewCompositionDesign(composition);
    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^motion\.lockstep\./),
        expect.stringMatching(/^motion\.no-stagger\./),
        expect.stringMatching(/^motion\.easing-direction\./),
      ]),
    );
  });

  it('keeps the default clipped wipe free of lockstep, no-stagger, and easing findings', () => {
    const composition = createComposition();
    materializeLowerThird(composition);
    const ids = reviewCompositionDesign(composition).findings.map((finding) => finding.id);
    expect(ids.some((id) => id.startsWith('motion.lockstep'))).toBe(false);
    expect(ids.some((id) => id.startsWith('motion.no-stagger'))).toBe(false);
    expect(ids.some((id) => id.startsWith('motion.easing-direction'))).toBe(false);
  });

  it('detects weak type hierarchy and near-miss text alignment with an optical opt-out', () => {
    const composition = createComposition();
    const result = materializeLowerThird(composition);
    const headline = composition.layers.find((layer) => layer.id === result.layers.headline)!;
    const subheadline = composition.layers.find((layer) => layer.id === result.layers.subheadline)!;
    if (headline.element.type !== 'text' || subheadline.element.type !== 'text') {
      throw new Error('Expected text layers.');
    }
    subheadline.element.fontSize = headline.element.fontSize / 1.1;
    for (const key of subheadline.animationTracks.x ?? []) key.value += 4;

    const findings = reviewCompositionDesign(composition).findings;
    expect(findings.some((finding) => finding.id.startsWith('typography.scale-ratio'))).toBe(true);
    expect(findings.some((finding) => finding.id.startsWith('layout.edge-alignment'))).toBe(true);

    subheadline.semantics.tags.push('optical-offset');
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('layout.edge-alignment'),
      ),
    ).toBe(false);
  });

  it('reports operator-editable on-air text without maxLength and accepts a declared limit', () => {
    const composition = createComposition();
    const result = materializeLowerThird(composition);
    const field = composition.dataFields.find(
      (candidate) => candidate.id === result.fields.headline,
    )!;
    delete field.constraints.maxLength;
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('data.missing-max-length'),
      ),
    ).toBe(true);
    field.constraints.maxLength = 80;
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('data.missing-max-length'),
      ),
    ).toBe(false);
  });

  it('detects discontinuous loop seams and accepts matching endpoints', () => {
    const composition = createComposition();
    const pose = staticTransform({ x: 100, y: 100 });
    const layer = authoredLayer('rectangle', 'Looping plate', [pose, pose, pose]);
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: {
        opacity: [createLayerPropertyKeyframe(0, 0.2), createLayerPropertyKeyframe(10, 1)],
      },
    });
    composition.layers = [layer];
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('loop.seam'),
      ),
    ).toBe(true);

    layer.semantics.tags.push('qa:allow-loop-seam');
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('loop.seam'),
      ),
    ).toBe(false);
    layer.semantics.tags = [];

    layer.loop.tracks.opacity![1]!.value = 0.2;
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('loop.seam'),
      ),
    ).toBe(false);
  });

  it('allows explicitly static text to stay outside the operator data model', () => {
    const composition = createComposition();
    const pose = staticTransform({ x: 100, y: 100, width: 100, height: 50 });
    const layer = authoredLayer('text', 'Static punctuation', [pose, pose, pose]);
    composition.layers = [layer];
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('data.unbound-text'),
      ),
    ).toBe(true);
    layer.semantics.tags.push('qa:static-text');
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('data.unbound-text'),
      ),
    ).toBe(false);
  });

  it('allows an intentional off-canvas layer when its semantic intent is explicit', () => {
    const composition = createComposition();
    const pose = staticTransform({ x: -100, y: 100, width: 200, height: 50 });
    const layer = authoredLayer('rectangle', 'Masked crawl segment', [pose, pose, pose]);
    composition.layers = [layer];
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('layout.outside'),
      ),
    ).toBe(true);
    layer.semantics.tags.push('qa:allow-offcanvas');
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('layout.outside'),
      ),
    ).toBe(false);
  });

  it('detects inconsistent sibling-container padding and accepts a shared rhythm', () => {
    const composition = createComposition();
    const firstContainerPose = staticTransform({ x: 100, y: 100, width: 200, height: 100 });
    const secondContainerPose = staticTransform({ x: 400, y: 100, width: 200, height: 100 });
    const firstContainer = authoredLayer('rectangle', 'Panel A', [
      firstContainerPose,
      firstContainerPose,
      firstContainerPose,
    ]);
    const secondContainer = authoredLayer('rectangle', 'Panel B', [
      secondContainerPose,
      secondContainerPose,
      secondContainerPose,
    ]);
    firstContainer.semantics.role = 'container';
    secondContainer.semantics.role = 'container';
    const firstChildPose = staticTransform({ x: 120, y: 120, width: 160, height: 60 });
    const secondChildPose = staticTransform({ x: 430, y: 120, width: 150, height: 60 });
    const firstChild = authoredLayer('rectangle', 'Content A', [
      firstChildPose,
      firstChildPose,
      firstChildPose,
    ]);
    const secondChild = authoredLayer('rectangle', 'Content B', [
      secondChildPose,
      secondChildPose,
      secondChildPose,
    ]);
    firstChild.parentId = firstContainer.id;
    secondChild.parentId = secondContainer.id;
    composition.layers = [firstContainer, firstChild, secondContainer, secondChild];
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('layout.padding-rhythm'),
      ),
    ).toBe(true);

    for (const key of secondChild.animationTracks.x ?? []) key.value = 420;
    for (const key of secondChild.animationTracks.width ?? []) key.value = 160;
    expect(
      reviewCompositionDesign(composition).findings.some((finding) =>
        finding.id.startsWith('layout.padding-rhythm'),
      ),
    ).toBe(false);
  });
});
