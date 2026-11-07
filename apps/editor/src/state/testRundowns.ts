import {
  createId,
  type FieldDefinition,
  type FieldValue,
  type TestDataRundownRow,
} from '@ograf-editor/scene-model';

const MAX_ROWS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const normalized = (text: string) =>
  text
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + Number(a[i - 1] !== b[j - 1]),
      );
    previous = next;
  }
  return previous[b.length]!;
}

/** CSV and TSV with quoted delimiters/newlines; malformed quoting is rejected. */
export function parseDelimitedRows(source: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index++;
      } else if (quoted || value === '') quoted = !quoted;
      else throw new Error('Unexpected quote in a data cell.');
    } else if (char === delimiter && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(value);
      if (row.some((cell) => cell.length)) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (quoted) throw new Error('A quoted data cell is not closed.');
  row.push(value);
  if (row.some((cell) => cell.length)) rows.push(row);
  return rows;
}

function convert(field: FieldDefinition, input: unknown): FieldValue {
  if (input === null) return null;
  if (['number', 'integer', 'duration-ms', 'percentage'].includes(field.type)) {
    if (typeof input === 'string' && !input.trim())
      throw new Error(`${field.label} needs a number.`);
    const value = Number(input);
    if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value)))
      throw new Error(`${field.label} needs a valid ${field.type}.`);
    return value;
  }
  if (field.type === 'boolean') {
    if (typeof input === 'boolean') return input;
    const value = String(input).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(value)) return true;
    if (['false', '0', 'no', 'off'].includes(value)) return false;
    throw new Error(`${field.label} needs a true/false value.`);
  }
  if (
    field.type === 'object' ||
    field.type === 'array' ||
    field.type === 'select-multiple' ||
    field.type === 'gradient'
  ) {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    if (!value || typeof value !== 'object') throw new Error(`${field.label} needs a JSON value.`);
    return value as FieldValue;
  }
  return String(input);
}

/** Match exact keys first, then normalized keys/labels; ambiguity never silently selects a field. */
export function resolveRundownField(header: string, fields: FieldDefinition[]): FieldDefinition {
  const exact = fields.filter((field) => field.key === header.trim());
  let matches = exact.length
    ? exact
    : fields.filter(
        (field) =>
          normalized(field.key) === normalized(header) ||
          normalized(field.label) === normalized(header),
      );
  const key = normalized(header);
  if (!matches.length && key.length >= 4 && key.length <= 128) {
    const candidates = fields.map((field) => ({
      field,
      distance: Math.min(
        editDistance(key, normalized(field.key).slice(0, 128)),
        editDistance(key, normalized(field.label).slice(0, 128)),
      ),
    }));
    const best = Math.min(...candidates.map((item) => item.distance));
    if (best <= Math.max(1, Math.floor(key.length / 8)))
      matches = candidates.filter((item) => item.distance === best).map((item) => item.field);
  }
  if (matches.length !== 1)
    throw new Error(`Column “${header}” is ${matches.length ? 'ambiguous' : 'not a field'}.`);
  return matches[0]!;
}

export function parseRundown(source: string, fields: FieldDefinition[]): TestDataRundownRow[] {
  if (new TextEncoder().encode(source).byteLength > MAX_BYTES)
    throw new Error('Test data exceeds 5 MiB.');
  const trimmed = source
    .replace(/^\uFEFF/, '')
    .replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '')
    .trimStart();
  if (!trimmed.trim()) throw new Error('Paste CSV, TSV or a JSON array.');
  let records: Record<string, unknown>[];
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      !Array.isArray(parsed) ||
      parsed.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
    )
      throw new Error('JSON must be an array of objects.');
    records = parsed as Record<string, unknown>[];
  } else {
    const [headers, ...rows] = parseDelimitedRows(
      trimmed,
      trimmed.split(/\r?\n/, 1)[0]!.includes('\t') ? '\t' : ',',
    );
    if (!headers?.length || !rows.length) throw new Error('Include a header and at least one row.');
    if (new Set(headers).size !== headers.length)
      throw new Error('Duplicate column headers are not allowed.');
    records = rows.map((row) => {
      if (row.length !== headers.length)
        throw new Error('Each row must have the same number of cells as the header.');
      return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
    });
  }
  if (!records.length || records.length > MAX_ROWS)
    throw new Error(`Use between 1 and ${MAX_ROWS} rows.`);
  return records.map((record, index) => {
    const values: Record<string, FieldValue> = {};
    for (const [header, value] of Object.entries(record)) {
      const field = resolveRundownField(header, fields);
      if (Object.hasOwn(values, field.id))
        throw new Error(`Row ${index + 1}: multiple columns match ${field.label}.`);
      try {
        values[field.id] = convert(field, value);
      } catch (cause) {
        throw new Error(
          `Row ${index + 1}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
    return { id: createId('test-row'), values };
  });
}

export function rundownRowData(
  fields: FieldDefinition[],
  row: TestDataRundownRow,
): Record<string, FieldValue> {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      Object.hasOwn(row.values, field.id) ? row.values[field.id]! : field.defaultValue,
    ]),
  );
}
