import Chart from 'chart.js/auto';
import type { ChartConfiguration, ChartType, Plugin } from 'chart.js';
import {
  chartPresentationErrors,
  parseChartData,
  type ChartElement,
} from '@ograf-editor/scene-model';
import type { ChartRendererHostAPI, ChartRendererProvider } from '@ograf-editor/ograf-runtime';
import { chartMarkBounds, drawChartMarkPose } from './markAnimation';

const GEOMETRY_KEYS = [
  'x',
  'y',
  'base',
  'width',
  'height',
  'startAngle',
  'endAngle',
  'circumference',
  'outerRadius',
  'innerRadius',
] as const;
type Geometry = Partial<Record<(typeof GEOMETRY_KEYS)[number], number>>;
interface ChartGeometry {
  target: Record<string, unknown>;
  from: Geometry;
  to: Geometry;
  index: number;
  markIndex: number;
  key: string;
  value: number;
  fromValue: number;
}
interface ChartState {
  chart?: Chart | undefined;
  element: ChartElement;
  frame: number;
  geometry: ChartGeometry[];
  hostAPI: ChartRendererHostAPI;
  updateFrom?: Map<string, Geometry> | undefined;
  updateValues?: Map<string, number> | undefined;
  paintLayer?: 'mask' | 'foreground';
  wrappedMarks: WeakMap<object, { index: number }>;
}

function pointKey(element: ChartElement, datasetIndex: number, index: number): string {
  return JSON.stringify([
    datasetIndex,
    element.data.rows?.[index]?.id ?? element.data.labels[index],
    element.data.rows ? '' : index,
  ]);
}

function sampledValue(state: ChartState, entry: ChartGeometry): number {
  const animation = state.hostAPI.normalizeChartAnimation(state.element.animation);
  const progress =
    (animation.type === 'grow' && !state.element.markAnimations?.in) || state.updateFrom
      ? state.hostAPI.chartAnimationProgress(animation, state.frame, entry.index)
      : 1;
  return entry.fromValue + (entry.value - entry.fromValue) * progress;
}

function normalizedElement(element: ChartElement): ChartElement {
  const errors = chartPresentationErrors(element.presentation);
  if (errors.length) throw new Error(errors.join(' '));
  return { ...structuredClone(element), data: parseChartData(element.data) };
}

function readGeometry(target: Record<string, unknown>): Geometry {
  return Object.fromEntries(
    GEOMETRY_KEYS.flatMap((key) =>
      typeof target[key] === 'number' && Number.isFinite(target[key]) ? [[key, target[key]]] : [],
    ),
  );
}

function applyGeometry(state: ChartState): void {
  const animation = state.hostAPI.normalizeChartAnimation(state.element.animation);
  for (const { target, from, to, index } of state.geometry) {
    const progress =
      (animation.type === 'grow' && !state.element.markAnimations?.in) || state.updateFrom
        ? state.hostAPI.chartAnimationProgress(animation, state.frame, index)
        : 1;
    for (const key of GEOMETRY_KEYS) {
      const end = to[key];
      if (end === undefined) continue;
      const start = from[key] ?? end;
      const value = progress === 1 ? end : start + (end - start) * progress;
      target[key] = ['width', 'height', 'circumference', 'outerRadius', 'innerRadius'].includes(key)
        ? Math.max(0, value)
        : value;
    }
  }
  const chart = state.chart;
  if (!chart) return;
  // The points setter invalidates Chart.js paths and Bézier control points after backward seeks.
  for (let index = 0; index < chart.data.datasets.length; index++) {
    const meta = chart.getDatasetMeta(index);
    if (meta.dataset && 'points' in meta.dataset) meta.dataset.points = meta.data;
  }
}

