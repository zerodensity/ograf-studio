import type {
  ChartDataRow,
  ChartElement,
  ChartPresentation,
  RendererPluginManifest,
} from './types';

const COLOR = /^#[\da-f]{6}$/i;
export const CHART_PERCENTAGE_TOTAL_TOLERANCE = 1e-6;

export function chartRendererFeatureErrors(
  element: ChartElement,
  manifest: RendererPluginManifest,
): string[] {
  const features = manifest.chartFeatures ?? [];
  return (
    [
      ['presentation-v1', element.presentation !== undefined],
      ['canonical-data-v1', element.data.mode !== undefined],
      ['morph-update-v1', element.animation?.updateMode === 'morph'],
      ['mark-paint-v1', element.fill !== undefined],
      ['mark-animation-v1', !!element.markAnimations?.in || !!element.markAnimations?.out],
    ] as const
  ).flatMap(([required, enabled]) =>
    enabled && !features.includes(required)
      ? [
          `Renderer plugin "${manifest.name}" (${manifest.version}) does not support ${required}. Select a renderer that advertises this chart feature.`,
        ]
      : [],
  );
}

function text(value: unknown, label: string, maximum = 120): string {
  if (typeof value !== 'string' || value.length > maximum)
    throw new Error(`${label} must be text with at most ${maximum} characters.`);
  return value;
}

function canonicalChartData(value: Record<string, unknown>): ChartElement['data'] {
  if (value.mode !== 'counts' && value.mode !== 'percentages')
    throw new Error('Chart data mode must be counts or percentages.');
  if (!Array.isArray(value.rows) || !value.rows.length || value.rows.length > 100)
    throw new Error('Chart data needs 1–100 canonical rows.');
  const ids = new Set<string>();
  const rows: ChartDataRow[] = value.rows.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Each chart row must be an object.');
    const row = item as Record<string, unknown>;
    const id = text(row.id, 'Chart row ID');
    if (!id.trim() || ids.has(id)) throw new Error('Chart row IDs must be non-empty and unique.');
    ids.add(id);
    const label = text(row.label, 'Chart category');
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0)
      throw new Error('Chart row values must be finite and non-negative.');
    if (value.mode === 'percentages' && row.value > 100)
      throw new Error('Each direct percentage must be between 0 and 100.');
    if (row.color !== undefined && (typeof row.color !== 'string' || !COLOR.test(row.color)))
      throw new Error('Chart row colors must be #RRGGBB.');
    return {
      id,
      label,
      value: row.value,
      ...(row.color === undefined ? {} : { color: row.color as string }),
    };
  });
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!Number.isFinite(total) || total <= 0)
    throw new Error('Chart rows need a finite positive total.');
  if (value.mode === 'percentages' && Math.abs(total - 100) > CHART_PERCENTAGE_TOTAL_TOLERANCE) {
    const difference = Number(Math.abs(total - 100).toFixed(6));
    throw new Error(
      `Percentage total is ${Number(total.toFixed(6))}%; ${total < 100 ? 'missing' : 'excess'} ${difference}%. Expected 100%.`,
    );
  }
  const seriesLabel =
    value.seriesLabel === undefined ? 'Share' : text(value.seriesLabel, 'Chart series label');
  const color = value.color ?? '#2676EF';
  if (typeof color !== 'string' || !COLOR.test(color))
    throw new Error('Chart color must be #RRGGBB.');
  return {
    mode: value.mode,
    rows,
    seriesLabel,
    color,
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: seriesLabel,
        // Divide first to avoid overflow for large but finite counts.
        data: rows.map((row) => (value.mode === 'counts' ? (row.value / total) * 100 : row.value)),
        backgroundColor: rows.map((row) => row.color ?? color),
        borderColor: color,
      },
    ],
  };
}

