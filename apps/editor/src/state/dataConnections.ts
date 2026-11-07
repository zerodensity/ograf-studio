import type {
  DataConnectionDefinition,
  FieldDefinition,
  FieldValue,
} from '@ograf-editor/scene-model';

const MAX_CONNECTION_BYTES = 5 * 1024 * 1024;

function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  row.push(value);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function parseConnectionPayload(format: 'json' | 'csv', source: string): unknown {
  if (format === 'json') return JSON.parse(source);
  const [headers = [], values = []] = csvRows(source);
  return Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? '']));
}

function valueAtPath(root: unknown, sourcePath: string): unknown {
  let value = Array.isArray(root) ? root[0] : root;
  for (const segment of sourcePath
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function coerce(field: FieldDefinition, value: unknown): FieldValue {
  if (
    field.type === 'number' ||
    field.type === 'integer' ||
    field.type === 'duration-ms' ||
    field.type === 'percentage'
  ) {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number(field.defaultValue ?? 0);
  }
  if (field.type === 'boolean') {
    if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    return Boolean(value);
  }
  if (field.type === 'array')
    return Array.isArray(value) ? (value as FieldValue) : field.defaultValue;
  if (field.type === 'object')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as FieldValue)
      : field.defaultValue;
  return String(value) as FieldValue;
}

export function mapConnectionPayload(
  connection: DataConnectionDefinition,
  fields: FieldDefinition[],
  payload: unknown,
  previous: Record<string, FieldValue> = {},
): Record<string, FieldValue> {
  const result: Record<string, FieldValue> = {};
  for (const mapping of connection.mappings) {
    const field = fields.find((candidate) => candidate.id === mapping.fieldId);
    if (!field) continue;
    const value = valueAtPath(payload, mapping.sourcePath);
    if (value !== undefined && value !== null) result[field.id] = coerce(field, value);
    else if (connection.missing === 'keep-last' && previous[field.id] !== undefined)
      result[field.id] = previous[field.id]!;
    else if (connection.missing === 'empty') result[field.id] = '';
    else result[field.id] = field.defaultValue;
  }
  return result;
}

export async function readDataConnection(
  connection: DataConnectionDefinition,
  fetcher: typeof fetch = fetch,
  options: { signal?: AbortSignal } = {},
): Promise<unknown> {
  let source = connection.embeddedText;
  if (connection.source === 'url') {
    const url = new URL(connection.url);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('Data URL must use HTTP or HTTPS.');
    const response = await fetcher(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Data request failed with HTTP ${response.status}.`);
    source = await response.text();
  }
  if (new TextEncoder().encode(source).byteLength > MAX_CONNECTION_BYTES)
    throw new Error('Data response exceeds the 5 MiB preview limit.');
  return parseConnectionPayload(connection.format, source);
}
