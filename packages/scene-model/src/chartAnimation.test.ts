import { describe, expect, it } from 'vitest';
import { createChartElement, createChartLayer, createProject } from './factory';
import { migrateProject } from './migrations';
import {
  CHART_ANIMATION_EASINGS,
  DEFAULT_CHART_ANIMATION,
  chartAnimationProgress,
  chartAnimationErrors,
  chartAnimationWithPreset,
  normalizeChartAnimation,
} from './chartAnimation';

describe('chart animation model', () => {
  it('preserves and deterministically samples custom chart easing across migration and seeks', () => {
    const curve = { x1: 0.8, y1: 0, x2: 1, y2: 0.2 };
    const project = createProject(),
      layer = createChartLayer();
    if (layer.element.type !== 'chart') throw new Error('Expected chart');
    layer.element.animation = { ...DEFAULT_CHART_ANIMATION, easing: 'linear', curve };
    project.compositions[0]!.layers.push(layer);
    const saved = migrateProject(JSON.parse(JSON.stringify(project)));
    const restored = saved.compositions[0]!.layers[0]!.element;
    if (restored.type !== 'chart') throw new Error('Expected chart');
    expect(restored.animation?.curve).toEqual(curve);
    const midpoint = chartAnimationProgress(restored.animation, 12.5);
    expect(midpoint).toBeLessThan(0.5);
    expect(chartAnimationProgress(restored.animation, 20)).toBeGreaterThan(midpoint);
    expect(chartAnimationProgress(restored.animation, 12.5)).toBe(midpoint);
    expect(chartAnimationProgress(restored.animation, 0)).toBe(0);
    expect(chartAnimationProgress(restored.animation, 25)).toBe(1);
    expect(
      chartAnimationErrors({ ...DEFAULT_CHART_ANIMATION, curve: { ...curve, x1: 2 } }),
    ).toContain('Chart animation curve must contain x1, y1, x2 and y2 from 0 to 1.');
    expect(
      chartAnimationErrors({ ...DEFAULT_CHART_ANIMATION, curve: { x1: 0, y1: 0, x2: 1 } }),
    ).not.toEqual([]);
    expect(normalizeChartAnimation(DEFAULT_CHART_ANIMATION)).not.toHaveProperty('curve');
    expect(chartAnimationWithPreset(restored.animation!, 'bounce-out')).toMatchObject({
      easing: 'bounce-out',
    });
    expect(chartAnimationWithPreset(restored.animation!, 'bounce-out')).not.toHaveProperty('curve');
  });
  it('enables grow for newly authored charts while keeping pre-animation charts static', () => {
    expect(createChartElement().animation).toEqual(DEFAULT_CHART_ANIMATION);
    const project = createProject();
    const layer = createChartLayer();
    if (layer.element.type !== 'chart') throw new Error('Expected chart');
    delete layer.element.animation;
    project.compositions[0]!.layers.push(layer);

    const migrated = migrateProject(project).compositions[0]!.layers[0]!;
    expect(migrated.element.type === 'chart' && migrated.element.animation?.type).toBe('none');
    expect(layer.element.animation).toBeUndefined();
    expect(chartAnimationProgress(undefined, 0)).toBe(1);
  });

  it('normalizes persisted frame bounds without sharing mutable default objects', () => {
    expect(
      normalizeChartAnimation({
        type: 'reveal',
        durationFrames: 0,
        delayFrames: 1600,
        staggerFrames: 2.6,
        easing: 'sine-out',
        replayOnUpdate: false,
      }),
    ).toEqual({
      type: 'reveal',
      durationFrames: 1,
      delayFrames: 1500,
      staggerFrames: 3,
      easing: 'sine-out',
      replayOnUpdate: false,
    });
    expect(normalizeChartAnimation({ durationFrames: Number.NaN }).durationFrames).toBe(25);
    const first = createChartElement();
    first.animation!.durationFrames = 99;
    expect(createChartElement().animation?.durationFrames).toBe(25);
  });

  it('samples each data point from its delay and stagger with the authored easing', () => {
    const animation = {
      ...DEFAULT_CHART_ANIMATION,
      delayFrames: 5,
      staggerFrames: 3,
    };
    expect(chartAnimationProgress(animation, 10, 2)).toBe(0);
    expect(chartAnimationProgress(animation, 11, 2)).toBe(0);
    expect(chartAnimationProgress(animation, 23.5, 2)).toBeCloseTo(0.875);
    expect(chartAnimationProgress(animation, 36, 2)).toBe(1);
    expect(chartAnimationProgress(animation, 100, 2)).toBe(1);
    expect(chartAnimationProgress(animation, 23.5, 2)).toBe(
      chartAnimationProgress(animation, 23.5, 2),
    );
  });

  it('keeps exact endpoints for every easing and preserves expressive overshoot', () => {
    for (const easing of CHART_ANIMATION_EASINGS) {
      const animation = { ...DEFAULT_CHART_ANIMATION, easing };
      expect(chartAnimationProgress(animation, -1)).toBe(0);
      expect(chartAnimationProgress(animation, 0)).toBe(0);
      expect(chartAnimationProgress(animation, 25)).toBe(1);
      expect(Number.isFinite(chartAnimationProgress(animation, 12.5))).toBe(true);
    }
    expect(
      chartAnimationProgress({ ...DEFAULT_CHART_ANIMATION, easing: 'back-out' }, 20),
    ).toBeGreaterThan(1);
    expect(
      chartAnimationProgress({ ...DEFAULT_CHART_ANIMATION, easing: 'back-in' }, 5),
    ).toBeLessThan(0);
  });
});
