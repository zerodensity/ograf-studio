import { createId, parseChartData, type ChartElement } from '@ograf-editor/scene-model';

export type ChartDataMode = 'metrics' | 'counts' | 'percentages';
export interface ChartRowDraft {
  id: string;
  label: string;
  value: string;
  color: string;
}
export function chartRowsForEditing(data: ChartElement['data']): ChartRowDraft[] {
  if (data.rows)
    return data.rows.map((row) => ({
      ...row,
      value: String(row.value),
      color: row.color ?? data.color ?? '#2676EF',
    }));
  const series = data.datasets[0]!;
  return data.labels.map((label, index) => ({
    id: createId('chart-row'),
    label,
    value: String(series.data[index] ?? 0),
    color: Array.isArray(series.backgroundColor)
      ? (series.backgroundColor[index] ?? series.borderColor)
      : series.backgroundColor,
  }));
}
export function chartDataFromRows(
  mode: Exclude<ChartDataMode, 'metrics'>,
  rows: ChartRowDraft[],
  seriesLabel: string,
): ChartElement['data'] {
  return parseChartData({
    mode,
    seriesLabel,
    rows: rows.map((row) => {
      if (!row.value.trim() || !Number.isFinite(Number(row.value)))
        throw new Error('Enter a finite value for every chart row.');
      return { ...row, value: Number(row.value) };
    }),
  });
}
export function legacyChartData(data: ChartElement['data']): ChartElement['data'] {
  return parseChartData({ labels: data.labels, datasets: data.datasets });
}
