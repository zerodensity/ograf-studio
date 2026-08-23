import { describe, expect, it } from 'vitest';
import { createProject } from './factory';
import { computeKeyframeFrames } from './keyframeTiming';
import { getLayerTransformAtFrame } from './layerAnimation';
import { materializeLowerThird } from './semanticRecipes';

describe('semantic authoring recipes', () => {
  it('materializes a portable editable lower third with a clipped wipe by default', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const result = materializeLowerThird(composition, {
      name: 'News',
      placement: { x: 140, y: 760, width: 1120, height: 170 },
      content: { headline: 'City council approves plan', subheadline: 'Live · Istanbul' },
      fieldKeys: { headline: 'story_headline', subheadline: 'story_location' },
    });

    expect(composition.layers).toHaveLength(4);
    expect(composition.dataFields.map((field) => field.key)).toEqual([
      'story_headline',
      'story_location',
    ]);
    expect(composition.layout.timelineFolders[0]).toMatchObject({
      id: result.timelineGroupId,
      name: 'News',
      layerIds: Object.values(result.layers),
    });
    expect(composition.layers.map((layer) => layer.semantics.role)).toEqual([
      'container',
      'accent',
      'headline',
      'subheadline',
    ]);
    expect(composition.layers.every((layer) => layer.groupId === result.groupId)).toBe(true);

    const frames = computeKeyframeFrames(composition);
    const frameForRole = (role: 'start' | 'step' | 'end') => {
      const id = composition.keyframes.find((item) => item.role === role)!.id;
      return frames.find((item) => item.keyframeId === id)!.frame;
    };
    const start = frameForRole('start');
    const step = frameForRole('step');
    const end = frameForRole('end');
    const panel = composition.layers.find((layer) => layer.id === result.layers.panel)!;
    expect(getLayerTransformAtFrame(panel, start)).toMatchObject({ x: 140, width: 1 });
    expect(getLayerTransformAtFrame(panel, step)).toMatchObject({ x: 140, y: 760 });
    expect(getLayerTransformAtFrame(panel, end).y).toBeGreaterThan(composition.height);
    expect(panel.clipChildren).toBe(true);
    expect(
      composition.layers
        .filter((layer) => layer.id !== panel.id)
        .every((layer) => layer.parentId === panel.id),
    ).toBe(true);
    expect(panel.animationTracks.width?.find((key) => key.frame === step)?.easing).toBe(
      'cubic-out',
    );
    expect(panel.animationTracks.y?.find((key) => key.frame === end)?.easing).toBe('cubic-in');
  });

  it('preserves directional lockstep translation as the explicit slide style', () => {
    const composition = createProject().compositions[0]!;
    const result = materializeLowerThird(composition, {
      placement: { x: 140, y: 760, width: 1120, height: 170 },
      motion: { style: 'slide', entrance: 'right', exit: 'up' },
    });
    const frames = computeKeyframeFrames(composition);
    const frameForRole = (role: 'start' | 'step' | 'end') => {
      const id = composition.keyframes.find((item) => item.role === role)!.id;
      return frames.find((item) => item.keyframeId === id)!.frame;
    };
    const panel = composition.layers.find((layer) => layer.id === result.layers.panel)!;
    expect(getLayerTransformAtFrame(panel, frameForRole('start')).x).toBeGreaterThan(
      composition.width,
    );
    expect(getLayerTransformAtFrame(panel, frameForRole('end')).y).toBeLessThan(0);
    expect(panel.clipChildren).toBe(false);
    expect(composition.layers.every((layer) => layer.parentId === null)).toBe(true);
  });

  it('authors a four-layer stagger cascade entirely before the first Step', () => {
    const composition = createProject().compositions[0]!;
    materializeLowerThird(composition, {
      placement: { x: 140, y: 760, width: 1120, height: 170 },
      motion: { style: 'stagger', staggerFrames: 3 },
    });
    const arrivals = composition.layers.map((layer) => {
      const onAirX = getLayerTransformAtFrame(layer, 12).x;
      return layer.animationTracks.x!.find(
        (key) => key.frame > 0 && key.frame <= 12 && key.value === onAirX,
      )!.frame;
    });
    expect(arrivals).toEqual([3, 6, 9, 12]);
    expect(
      composition.layers.every((layer) => layer.keyframes.every((key) => key.frame <= 24)),
    ).toBe(true);
  });

  it('authors no lifecycle motion for the none style', () => {
    const composition = createProject().compositions[0]!;
    materializeLowerThird(composition, { motion: { style: 'none' } });
    for (const layer of composition.layers) {
      const poses = [0, 12, 24].map((frame) => getLayerTransformAtFrame(layer, frame));
      expect(poses[1]).toEqual(poses[0]);
      expect(poses[2]).toEqual(poses[0]);
    }
  });

  it('rejects an oversized stagger atomically before adding layers or fields', () => {
    const composition = createProject().compositions[0]!;
    expect(() =>
      materializeLowerThird(composition, {
        motion: { style: 'stagger', staggerFrames: 4 },
      }),
    ).toThrow('Stagger cascade needs at least 14 entrance frames');
    expect(composition.layers).toEqual([]);
    expect(composition.dataFields).toEqual([]);
  });

  it('keeps generated field keys unique across multiple recipes', () => {
    const composition = createProject().compositions[0]!;
    materializeLowerThird(composition);
    materializeLowerThird(composition);
    expect(composition.dataFields.map((field) => field.key)).toEqual([
      'headline',
      'subheadline',
      'headline_2',
      'subheadline_2',
    ]);
  });
});