function animationPlugin(state: ChartState): Plugin {
  let savedContext = false;
  const restoreContext = (chart: Chart) => {
    if (savedContext) {
      chart.ctx.restore();
      savedContext = false;
    }
  };
  return {
    id: 'ograf-chart-animation',
    afterUpdate(chart) {
      state.chart = chart;
      const targets = chart.data.datasets.flatMap((_, datasetIndex) =>
        chart.getDatasetMeta(datasetIndex).data.map((target, index) => ({
          target: target as unknown as Record<string, unknown>,
          to: readGeometry(target as unknown as Record<string, unknown>),
          index,
          markIndex: datasetIndex * state.element.data.labels.length + index,
          key: pointKey(state.element, datasetIndex, index),
          value: state.element.data.datasets[datasetIndex]!.data[index]!,
        })),
      );
      chart.reset();
      state.geometry = targets.map((entry) => {
        const baseline = readGeometry(entry.target);
        // Chart.js reset bars omit the value dimension (NaN); a frame sampler needs zero.
        if (state.element.preset === 'horizontal-bar') baseline.width = 0;
        else if (state.element.preset === 'bar' || state.element.preset === 'stacked-bar')
          baseline.height = 0;
        return {
          ...entry,
          fromValue: state.updateFrom ? (state.updateValues?.get(entry.key) ?? 0) : 0,
          from: state.updateFrom
            ? state.updateValues?.get(entry.key) === entry.value
              ? entry.to
              : (state.updateFrom.get(entry.key) ?? baseline)
            : baseline,
        };
      });
      if (state.element.markAnimations) {
        for (const { target, markIndex } of state.geometry) {
          const existing = state.wrappedMarks.get(target);
          if (existing) {
            existing.index = markIndex;
            continue;
          }
          const sampling = { index: markIndex };
          const mark = target as unknown as { draw(ctx: CanvasRenderingContext2D): void };
          const draw = mark.draw;
          mark.draw = function (ctx) {
            drawChartMarkPose(
              ctx,
              chartMarkBounds(this as unknown as Record<string, unknown>),
              state.element.markAnimations
                ? (state.hostAPI.sampleChartMarkAnimation?.(sampling.index) ?? null)
                : null,
              () => draw.call(this, ctx),
            );
          };
          state.wrappedMarks.set(target, sampling);
        }
      }
      applyGeometry(state);
    },
    beforeDraw(chart) {
      restoreContext(chart);
      applyGeometry(state);
      if (state.paintLayer) {
        // The host composites native paints between grid/axes and mark outlines/value labels.
        // Draw controllers through Chart.js' own clipping/filler hooks, excluding layout layers.
        (chart as unknown as { _drawDatasets(): void })._drawDatasets();
        return false;
      }
    },
    beforeDatasetsDraw(chart) {
      if (state.element.fill !== undefined && !state.paintLayer) return false;
      const animation = state.hostAPI.normalizeChartAnimation(state.element.animation);
      if (state.updateFrom || state.element.markAnimations?.in) return;
      const progress = Math.max(
        0,
        Math.min(1, state.hostAPI.chartAnimationProgress(animation, state.frame)),
      );
      if (animation.type !== 'reveal' && animation.type !== 'fade') return;
      chart.ctx.save();
      savedContext = true;
      if (animation.type === 'reveal') {
        const { left, top, width, height } = chart.chartArea;
        chart.ctx.beginPath();
        chart.ctx.rect(left, top, width * progress, height);
        chart.ctx.clip();
      } else chart.ctx.globalAlpha *= progress;
    },
    afterDatasetsDraw: restoreContext,
    afterDraw: restoreContext,
  };
}

