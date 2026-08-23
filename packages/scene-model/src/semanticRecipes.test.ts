import { describe, expect, it } from 'vitest';
import { createProject } from './factory';
import { computeKeyframeFrames } from './keyframeTiming';
import { getLayerTransformAtFrame } from './layerAnimation';
import { materializeLowerThird } from './semanticRecipes';

describe('semantic authoring recipes', () => {
  it('materializes a portable editable lower third with semantic roles and lifecycle motion', () => {
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
    expect(getLayerTransformAtFrame(panel, start).x).toBeLessThan(0);
    expect(getLayerTransformAtFrame(panel, step)).toMatchObject({ x: 140, y: 760 });
    expect(getLayerTransformAtFrame(panel, end).y).toBeGreaterThan(composition.height);
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