/** Only a small, predictable, JSON-safe Chart.js data subset crosses the OGraf boundary. */
export function parseChartData(input: unknown): ChartElement['data'] {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Chart data must be an object.');
  const value = raw as Record<string, unknown>;
  if (value.mode !== undefined || value.rows !== undefined) return canonicalChartData(value);
  if (
    !Array.isArray(value.labels) ||
    value.labels.length < 1 ||
    value.labels.length > 100 ||
    !value.labels.every((label) => typeof label === 'string' && label.length <= 120)
  )
    throw new Error('Chart labels must contain 1–100 short text entries.');
  if (!Array.isArray(value.datasets) || value.datasets.length < 1 || value.datasets.length > 12)
    throw new Error('A chart needs 1–12 datasets.');
  const labels = value.labels as string[];
  const datasets = value.datasets.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Each chart dataset must be an object.');
    const dataset = item as Record<string, unknown>;
    if (typeof dataset.label !== 'string' || dataset.label.length > 120)
      throw new Error('Each chart dataset needs a short label.');
    if (
      !Array.isArray(dataset.data) ||
      dataset.data.length !== labels.length ||
      !dataset.data.every((point) => typeof point === 'number' && Number.isFinite(point))
    )
      throw new Error('Each dataset needs one finite number per label.');
    const colors = dataset.backgroundColor;
    if (
      !(typeof colors === 'string' && COLOR.test(colors)) &&
      !(
        Array.isArray(colors) &&
        colors.length === labels.length &&
        colors.every((color) => typeof color === 'string' && COLOR.test(color))
      )
    )
      throw new Error('Background colors must be #RRGGBB hex values.');
    if (typeof dataset.borderColor !== 'string' || !COLOR.test(dataset.borderColor))
      throw new Error('Each dataset needs a #RRGGBB border color.');
    return {
      label: dataset.label as string,
      data: [...dataset.data] as number[],
      backgroundColor: Array.isArray(colors) ? ([...colors] as string[]) : (colors as string),
      borderColor: dataset.borderColor as string,
    };
  });
  return { labels, datasets };
}

/** Validate the complete optional presentation contract; no upstream callback/options escape. */
export function chartPresentationErrors(input: unknown): string[] {
  if (input === undefined) return [];
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return ['Chart presentation must be an object.'];
  const value = input as Record<string, unknown>;
  const errors: string[] = [];
  const number = (
    item: unknown,
    label: string,
    minimum: number,
    maximum: number,
    integer = false,
  ) => {
    if (
      item !== undefined &&
      (typeof item !== 'number' ||
        !Number.isFinite(item) ||
        item < minimum ||
        item > maximum ||
        (integer && !Number.isInteger(item)))
    )
      errors.push(
        `Chart ${label} must be ${integer ? 'an integer' : 'a finite number'} from ${minimum} to ${maximum}.`,
      );
  };
  if (
    value.fontFamily !== undefined &&
    (typeof value.fontFamily !== 'string' ||
      !value.fontFamily.trim() ||
      value.fontFamily.length > 200)
  )
    errors.push('Chart fontFamily must be non-empty text with at most 200 characters.');
  number(value.fontWeight, 'fontWeight', 100, 900, true);
  number(value.maxBarThickness, 'maxBarThickness', 1, 500);
  for (const name of ['valueAxis', 'valueLabels', 'gradient'] as const) {
    const item = value[name];
    if (item !== undefined && (!item || typeof item !== 'object' || Array.isArray(item)))
      errors.push(`Chart ${name} must be an object.`);
  }
  const axis = value.valueAxis as ChartPresentation['valueAxis'];
  if (axis && typeof axis === 'object') {
    number(axis.min, 'axis minimum', -1e12, 1e12);
    number(axis.max, 'axis maximum', -1e12, 1e12);
    number(axis.step, 'axis step', Number.MIN_VALUE, 1e12);
    number(axis.decimals, 'axis decimals', 0, 6, true);
    if (axis.min !== undefined && axis.max !== undefined && axis.min >= axis.max)
      errors.push('Chart axis maximum must be greater than its minimum.');
    if (axis.format !== undefined && !['number', 'percent'].includes(axis.format))
      errors.push('Chart axis format must be number or percent.');
  }
  const labels = value.valueLabels as ChartPresentation['valueLabels'];
  if (labels && typeof labels === 'object') {
    if (typeof labels.show !== 'boolean') errors.push('Chart value-label show must be a boolean.');
    number(labels.decimals, 'value-label decimals', 0, 6, true);
    if (
      labels.suffix !== undefined &&
      (typeof labels.suffix !== 'string' || labels.suffix.length > 12)
    )
      errors.push('Chart value-label suffix must be text with at most 12 characters.');
  }
  const gradient = value.gradient as ChartPresentation['gradient'];
  if (
    gradient &&
    typeof gradient === 'object' &&
    (!COLOR.test(gradient.from) || !COLOR.test(gradient.to))
  )
    errors.push('Chart gradient endpoints must be #RRGGBB.');
  return errors;
}
