import { describe, expect, it } from 'vitest';
import { parseChartData } from '@ograf-editor/scene-model';
import { chartDataFromRows, chartRowsForEditing, legacyChartData } from './chartAuthoring';

const legacy = () =>
  parseChartData({
    labels: ['Transit', 'Car', 'Other'],
    datasets: [
      {
        label: 'Share',
        data: [48, 32, 20],
        backgroundColor: ['#2676EF', '#8FC6F4', '#9AAFC6'],
        borderColor: '#2676EF',
      },
    ],
  });
describe('chart authoring data drafts', () => {
  it('converts metrics to canonical rows without changing category/value/color alignment', () => {
    const source = legacy();
    const rows = chartRowsForEditing(source);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    const output = chartDataFromRows('percentages', rows, 'Share');
    expect(output.datasets[0]!.data).toEqual([48, 32, 20]);
    expect(output.labels).toEqual(source.labels);
    expect(source.mode).toBeUndefined();
  });
  it('validates the entire direct-percentage draft before publishing', () => {
    const source = legacy();
    const rows = chartRowsForEditing(source);
    rows[0]!.value = '40';
    expect(() => chartDataFromRows('percentages', rows, 'Share')).toThrow(/missing 8/);
    expect(source.datasets[0]!.data).toEqual([48, 32, 20]);
    rows[1]!.value = '35';
    rows[2]!.value = '25';
    expect(chartDataFromRows('percentages', rows, 'Share').datasets[0]!.data).toEqual([40, 35, 25]);
  });
  it('edits raw counts rather than percentages already derived for display', () => {
    const rows = chartRowsForEditing(legacy());
    rows.forEach((row, index) => (row.value = String([40, 30, 20][index])));
    const output = chartDataFromRows('counts', rows, 'Share');
    expect(output.datasets[0]!.data[0]).toBeCloseTo(44.444444);
    const again = chartRowsForEditing(output);
    expect(again.map((row) => row.value)).toEqual(['40', '30', '20']);
    expect(again.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });
  it('rejects empty and nonfinite input and returns legacy metrics explicitly', () => {
    const rows = chartRowsForEditing(legacy());
    rows[0]!.value = '';
    expect(() => chartDataFromRows('counts', rows, 'Share')).toThrow(/finite/);
    rows[0]!.value = 'Infinity';
    expect(() => chartDataFromRows('counts', rows, 'Share')).toThrow(/finite/);
    const canonical = chartDataFromRows('percentages', chartRowsForEditing(legacy()), 'Share');
    expect(legacyChartData(canonical).mode).toBeUndefined();
    expect(legacyChartData(canonical).datasets[0]!.data).toEqual([48, 32, 20]);
  });
});