/** Value labels share the plotted number, font and sampled mark tip. */
function valueLabelPlugin(state: ChartState): Plugin {
  return {
    id: 'ograf-chart-value-labels',
    afterDatasetsDraw(chart) {
      if (state.paintLayer === 'mask' || (state.element.fill !== undefined && !state.paintLayer))
        return;
      const settings = state.element.presentation?.valueLabels;
      if (
        !settings?.show ||
        !['bar', 'horizontal-bar', 'stacked-bar'].includes(state.element.preset)
      )
        return;
      const { ctx, chartArea } = chart;
      const horizontal = state.element.preset === 'horizontal-bar';
      const font = `${state.element.presentation?.fontWeight ?? 400} ${state.element.fontSize}px ${state.element.presentation?.fontFamily ?? 'sans-serif'}`;
      const suffix = settings.suffix ?? (state.element.data.mode ? '%' : '');
      ctx.save();
      ctx.font = font;
      ctx.fillStyle = state.element.textColor;
      ctx.textBaseline = 'middle';
      for (const [datasetIndex, dataset] of state.element.data.datasets.entries()) {
        chart.getDatasetMeta(datasetIndex).data.forEach((point, index) => {
          const bar = point as unknown as {
            x: number;
            y: number;
            base: number;
            width: number;
            height: number;
          };
          const value = dataset.data[index]!;
          const entry = state.geometry.find(
            (candidate) => candidate.key === pointKey(state.element, datasetIndex, index),
          );
          const label =
            (entry ? sampledValue(state, entry) : value).toFixed(settings.decimals ?? 0) + suffix;
          const width = ctx.measureText(label).width;
          drawChartMarkPose(
            ctx,
            chartMarkBounds(point as unknown as Record<string, unknown>),
            state.element.markAnimations
              ? (state.hostAPI.sampleChartMarkAnimation?.(
                  datasetIndex * state.element.data.labels.length + index,
                ) ?? null)
              : null,
            () => {
              // Labels follow their mark, but keep their own color and are not clipped to its fill.
              if (horizontal) {
                const preferred = value >= 0 ? bar.x + 6 : bar.x - width - 6;
                ctx.textAlign = 'left';
                ctx.fillText(label, Math.max(0, Math.min(chart.width - width, preferred)), bar.y);
              } else {
                ctx.textAlign = 'center';
                const y =
                  value >= 0
                    ? bar.y - state.element.fontSize / 2 - 4
                    : bar.y + state.element.fontSize / 2 + 4;
                ctx.fillText(
                  label,
                  Math.max(width / 2, Math.min(chart.width - width / 2, bar.x)),
                  Math.max(state.element.fontSize / 2, Math.min(chartArea.bottom, y)),
                );
              }
            },
            false,
          );
        });
      }
      ctx.restore();
    },
  };
}

