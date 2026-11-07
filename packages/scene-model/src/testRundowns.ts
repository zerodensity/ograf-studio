import type { Composition, TestDataRundown } from './types';

/** Bounds authoring-only data before it reaches a saved project or an MCP transaction. */
export function testRundownErrors(
  _composition: Pick<Composition, 'dataFields'>,
  input: unknown,
): string[] {
  if (!Array.isArray(input) || input.length > 32)
    return ['Test rundowns must be an array of at most 32 items.'];
  const ids = new Set<string>();
  const errors: string[] = [];
  let nodeCount = 0;
  let characterCount = 0;
  const validValue = (value: unknown, depth: number): boolean => {
    if (++nodeCount > 100_000 || depth > 16) return false;
    if (typeof value === 'string') {
      characterCount += value.length;
      return characterCount <= 5 * 1024 * 1024;
    }
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((entry) => validValue(entry, depth + 1));
    if (typeof value !== 'object') return false;
    return Object.entries(value as Record<string, unknown>).every(
      ([key, entry]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) && validValue(entry, depth + 1),
    );
  };
  for (const raw of input) {
    const rundown = raw as Partial<TestDataRundown> | null;
    if (
      !rundown ||
      typeof rundown.id !== 'string' ||
      !rundown.id ||
      rundown.id.length > 256 ||
      ids.has(rundown.id) ||
      typeof rundown.name !== 'string' ||
      !rundown.name.trim() ||
      rundown.name.length > 128 ||
      !Array.isArray(rundown.rows) ||
      rundown.rows.length > 2000
    ) {
      errors.push('Each test rundown needs a unique ID, a name and at most 2000 rows.');
      continue;
    }
    ids.add(rundown.id);
    const rowIds = new Set<string>();
    for (const row of rundown.rows) {
      if (
        !row ||
        typeof row.id !== 'string' ||
        !row.id ||
        row.id.length > 256 ||
        rowIds.has(row.id) ||
        !row.values ||
        typeof row.values !== 'object' ||
        Array.isArray(row.values)
      ) {
        errors.push(`Rundown “${rundown.name}” has an invalid or duplicate row.`);
        break;
      }
      rowIds.add(row.id);
      if (
        Object.entries(row.values).some(
          ([id, value]) =>
            !id || ['__proto__', 'constructor', 'prototype'].includes(id) || !validValue(value, 0),
        )
      ) {
        errors.push(`Rundown “${rundown.name}” contains an invalid field ID or value.`);
        break;
      }
    }
  }
  return errors;
}
