import { describe, expect, it, vi } from 'vitest';
import Chart from 'chart.js/auto';
import type { ChartConfiguration, ChartItem, Plugin } from 'chart.js';
import {
  chartAnimationProgress,
  normalizeChartAnimation,
  createChartElement,
  parseChartData,
  type ChartMarkPose,
  type ChartPreset,
} from '@ograf-editor/scene-model';
import { chartJsProvider } from './provider';

vi.mock('chart.js/auto', async (importOriginal) => {
  const original = await importOriginal<typeof import('chart.js/auto')>();
  const { BasicPlatform } = await import('chart.js');
  // BasicPlatform ordinarily disables reset flags; preserve the browser provider configuration.
  class FrameSamplingPlatform extends BasicPlatform {
    override updateConfig(): void {}
  }
  class FrameSamplingChart extends original.default {
    constructor(item: ChartItem, configuration: ChartConfiguration) {
      super(item, { ...configuration, platform: FrameSamplingPlatform });
    }
  }
  return { ...original, default: FrameSamplingChart };
});

function canvasFixture() {
  const calls: Array<{
    method: PropertyKey;
    args: unknown[];
    fillStyle: unknown;
    strokeStyle: unknown;
    globalAlpha: unknown;
    filter: unknown;
  }> = [];
  const canvas = {
    width: 640,
    height: 360,
    style: {},
    dataset: {},
  } as unknown as HTMLCanvasElement;
  const context = new Proxy(
    {
      canvas,
      globalAlpha: 1,
      filter: 'none',
      stack: [] as Array<Record<string, unknown>>,
      measureText: (value: string) => ({ width: value.length * 6 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
    },
    {
      get(target, property) {
        if (property === 'save')
          return () => {
            target.stack.push({
              globalAlpha: target.globalAlpha,
              filter: target.filter,
              fillStyle: Reflect.get(target, 'fillStyle'),
              strokeStyle: Reflect.get(target, 'strokeStyle'),
            });
            calls.push({
              method: property,
              args: [],
              fillStyle: Reflect.get(target, 'fillStyle'),
              strokeStyle: Reflect.get(target, 'strokeStyle'),
              globalAlpha: target.globalAlpha,
              filter: target.filter,
            });
          };
        if (property === 'restore')
          return () => {
            Object.assign(target, target.stack.pop());
            calls.push({
              method: property,
              args: [],
              fillStyle: Reflect.get(target, 'fillStyle'),
              strokeStyle: Reflect.get(target, 'strokeStyle'),
              globalAlpha: target.globalAlpha,
              filter: target.filter,
            });
          };
        if (property in target) return target[property as keyof typeof target];
        return (...args: unknown[]) => {
          calls.push({
            method: property,
            args,
            fillStyle: Reflect.get(target, 'fillStyle'),
            strokeStyle: Reflect.get(target, 'strokeStyle'),
            globalAlpha: target.globalAlpha,
            filter: target.filter,
          });
        };
      },
    },
  );
  canvas.getContext = (() => context) as unknown as typeof canvas.getContext;
  Object.assign(canvas, { calls });
  return canvas;
}
const canvasCalls = (canvas: HTMLCanvasElement) =>
  (
    canvas as unknown as {
      calls: Array<{
        method: PropertyKey;
        args: unknown[];
        fillStyle: unknown;
        strokeStyle: unknown;
        globalAlpha: unknown;
        filter: unknown;
      }>;
    }
  ).calls;

const hostAPI = {
  apiVersion: 1 as const,
  frameRate: 25,
  chartAnimationProgress,
  normalizeChartAnimation,
  chartAnimationEndFrame: () => 20,
};
const presets: ChartPreset[] = [
  'bar',
  'horizontal-bar',
  'stacked-bar',
  'line',
  'area',
  'pie',
  'doughnut',
  'radar',
  'polar-area',
];
const animation = {
  type: 'grow' as const,
  durationFrames: 20,
  delayFrames: 0,
  staggerFrames: 0,
  easing: 'linear' as const,
  replayOnUpdate: true,
};
const markAnimation = {
  reference: { id: 'test.animation', version: '1.0.0', sha256: 'a'.repeat(64) },
  presetId: 'test',
  durationFrames: 20,
  delayFrames: 0,
  staggerFrames: 2,
};
const markPose = (opacity = 1): ChartMarkPose => ({
  x: 15,
  y: -8,
  rotation: 20,
  scale: 0.8,
  opacity,
  clipLeft: 0.1,
  clipRight: 0,
  clipTop: 0,
  clipBottom: 0,
  blur: 3,
});

function geometry(chart: Chart) {
  return chart.data.datasets.map((_, index) =>
    chart.getDatasetMeta(index).data.map((point) => {
      const target = point as unknown as Record<string, number>;
      return Object.fromEntries(
        ['x', 'y', 'base', 'width', 'height', 'startAngle', 'endAngle', 'outerRadius'].flatMap(
          (key) => (typeof target[key] === 'number' ? [[key, target[key]]] : []),
        ),
      );
    }),
  );
}

describe('standalone Chart.js provider with real controllers', () => {
  it('renders and updates two area series independently through animation and backward seeks', () => {
    const canvas = canvasFixture();
    const element = createChartElement({ preset: 'area', animation });
    element.data.datasets[0]!.backgroundColor = '#2676ef';
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider');
    const chart = Chart.getChart(canvas)!;
    try {
      const changed = structuredClone(element);
      changed.data.datasets.push({
        label: 'Series 2',
        data: [12, 28, 20, 35],
        backgroundColor: '#f472b6',
        borderColor: '#f472b6',
      });
      renderer.update(changed);
      renderer.renderAtFrame(10);
      const middle = geometry(chart);
      expect(middle).toHaveLength(2);
      expect(middle[0]).toHaveLength(4);
      expect(middle[1]).toHaveLength(4);
      expect(middle[0]).not.toEqual(middle[1]);
      renderer.renderAtFrame(20);
      const settled = geometry(chart);
      expect(settled[0]).not.toEqual(settled[1]);
      expect(settled).not.toEqual(middle);
      const fillColors = canvasCalls(canvas)
        .filter((call) => call.method === 'fill')
        .map((call) => call.fillStyle);
      expect(fillColors).toContain('#2676ef');
      expect(fillColors).toContain('#f472b6');
      renderer.renderAtFrame(10);
      expect(geometry(chart)).toEqual(middle);
    } finally {
      renderer.dispose();
    }
  });
  it('renders bar and area charts independently when both are mounted', () => {
    const barCanvas = canvasFixture();
    const areaCanvas = canvasFixture();
    const bar = createChartElement({ preset: 'bar', animation });
    const area = createChartElement({ preset: 'area', animation });
    const barRenderer = chartJsProvider.create(barCanvas, bar, hostAPI);
    const areaRenderer = chartJsProvider.create(areaCanvas, area, hostAPI);
    if ('then' in barRenderer || 'then' in areaRenderer)
      throw new Error('Expected synchronous provider');
    try {
      barRenderer.renderAtFrame(10);
      areaRenderer.renderAtFrame(10);
      const areaChart = Chart.getChart(areaCanvas)!;
      const areaPose = geometry(areaChart);
      const changedBar = structuredClone(bar);
      changedBar.data.datasets[0]!.data[0] = 99;
      barRenderer.update(changedBar);
      barRenderer.renderAtFrame(20);
      expect(geometry(areaChart)).toEqual(areaPose);
      areaRenderer.renderAtFrame(20);
      expect(geometry(areaChart)).not.toEqual(areaPose);
      expect(Chart.getChart(barCanvas)).toBeDefined();
      expect(Chart.getChart(areaCanvas)).toBeDefined();
    } finally {
      barRenderer.dispose();
      areaRenderer.dispose();
    }
  });
  it('renders a custom chart Bézier differently from linear and repeats its frame after backward seek', () => {
    const customCanvas = canvasFixture(),
      linearCanvas = canvasFixture();
    const custom = createChartElement({
      preset: 'bar',
      animation: { ...animation, curve: { x1: 0.8, y1: 0, x2: 1, y2: 0.2 } },
    });
    const linear = createChartElement({ preset: 'bar', animation });
    const a = chartJsProvider.create(customCanvas, custom, hostAPI),
      b = chartJsProvider.create(linearCanvas, linear, hostAPI);
    if ('then' in a || 'then' in b) throw new Error('Expected synchronous provider');
    a.renderAtFrame(10);
    b.renderAtFrame(10);
    const sample = geometry(Chart.getChart(customCanvas)!);
    expect(sample).not.toEqual(geometry(Chart.getChart(linearCanvas)!));
    a.renderAtFrame(20);
    a.renderAtFrame(10);
    expect(geometry(Chart.getChart(customCanvas)!)).toEqual(sample);
    a.dispose();
    b.dispose();
  });
  it.each(['bar', 'horizontal-bar', 'stacked-bar', 'pie', 'doughnut', 'polar-area'] as const)(
    '%s samples individual mark poses in native, mask and foreground rendering',
    (preset) => {
      const canvas = canvasFixture();
      const mask = canvasFixture();
      const foreground = canvasFixture();
      let opacity = 0.25;
      const sampled = vi.fn((index: number) => ({ ...markPose(opacity), x: index * 15 }));
      const element = createChartElement({
        preset,
        animation,
        fill: '#ffffff',
        markAnimations: { in: markAnimation, out: markAnimation },
        presentation: { valueLabels: { show: true, suffix: '%' } },
      });
      const renderer = chartJsProvider.create(canvas, element, {
        ...hostAPI,
        sampleChartMarkAnimation: sampled,
      });
      if ('then' in renderer) throw new Error('Expected synchronous provider.');
      const chart = Chart.getChart(canvas)!;
      renderer.renderAtFrame(0);
      const first = geometry(chart);
      renderer.renderAtFrame(20);
      // A plugin entrance replaces internal Grow, but never mutates the real mark geometry.
      expect(geometry(chart)).toEqual(first);
      renderer.renderMarkLayers!(mask, foreground);
      expect(sampled).toHaveBeenCalledWith(0);
      expect(sampled).toHaveBeenCalledWith(1);
      expect(
        canvasCalls(mask).some(
          (call) =>
            call.method === 'fill' && call.fillStyle === '#ffffff' && call.globalAlpha === 0.25,
        ),
      ).toBe(true);
      expect(canvasCalls(mask).some((call) => call.method === 'fillText')).toBe(false);
      expect(
        canvasCalls(canvas)
          .filter((call) => call.method === 'fillText')
          .every((call) => call.globalAlpha === 1 && call.filter === 'none'),
      ).toBe(true);
      if (['bar', 'horizontal-bar', 'stacked-bar'].includes(preset)) {
        expect(
          canvasCalls(foreground).some(
            (call) =>
              call.method === 'fillText' &&
              String(call.args[0]).endsWith('%') &&
              call.globalAlpha === 0.25 &&
              call.filter === 'blur(3px)' &&
              call.fillStyle === element.textColor,
          ),
        ).toBe(true);
      }
      for (const target of [canvas, mask, foreground]) {
        const context = target.getContext('2d')!;
        expect(context.globalAlpha).toBe(1);
        expect(context.filter).toBe('none');
        expect(canvasCalls(target).filter((call) => call.method === 'save')).toHaveLength(
          canvasCalls(target).filter((call) => call.method === 'restore').length,
        );
      }
      // The independent host clock, not the replay-local frame, controls Take Out/seek poses.
      opacity = 0.75;
      renderer.renderAtFrame(0);
      renderer.renderMarkLayers!(mask, foreground);
      expect(
        canvasCalls(mask).some((call) => call.method === 'fill' && call.globalAlpha === 0.75),
      ).toBe(true);
      renderer.dispose();
    },
  );

  it('fails closed for an old host or unsupported connected chart, without creating a chart', () => {
    const canvas = canvasFixture();
    expect(() =>
      chartJsProvider.create(
        canvas,
        createChartElement({ markAnimations: { in: markAnimation } }),
        hostAPI,
      ),
    ).toThrow('updated OGraf Studio/runtime host');
    expect(() =>
      chartJsProvider.create(
        canvas,
        createChartElement({ preset: 'line', markAnimations: { in: markAnimation } }),
        { ...hostAPI, sampleChartMarkAnimation: () => markPose() },
      ),
    ).toThrow('not connected charts');
    expect(Chart.getChart(canvas)).toBeUndefined();
  });

  it('removes and reapplies mark poses without nesting draw wrappers or changing dataset colors', () => {
    const canvas = canvasFixture();
    const element = createChartElement({ animation, markAnimations: { in: markAnimation } });
    const sample = vi.fn(() => markPose(0.5));
    const renderer = chartJsProvider.create(canvas, element, {
      ...hostAPI,
      sampleChartMarkAnimation: sample,
    });
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    const chart = Chart.getChart(canvas)!;
    renderer.renderAtFrame(20);
    const colors = chart.getDatasetMeta(0).data.map((target) => target.options.backgroundColor);
    const marks = chart.getDatasetMeta(0).data.length;
    const without = structuredClone(element);
    delete without.markAnimations;
    renderer.update(without);
    sample.mockClear();
    renderer.renderAtFrame(20);
    expect(sample).not.toHaveBeenCalled();
    renderer.update(element);
    sample.mockClear();
    renderer.renderAtFrame(10);
    expect(sample).toHaveBeenCalledTimes(marks);
    renderer.resetAnimation?.();
    sample.mockClear();
    renderer.renderAtFrame(10);
    expect(sample).toHaveBeenCalledTimes(marks);
    expect(chart.getDatasetMeta(0).data.map((target) => target.options.backgroundColor)).toEqual(
      colors,
    );
    renderer.dispose();
  });

  it('keeps displayed-origin geometry morphing with a mark entrance and refreshes every mark ordinal', () => {
    const canvas = canvasFixture();
    const sample = vi.fn((index: number) => ({ ...markPose(), x: index * 15 }));
    const element = createChartElement({
      preset: 'horizontal-bar',
      animation: { ...animation, updateMode: 'morph' },
      markAnimations: { in: markAnimation },
      presentation: { valueAxis: { min: 0, max: 100 } },
    });
    element.data.datasets.push(structuredClone(element.data.datasets[0]!));
    const renderer = chartJsProvider.create(canvas, element, {
      ...hostAPI,
      sampleChartMarkAnimation: sample,
    });
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    const chart = Chart.getChart(canvas)!;
    renderer.renderAtFrame(20);
    const old = geometry(chart);
    const changed = structuredClone(element);
    changed.data.datasets[0]!.data[0]! += 10;
    renderer.update(changed);
    renderer.renderAtFrame(0);
    expect(geometry(chart)).toEqual(old);
    renderer.renderAtFrame(10);
    const middle = geometry(chart);
    renderer.renderAtFrame(20);
    expect(geometry(chart)).not.toEqual(middle);
    sample.mockClear();
    renderer.renderAtFrame(10);
    expect(geometry(chart)).toEqual(middle);
    expect(sample.mock.calls.map((call) => call[0]).sort((left, right) => left - right)).toEqual(
      Array.from({ length: element.data.labels.length * 2 }, (_, index) => index),
    );
    // Removing a point can reuse Chart.js objects. Their sampling indices must be refreshed.
    changed.data.labels.splice(0, 1);
    for (const dataset of changed.data.datasets) {
      dataset.data.splice(0, 1);
      if (Array.isArray(dataset.backgroundColor)) dataset.backgroundColor.splice(0, 1);
    }
    renderer.update(changed);
    sample.mockClear();
    renderer.renderAtFrame(20);
    expect(sample.mock.calls.map((call) => call[0]).sort((left, right) => left - right)).toEqual(
      Array.from({ length: changed.data.labels.length * 2 }, (_, index) => index),
    );
    renderer.dispose();
  });

  it.each(presets)(
    '%s separates mark-only paint coverage from axes and preserves foreground options',
    (preset) => {
      const canvas = canvasFixture();
      const mask = canvasFixture();
      const foreground = canvasFixture();
      const element = createChartElement({
        preset,
        animation,
        fill: '#ffffff',
        presentation: { valueLabels: { show: true, suffix: '%' } },
      });
      const renderer = chartJsProvider.create(canvas, element, hostAPI);
      if ('then' in renderer) throw new Error('Expected synchronous provider.');
      const chart = Chart.getChart(canvas)!;
      renderer.renderAtFrame(20);
      const originals = chart.data.datasets.flatMap((_, index) =>
        chart.getDatasetMeta(index).data.map((point) => point.options),
      );
      expect(renderer.renderMarkLayers).toBeTypeOf('function');
      renderer.renderMarkLayers!(mask, foreground);
      expect(canvasCalls(mask).some((call) => call.method === 'fillText')).toBe(false);
      expect(
        canvasCalls(mask).some((call) => call.method === 'fill' && call.fillStyle === '#ffffff'),
      ).toBe(true);
      expect(
        chart.data.datasets.flatMap((_, index) =>
          chart.getDatasetMeta(index).data.map((point) => point.options),
        ),
      ).toEqual(originals);
      expect(chart.canvas).toBe(canvas);
      if (['bar', 'horizontal-bar', 'stacked-bar'].includes(preset)) {
        expect(
          canvasCalls(foreground).some(
            (call) => call.method === 'fillText' && String(call.args[0]).endsWith('%'),
          ),
        ).toBe(true);
        expect(
          canvasCalls(canvas).some(
            (call) => call.method === 'fillText' && String(call.args[0]).endsWith('%'),
          ),
        ).toBe(false);
      }
      renderer.dispose();
    },
  );
  it.each(presets)('%s grows and restores geometry after backward seeks', (preset) => {
    const canvas = canvasFixture();
    const element = createChartElement({ preset, animation });
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('The Chart.js provider initializes synchronously.');
    const chart = Chart.getChart(canvas)!;
    const ranges = Object.fromEntries(
      Object.entries(chart.scales).map(([id, scale]) => [id, [scale.min, scale.max]]),
    );
    const initial = geometry(chart);
    renderer.renderAtFrame(10);
    const halfway = geometry(chart);
    renderer.renderAtFrame(20);
    expect(geometry(chart)).not.toEqual(halfway);
    expect(halfway).not.toEqual(initial);
    renderer.renderAtFrame(10);
    expect(geometry(chart)).toEqual(halfway);
    renderer.renderAtFrame(0);
    expect(geometry(chart)).toEqual(initial);
    expect(
      Object.fromEntries(
        Object.entries(chart.scales).map(([id, scale]) => [id, [scale.min, scale.max]]),
      ),
    ).toEqual(ranges);
    renderer.dispose();
    expect(Chart.getChart(canvas)).toBeUndefined();
  });

  it('retains sampled progress after resize and updates the same canvas', () => {
    const canvas = canvasFixture();
    const element = createChartElement({ preset: 'horizontal-bar', animation });
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    const chart = Chart.getChart(canvas)!;
    renderer.renderAtFrame(10);
    chart.resize(800, 400);
    const halfway = geometry(chart);
    renderer.renderAtFrame(20);
    expect(geometry(chart)).not.toEqual(halfway);
    renderer.renderAtFrame(10);
    expect(geometry(chart)).toEqual(halfway);
    const updated = structuredClone(element);
    updated.data.datasets[0]!.data[0] = 100;
    renderer.update(updated);
    expect(Chart.getChart(canvas)).toBe(chart);
    expect(Chart.getChart(canvas)!.data.datasets[0]!.data[0]).toBe(100);
    renderer.dispose();
    expect(Chart.getChart(canvas)).toBeUndefined();
  });

  it.each(presets)(
    '%s sizes axes and native paint layers in authored pixels, not a transformed viewport',
    (preset) => {
      const canvas = canvasFixture();
      const mask = canvasFixture();
      const foreground = canvasFixture();
      const parent = {
        clientWidth: 1636,
        clientHeight: 620,
        // Studio may show this box at 75%, 25%, or under a rotated animation. None of
        // those viewport dimensions are the chart's authored coordinate system.
        getBoundingClientRect: vi.fn(() => ({ width: 1227, height: 465 })),
      };
      Object.assign(canvas, { parentElement: parent });
      const element = createChartElement({ preset, animation, fill: '#ffffff' });
      const renderer = chartJsProvider.create(canvas, element, hostAPI);
      if ('then' in renderer) throw new Error('Expected synchronous provider.');
      const chart = Chart.getChart(canvas)!;
      expect(chart.options.responsive).toBe(false);
      expect([chart.width, chart.height, canvas.width, canvas.height]).toEqual([
        1636, 620, 1636, 620,
      ]);
      renderer.renderAtFrame(20);
      const onAir = geometry(chart);
      parent.getBoundingClientRect.mockReturnValue({ width: 409, height: 155 });
      renderer.renderAtFrame(20);
      expect(geometry(chart)).toEqual(onAir);
      expect(parent.getBoundingClientRect).not.toHaveBeenCalled();

      parent.clientWidth = 1280;
      parent.clientHeight = 720;
      renderer.renderAtFrame(10);
      const resizedMiddle = geometry(chart);
      renderer.renderMarkLayers!(mask, foreground);
      expect([chart.width, chart.height]).toEqual([1280, 720]);
      for (const layer of [canvas, mask, foreground])
        expect([layer.width, layer.height]).toEqual([1280, 720]);
      expect([canvas.style.width, canvas.style.height]).toEqual(['100%', '100%']);
      renderer.renderAtFrame(20);
      renderer.renderAtFrame(10);
      expect(geometry(chart)).toEqual(resizedMiddle);

      // A presentation refresh can arrive before the next frame; unchanged source must not
      // bypass a real authored resize, and resizing must not replace the chart instance.
      parent.clientWidth = 960;
      parent.clientHeight = 540;
      renderer.update(element);
      expect(Chart.getChart(canvas)).toBe(chart);
      expect([chart.width, chart.height]).toEqual([960, 540]);
      expect([canvas.style.width, canvas.style.height]).toEqual(['100%', '100%']);
      renderer.dispose();
    },
  );

  it('keeps a positive bitmap through hidden initialization, temporary hiding and reappearance', () => {
    const canvas = canvasFixture();
    canvas.width = canvas.height = 0;
    const parent = { clientWidth: 0, clientHeight: 0 };
    Object.assign(canvas, { parentElement: parent });
    const element = createChartElement({ animation, fill: '#ffffff' });
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    const chart = Chart.getChart(canvas)!;
    const mask = canvasFixture();
    const foreground = canvasFixture();
    renderer.renderAtFrame(0);
    renderer.renderMarkLayers!(mask, foreground);
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
    expect([mask.width, mask.height, foreground.width, foreground.height]).toEqual([1, 1, 1, 1]);

    parent.clientWidth = 640;
    parent.clientHeight = 360;
    renderer.renderAtFrame(10);
    const middle = geometry(chart);
    parent.clientWidth = parent.clientHeight = 0;
    renderer.renderAtFrame(10);
    renderer.renderMarkLayers!(mask, foreground);
    expect([canvas.width, canvas.height, mask.width, mask.height]).toEqual([640, 360, 640, 360]);
    expect(geometry(chart)).toEqual(middle);

    parent.clientWidth = 800;
    parent.clientHeight = 400;
    // A mark pass can be requested immediately after revealing the host, before a frame call.
    renderer.renderMarkLayers!(mask, foreground);
    expect([canvas.width, canvas.height, mask.width, mask.height]).toEqual([800, 400, 800, 400]);
    expect([foreground.width, foreground.height]).toEqual([800, 400]);
    expect(Chart.getChart(canvas)).toBe(chart);
    renderer.dispose();
  });

  it('keeps a seeded detached multi-series area at its authored size until visible layout changes', () => {
    const canvas = canvasFixture();
    canvas.width = 960;
    canvas.height = 540;
    const parent = { clientWidth: 0, clientHeight: 0 };
    Object.assign(canvas, { parentElement: parent });
    const element = createChartElement({ preset: 'area', animation });
    element.data.datasets.push({
      label: 'Series 2',
      data: [20, 44, 30, 25],
      backgroundColor: '#f472b6',
      borderColor: '#f472b6',
    });
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    try {
      const chart = Chart.getChart(canvas)!;
      renderer.renderAtFrame(0);
      expect([chart.width, chart.height, canvas.width, canvas.height]).toEqual([
        960, 540, 960, 540,
      ]);
      parent.clientWidth = 800;
      parent.clientHeight = 400;
      renderer.renderAtFrame(10);
      expect([chart.width, chart.height, canvas.width, canvas.height]).toEqual([
        800, 400, 800, 400,
      ]);
      expect(chart.data.datasets).toHaveLength(2);
    } finally {
      renderer.dispose();
    }
  });

  it('uses a fixed percentage axis, bounded row thickness and one numeric label source', () => {
    const canvas = canvasFixture();
    const element = createChartElement({
      preset: 'horizontal-bar',
      animation,
      data: parseChartData({
        mode: 'percentages',
        rows: [
          { id: 'first', label: 'Transit', value: 48 },
          { id: 'second', label: 'Car', value: 32 },
          { id: 'third', label: 'Other', value: 20 },
        ],
      }),
      presentation: {
        fontFamily: 'Inter',
        fontWeight: 700,
        maxBarThickness: 32,
        valueAxis: { step: 20 },
        valueLabels: { show: true, decimals: 1 },
        gradient: { from: '#2676EF', to: '#8FC6F4' },
      },
    });
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    const chart = Chart.getChart(canvas)!;
    renderer.renderAtFrame(20);
    expect([chart.scales.x!.min, chart.scales.x!.max]).toEqual([0, 100]);
    expect(chart.scales.x!.ticks.map((tick) => tick.label)).toContain('100%');
    expect(chart.data.labels).toEqual(['Transit', 'Car', 'Other']);
    expect(
      chart
        .getDatasetMeta(0)
        .data.every((point) => (point as unknown as { height: number }).height <= 32),
    ).toBe(true);
    renderer.dispose();
  });

  it('keeps one-category bars deliberate and updates 1 to 6 rows without replacing the canvas', () => {
    const canvas = canvasFixture();
    const element = createChartElement({
      preset: 'horizontal-bar',
      animation,
      data: parseChartData({
        mode: 'counts',
        rows: [{ id: 'only', label: 'Only category', value: 8 }],
      }),
      presentation: { maxBarThickness: 40 },
    });
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    const chart = Chart.getChart(canvas)!;
    renderer.renderAtFrame(20);
    expect(
      (chart.getDatasetMeta(0).data[0] as unknown as { height: number }).height,
    ).toBeLessThanOrEqual(40);
    renderer.update({
      ...element,
      data: parseChartData({
        mode: 'counts',
        rows: Array.from({ length: 6 }, (_, index) => ({
          id: String(index),
          label: `Category ${index}`,
          value: index + 1,
        })),
      }),
    });
    expect(Chart.getChart(canvas)).toBe(chart);
    expect(chart.getDatasetMeta(0).data).toHaveLength(6);
    expect([chart.scales.x!.min, chart.scales.x!.max]).toEqual([0, 100]);
    renderer.dispose();
  });

  it('morphs changed bars from the displayed pose, preserves unchanged bars and seeks deterministically', () => {
    const canvas = canvasFixture();
    const data = (values: number[]) =>
      parseChartData({
        mode: 'percentages',
        rows: values.map((value, index) => ({
          id: String(index),
          label: `Category ${index}`,
          value,
        })),
      });
    const element = createChartElement({
      preset: 'horizontal-bar',
      data: data([48, 32, 20]),
      animation: { ...animation, updateMode: 'morph' },
    });
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    const chart = Chart.getChart(canvas)!;
    renderer.renderAtFrame(20);
    const old = geometry(chart);
    renderer.update({ ...element, data: data([40, 40, 20]) });
    renderer.renderAtFrame(0);
    expect(geometry(chart)).toEqual(old);
    renderer.renderAtFrame(10);
    const middle = geometry(chart);
    expect(middle[0]![2]).toEqual(old[0]![2]);
    renderer.renderAtFrame(20);
    expect(geometry(chart)).not.toEqual(middle);
    renderer.renderAtFrame(10);
    expect(geometry(chart)).toEqual(middle);
    // Rapid interruption starts from this displayed half-way result, never nominal zero.
    renderer.update({ ...element, data: data([30, 50, 20]) });
    renderer.renderAtFrame(0);
    expect(geometry(chart)).toEqual(middle);
    renderer.renderAtFrame(20);
    renderer.resetAnimation?.();
    renderer.renderAtFrame(0);
    expect(geometry(chart)[0]![0]!.width ?? 0).toBe(0);
    renderer.dispose();
  });

  it('retains the mounted chart and values after an invalid distribution update', () => {
    const canvas = canvasFixture();
    const element = createChartElement({ preset: 'horizontal-bar', animation });
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    const chart = Chart.getChart(canvas)!;
    const invalid = {
      ...element,
      data: {
        ...element.data,
        mode: 'percentages' as const,
        rows: [{ id: 'one', label: 'One', value: 90 }],
      },
    };
    expect(() => renderer.update(invalid)).toThrow('missing 10%');
    expect(Chart.getChart(canvas)).toBe(chart);
    expect(chart.data.datasets[0]!.data).toEqual(element.data.datasets[0]!.data);
    renderer.dispose();
  });

  it('samples curved area fills and strokes from the same control points', () => {
    const canvas = canvasFixture();
    const element = createChartElement({ preset: 'area', animation });
    Object.assign(element.data.datasets[0]!, { tension: 0.35 });
    let before: unknown;
    let after: unknown;
    const controlPoints = (chart: Chart) =>
      chart.getDatasetMeta(0).data.map((point) => {
        const target = point as unknown as Record<string, number>;
        return ['cp1x', 'cp1y', 'cp2x', 'cp2y'].map((key) => target[key]);
      });
    const monitor: Plugin = {
      id: 'ograf-test-curve-sample',
      beforeDatasetDraw(chart) {
        before = controlPoints(chart);
      },
      afterDatasetDraw(chart) {
        after = controlPoints(chart);
      },
    };
    Chart.register(monitor);
    const renderer = chartJsProvider.create(canvas, element, hostAPI);
    if ('then' in renderer) throw new Error('Expected synchronous provider.');
    try {
      renderer.renderAtFrame(10);
      expect(before).toEqual(after);
      renderer.renderAtFrame(20);
      renderer.renderAtFrame(10);
      expect(before).toEqual(after);
    } finally {
      renderer.dispose();
      Chart.unregister(monitor);
    }
  });
});
