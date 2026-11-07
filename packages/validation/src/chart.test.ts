import { describe, expect, it } from 'vitest';
import {
  createChartLayer,
  createFieldDefinition,
  createProject,
  computeKeyframeFrames,
  defaultTransformForRole,
  createLayerKeyframe,
  type ChartAnimation,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

describe('chart project validation', () => {
  it('accepts a chart and catches malformed datasets', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createChartLayer();
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('chart', keyframe.role),
      ),
    );
    composition.layers.push(layer);
    expect(validateProject(project).errors).toEqual([]);
    if (layer.element.type !== 'chart') throw new Error('Expected chart');
    layer.element.data.datasets[0]!.data = [1];
    expect(validateProject(project).errors.join(' ')).toContain('one finite number per label');
  });

  it('rejects malformed default data on a chart binding', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createChartLayer();
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('chart', keyframe.role),
      ),
    );
    const field = createFieldDefinition('textarea', { key: 'chart_data', defaultValue: '{bad' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'data' }];
    composition.layers.push(layer);
    composition.dataFields.push(field);
    expect(validateProject(project).errors.join(' ')).toContain('chart field default');
  });

  it.each([
    [{ type: 'spin' }, 'unknown type'],
    [{ durationFrames: 0 }, 'durationFrames'],
    [{ durationFrames: 1501 }, 'durationFrames'],
    [{ delayFrames: -1 }, 'delayFrames'],
    [{ delayFrames: 1501 }, 'delayFrames'],
    [{ staggerFrames: 101 }, 'staggerFrames'],
    [{ staggerFrames: 0.5 }, 'staggerFrames'],
    [{ easing: 'eval()' }, 'unknown easing'],
    [{ replayOnUpdate: 'true' }, 'must be a boolean'],
  ])('rejects invalid authored chart animation %j', (invalid, message) => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createChartLayer();
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('chart', keyframe.role),
      ),
    );
    composition.layers.push(layer);
    if (layer.element.type !== 'chart') throw new Error('Expected chart');
    layer.element.animation = { ...layer.element.animation, ...invalid } as ChartAnimation;
    expect(validateProject(project).errors.join(' ')).toContain(message);
  });

  it('accepts animation limits and older charts with no animation settings', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createChartLayer();
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('chart', keyframe.role),
      ),
    );
    composition.layers.push(layer);
    if (layer.element.type !== 'chart') throw new Error('Expected chart');
    layer.element.animation = {
      type: 'grow',
      durationFrames: 1500,
      delayFrames: 1500,
      staggerFrames: 100,
      easing: 'elastic-out',
      replayOnUpdate: true,
    };
    expect(validateProject(project).errors).toEqual([]);
    delete layer.element.animation;
    expect(validateProject(project).errors).toEqual([]);
  });
});
