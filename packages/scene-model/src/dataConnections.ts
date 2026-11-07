import type { DataConnectionDefinition, FieldDefinition } from './types';
import { createId } from './id';

export const DEFAULT_PUBLIC_MARKET_SYMBOLS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'XRP-USD',
  'LINK-USD',
  'AVAX-USD',
] as const;
export const MAX_DATA_CONNECTIONS = 32;
export type DataConnectionPatch = Partial<Omit<DataConnectionDefinition, 'id'>>;

/** Defaults are applied only to absent values; existing URL sources keep editor-only routing. */
export function normalizeDataConnection(
  input: Partial<DataConnectionDefinition> = {},
): DataConnectionDefinition {
  return {
    id: createId('data-connection'),
    name: 'Data connection',
    format: 'json',
    source: 'url',
    url: '',
    embeddedText: '',
    refreshMs: 0,
    missing: 'default',
    enabled: true,
    mappings: [],
    ...(input.source === 'public-markets'
      ? { target: 'both' as const, refreshMs: 5000, missing: 'keep-last' as const }
      : {}),
    ...structuredClone(input),
  };
}

/** Validate declarative source settings and scoped field mappings; no executable transforms. */
export function dataConnectionErrors(
  value: unknown,
  fields?: readonly Pick<FieldDefinition, 'id'>[],
): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['Data connection must be an object.'];
  const c = value as Record<string, unknown>;
  const errors: string[] = [];
  const text = (key: string, max: number, nonempty = false) => {
    if (typeof c[key] !== 'string' || c[key].length > max || (nonempty && !c[key].trim()))
      errors.push(`Data connection ${key} is invalid.`);
  };
  text('id', 256, true);
  text('name', 256, true);
  text('url', 8192);
  text('embeddedText', 5 * 1024 * 1024);
  if (!['json', 'csv'].includes(String(c.format)))
    errors.push('Data connection format must be JSON or CSV.');
  if (!['url', 'embedded', 'public-markets'].includes(String(c.source)))
    errors.push('Data connection source is invalid.');
  if (
    c.target !== undefined &&
    !['editor-preview', 'coordinated-preview', 'both'].includes(String(c.target))
  )
    errors.push('Data connection preview target is invalid.');
  if (
    !Number.isSafeInteger(c.refreshMs) ||
    Number(c.refreshMs) < 0 ||
    Number(c.refreshMs) > 86400000
  )
    errors.push('Data connection refresh must be 0..86400000 milliseconds.');
  if (!['default', 'empty', 'keep-last'].includes(String(c.missing)))
    errors.push('Data connection missing-data policy is invalid.');
  if (typeof c.enabled !== 'boolean') errors.push('Data connection enabled must be boolean.');
  if (c.publicMarkets !== undefined) {
    const symbols = (c.publicMarkets as { symbols?: unknown } | null)?.symbols;
    if (
      !Array.isArray(symbols) ||
      symbols.length < 1 ||
      symbols.length > 16 ||
      symbols.some((s) => typeof s !== 'string' || !/^[A-Z0-9]{1,12}-USD$/.test(s)) ||
      new Set(symbols).size !== symbols.length
    )
      errors.push('Public markets needs 1..16 unique USD product IDs, for example BTC-USD.');
  }
  if (!Array.isArray(c.mappings) || c.mappings.length > 512)
    errors.push('Data connection mappings must contain at most 512 fields.');
  else {
    const ids = new Set<string>();
    for (const entry of c.mappings) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.fieldId !== 'string' ||
        !entry.fieldId ||
        typeof entry.sourcePath !== 'string' ||
        entry.sourcePath.length > 1024
      ) {
        errors.push('Data connection mapping is invalid.');
        continue;
      }
      if (ids.has(entry.fieldId))
        errors.push(`Data connection maps field ${entry.fieldId} more than once.`);
      ids.add(entry.fieldId);
      if (fields && !fields.some((f) => f.id === entry.fieldId))
        errors.push(`Data connection references unknown field ${entry.fieldId}.`);
      if (
        entry.sourcePath
          .split('.')
          .some((part: string) => ['__proto__', 'constructor', 'prototype'].includes(part.trim()))
      )
        errors.push('Data connection mapping contains an unsafe path.');
    }
  }
  return errors;
}