function configuration(state: ChartState): ChartConfiguration {
  const element = state.element;
  const radial = element.preset === 'radar' || element.preset === 'polar-area';
  const cartesian = !radial && element.preset !== 'pie' && element.preset !== 'doughnut';
  const type: ChartType =
    element.preset === 'horizontal-bar' || element.preset === 'stacked-bar'
      ? 'bar'
      : element.preset === 'area'
        ? 'line'
        : element.preset === 'polar-area'
          ? 'polarArea'
          : element.preset;
  const clockAnimation = { duration: 0, animateRotate: true, animateScale: true };
  const presentation = element.presentation;
  const font = {
    size: element.fontSize,
    ...(presentation?.fontFamily ? { family: presentation.fontFamily } : {}),
    ...(presentation?.fontWeight ? { weight: presentation.fontWeight } : {}),
  };
  const axis = element.data.mode
    ? {
        min: 0,
        max: 100,
        step: presentation?.valueAxis?.step,
        format: 'percent',
        decimals: presentation?.valueAxis?.decimals,
      }
    : presentation?.valueAxis;
  const numericTicks = {
    ...(axis?.step === undefined ? {} : { stepSize: axis.step }),
    ...(axis?.format || axis?.decimals !== undefined
      ? {
          callback: (value: string | number) =>
            Number(value).toFixed(axis.decimals ?? 0) + (axis.format === 'percent' ? '%' : ''),
        }
      : {}),
  };
  const numericScale = {
    ...(axis?.min === undefined ? {} : { min: axis.min }),
    ...(axis?.max === undefined ? {} : { max: axis.max }),
  };
  const numericAxis = element.preset === 'horizontal-bar' ? 'x' : 'y';
  return {
    type,
    data: {
      labels: [...element.data.labels],
      datasets: element.data.datasets.map((dataset) => ({
        ...structuredClone(dataset),
        ...(presentation?.maxBarThickness ? { maxBarThickness: presentation.maxBarThickness } : {}),
        ...(presentation?.gradient
          ? {
              backgroundColor: (context: { chart: Chart }) => {
                const area = context.chart.chartArea;
                if (!area) return presentation.gradient!.from;
                const gradient = context.chart.ctx.createLinearGradient(
                  area.left,
                  area.bottom,
                  element.preset === 'horizontal-bar' ? area.right : area.left,
                  element.preset === 'horizontal-bar' ? area.bottom : area.top,
                );
                gradient.addColorStop(0, presentation.gradient!.from);
                gradient.addColorStop(1, presentation.gradient!.to);
                return gradient;
              },
            }
          : {}),
        ...(element.preset === 'area' ? { fill: true } : {}),
        ...(element.fill === undefined ? {} : { backgroundColor: 'transparent' }),
      })),
    },
    options: {
      // Studio owns the authored box. Chart.js' responsive DOM platform measures transformed
      // bounding rectangles and writes that viewport size back as canvas CSS pixels, applying
      // editor/preview zoom twice and separating axes from the full-size native paint layers.
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: 1,
      animation: clockAnimation,
      events: [],
      layout: presentation?.valueLabels?.show
        ? {
            padding: {
              right: element.preset === 'horizontal-bar' ? element.fontSize * 4 : 0,
              top: element.preset === 'horizontal-bar' ? 0 : element.fontSize + 8,
            },
          }
        : {},
      indexAxis: element.preset === 'horizontal-bar' ? 'y' : 'x',
      plugins: {
        legend: {
          display: element.showLegend,
          labels: { color: element.textColor, font },
        },
        tooltip: { enabled: false },
      },
      ...(radial
        ? {
            scales: {
              r: {
                grid: { display: element.showGrid, color: '#ffffff44' },
                angleLines: { display: element.showGrid, color: '#ffffff44' },
                pointLabels: { color: element.textColor, font },
                ticks: {
                  color: element.textColor,
                  backdropColor: 'transparent',
                  font,
                },
              },
            },
          }
        : cartesian
          ? {
              scales: {
                x: {
                  ...(numericAxis === 'x' ? numericScale : {}),
                  stacked: element.preset === 'stacked-bar',
                  grid: { display: element.showGrid },
                  ticks: {
                    color: element.textColor,
                    font,
                    ...(numericAxis === 'x' ? numericTicks : {}),
                  },
                },
                y: {
                  ...(numericAxis === 'y' ? numericScale : {}),
                  stacked: element.preset === 'stacked-bar',
                  beginAtZero: true,
                  grid: { display: element.showGrid },
                  ticks: {
                    color: element.textColor,
                    font,
                    ...(numericAxis === 'y' ? numericTicks : {}),
                  },
                },
              },
            }
          : {}),
      elements: { line: { fill: element.preset === 'area' } },
    },
    plugins: [animationPlugin(state), valueLabelPlugin(state)],
  } as ChartConfiguration;
}

