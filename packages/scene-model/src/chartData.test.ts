import { describe, expect, it } from 'vitest';
import { createChartElement, createChartLayer, defaultTransformFor } from './factory';
import { chartPresentationErrors, parseChartData } from './chartData';
import { applyElementDataValue } from './boundPaint';
import { createProject } from './factory';
import { migrateProject } from './migrations';

describe('Chart.js authoring data', () => {
  it('creates a reusable chart layer with a visible canvas-sized default', () => {
    expect(createChartLayer().element.type).toBe('chart');
    expect(defaultTransformFor('chart')).toMatchObject({ width: 640, height: 360 });
  });

  it('normalizes a JSON data binding without mutating authored data', () => {
    const original = createChartElement();
    const value = JSON.stringify({
      labels: ['One', 'Two'],
      datasets: [
        { label: 'Results', data: [4, 8], backgroundColor: '#2563eb', borderColor: '#2563eb' },
      ],
    });
    const updated = applyElementDataValue(original, 'data', value);
    expect(updated.type === 'chart' && updated.data.labels).toEqual(['One', 'Two']);
    expect(original.data.labels).toHaveLength(4);
  });

  it('rejects executable or oversized data instead of passing it into Chart.js', () => {
    expect(() => parseChartData('{"labels":[],"datasets":[]}')).toThrow();
    expect(() =>
      parseChartData({
        labels: ['x'],
        datasets: [{ label: 'x', data: [1], backgroundColor: 'url(js)', borderColor: '#2563eb' }],
      }),
    ).toThrow();
  });

  it('calculates count shares from stable canonical rows without rounding the geometry', () => {
    const source = {
      mode: 'counts',
      rows: [40, 30, 20].map((value, index) => ({
        id: `row-${index}`,
        label: `Category ${index}`,
        value,
      })),
    };
    const data = parseChartData(source);
    expect(data.labels).toEqual(['Category 0', 'Category 1', 'Category 2']);
    expect(data.datasets[0]!.data).toEqual([(40 / 90) * 100, (30 / 90) * 100, (20 / 90) * 100]);
    expect(data.rows?.map((row) => row.value)).toEqual([40, 30, 20]);
    expect(parseChartData(data)).toEqual(data);
    // A stale/fabricated derived label or geometry cannot override the canonical source.
    expect(parseChartData({ ...data, labels: ['Fake 100%'], datasets: [] })).toEqual(data);
    expect(source.rows[0]!.value).toBe(40);
  });

  it.each([
    [[40, 30, 20], 'missing 10%'],
    [[60, 30, 20], 'excess 10%'],
    [[101, 0, 0], 'between 0 and 100'],
    [[0, 0, 0], 'positive total'],
    [[-1, 51, 50], 'non-negative'],
    [[Number.NaN, 50, 50], 'finite'],
  ])('rejects invalid distribution values %j atomically', (values, message) => {
    expect(() =>
      parseChartData({
        mode: 'percentages',
        rows: values.map((value, index) => ({ id: String(index), label: String(index), value })),
      }),
    ).toThrow(message);
  });

  it('accepts floating point distribution totals within 1e-6 and keeps supplied values', () => {
    const values = [33.3333333, 33.3333333, 33.3333333];
    const data = parseChartData({
      mode: 'percentages',
      rows: values.map((value, index) => ({ id: String(index), label: String(index), value })),
    });
    expect(data.datasets[0]!.data).toEqual(values);
    const metrics = createChartElement().data;
    metrics.datasets[0]!.data = [40, 30, 20, 0];
    expect(parseChartData(metrics).datasets[0]!.data).toEqual([40, 30, 20, 0]);
  });

  it('rejects duplicate IDs and empty count data', () => {
    expect(() => parseChartData({ mode: 'counts', rows: [] })).toThrow('1–100');
    expect(() =>
      parseChartData({
        mode: 'counts',
        rows: [
          { id: 'same', label: 'One', value: 1 },
          { id: 'same', label: 'Two', value: 1 },
        ],
      }),
    ).toThrow('unique');
    expect(() =>
      parseChartData({ mode: 'counts', rows: [{ id: 'one', label: 'One', value: 0 }] }),
    ).toThrow('positive total');
  });

  it('validates bounded JSON-safe presentation controls', () => {
    expect(
      chartPresentationErrors({
        valueAxis: { min: 0, max: 100, step: 20, format: 'percent', decimals: 2 },
        fontFamily: 'Inter',
        fontWeight: 700,
        maxBarThickness: 48,
        valueLabels: { show: true, decimals: 2, suffix: '%' },
        gradient: { from: '#2676EF', to: '#8FC6F4' },
      }),
    ).toEqual([]);
    expect(
      chartPresentationErrors({
        valueAxis: { min: 100, max: 0, step: 0, decimals: 7, format: 'eval()' },
        fontWeight: 1000,
        maxBarThickness: -1,
        valueLabels: { show: 'yes' },
        gradient: { from: 'red', to: '#ffffff' },
      }).length,
    ).toBeGreaterThanOrEqual(8);
  });

  it('hydrates a saved rows-only source before the chart inspector reads datasets', () => {
    const project = createProject();
    const layer = createChartLayer();
    if (layer.element.type !== 'chart') throw new Error('Expected chart.');
    layer.element.data = {
      mode: 'percentages',
      rows: [{ id: 'only', label: 'Only category', value: 100 }],
    } as typeof layer.element.data;
    project.compositions[0]!.layers.push(layer);
    const migrated = migrateProject(project).compositions[0]!.layers[0]!.element;
    expect(migrated.type === 'chart' && migrated.data.labels).toEqual(['Only category']);
    expect(migrated.type === 'chart' && migrated.data.datasets[0]!.data).toEqual([100]);
  });
});