/** Chart.js lives entirely in this independently packaged renderer adapter. */
export const chartJsProvider: ChartRendererProvider = {
  apiVersion: 1,
  create(canvas, element, hostAPI) {
    const assertMarkSupport = (candidate: ChartElement) => {
      if (candidate.markAnimations && !hostAPI.sampleChartMarkAnimation)
        throw new Error('Chart mark animations require an updated OGraf Studio/runtime host.');
      if (
        candidate.markAnimations &&
        !['bar', 'horizontal-bar', 'stacked-bar', 'pie', 'doughnut', 'polar-area'].includes(
          candidate.preset,
        )
      )
        throw new Error(
          'Individual mark animations support bars and slices, not connected charts.',
        );
    };
    assertMarkSupport(element);
    const state: ChartState = {
      element: normalizedElement(element),
      frame: 0,
      geometry: [],
      hostAPI,
      wrappedMarks: new WeakMap(),
    };
    const containerSize = () => {
      const parent = canvas.parentElement;
      const width = parent?.clientWidth;
      const height = parent?.clientHeight;
      return typeof width === 'number' &&
        Number.isFinite(width) &&
        width > 0 &&
        typeof height === 'number' &&
        Number.isFinite(height) &&
        height > 0
        ? { width, height }
        : null;
    };
    const fitDisplay = () => {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    };
    const resizeToContainer = () => {
      const chart = state.chart;
      const size = containerSize();
      // A hidden mount must retain a valid bitmap until it has a positive layout box. Do not
      // feed zero sizes to Chart.js or the host's mark/shader compositors while a pane settles.
      if (!chart || !size) return;
      if (chart.width !== size.width || chart.height !== size.height)
        chart.resize(size.width, size.height);
      // Explicit resize also writes fixed CSS pixels; all three chart canvases must instead
      // share the authored percentage box, independent of ancestor CSS transforms.
      fitDisplay();
    };
    const mount = () => {
      const size = containerSize();
      // Set intrinsic attributes before construction: DomPlatform otherwise derives them from
      // computed CSS, which may be zero for a hidden preview or a just-created shader wrapper.
      canvas.width = size?.width ?? Math.max(1, canvas.width || 1);
      canvas.height = size?.height ?? Math.max(1, canvas.height || 1);
      fitDisplay();
      state.chart = new Chart(canvas, configuration(state));
      resizeToContainer();
    };
    mount();
    return {
      renderAtFrame(frame) {
        state.frame = frame;
        resizeToContainer();
        applyGeometry(state);
        state.chart?.draw();
      },
      update(nextElement) {
        assertMarkSupport(nextElement);
        const normalized = normalizedElement(nextElement);
        resizeToContainer();
        if (JSON.stringify(state.element) === JSON.stringify(normalized)) return;
        const chart = state.chart;
        const sameType = state.element.preset === normalized.preset;
        const dataChanged = JSON.stringify(state.element.data) !== JSON.stringify(normalized.data);
        const displayedValues = new Map(
          state.geometry.map((entry) => [entry.key, sampledValue(state, entry)]),
        );
        state.updateFrom =
          dataChanged && normalized.animation?.updateMode === 'morph'
            ? new Map(state.geometry.map(({ key, target }) => [key, readGeometry(target)]))
            : undefined;
        state.updateValues = state.updateFrom ? displayedValues : undefined;
        state.element = normalized;
        if (dataChanged && normalized.animation?.replayOnUpdate !== false) state.frame = 0;
        if (!chart || !sameType) {
          chart?.destroy();
          state.geometry = [];
          mount();
          return;
        }
        const config = configuration(state);
        chart.data = config.data;
        chart.options = config.options!;
        chart.update('none');
      },
      resetAnimation() {
        state.updateFrom = undefined;
        state.updateValues = undefined;
        state.frame = 0;
        resizeToContainer();
        state.chart?.update('none');
      },
      renderMarkLayers(mask, foreground) {
        resizeToContainer();
        const chart = state.chart;
        if (!chart) return;
        const mutable = chart as unknown as {
          canvas: HTMLCanvasElement;
          ctx: CanvasRenderingContext2D;
        };
        const original = { canvas: mutable.canvas, ctx: mutable.ctx };
        const targets = chart.data.datasets.flatMap((_, index) => {
          const meta = chart.getDatasetMeta(index);
          return [...(meta.dataset ? [meta.dataset] : []), ...meta.data];
        });
        const controllers = chart.data.datasets.map(
          (_, index) =>
            chart.getDatasetMeta(index).controller as unknown as { _ctx: CanvasRenderingContext2D },
        );
        const contexts = controllers.map((controller) => controller._ctx);
        const options = targets.map((target) => ({ target, options: target.options }));
        try {
          for (const [layer, canvas] of [
            ['mask', mask],
            ['foreground', foreground],
          ] as const) {
            if (canvas.width !== original.canvas.width) canvas.width = original.canvas.width;
            if (canvas.height !== original.canvas.height) canvas.height = original.canvas.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Chart mark paint requires Canvas 2D rendering.');
            state.paintLayer = layer;
            for (const entry of options)
              entry.target.options = {
                ...entry.options,
                backgroundColor: layer === 'mask' ? '#ffffff' : 'transparent',
                ...(layer === 'mask' ? { borderColor: 'transparent', borderWidth: 0 } : {}),
              };
            mutable.canvas = canvas;
            mutable.ctx = ctx;
            for (const controller of controllers) controller._ctx = ctx;
            chart.draw();
          }
        } finally {
          for (const entry of options) entry.target.options = entry.options;
          mutable.canvas = original.canvas;
          mutable.ctx = original.ctx;
          controllers.forEach((controller, index) => {
            controller._ctx = contexts[index]!;
          });
          delete state.paintLayer;
        }
      },
      dispose() {
        state.chart?.destroy();
        state.chart = undefined;
        state.geometry = [];
      },
    };
  },
};
