let scopedIds: { seed: string; next: number } | null = null;

export function createId(prefix: string): string {
  if (scopedIds) return `${prefix}-${scopedIds.seed}-${scopedIds.next++}`;
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Preserve the legacy UUID shape for entities that do not use prefixed IDs. */
export function createScopedUuid(): string {
  if (!scopedIds) return crypto.randomUUID();
  const uuid = scopedIds.seed.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )?.[0];
  if (!uuid) throw new Error('Stable identity seed must contain a UUID.');
  return `${uuid.slice(0, 24)}${(scopedIds.next++).toString(16).padStart(12, '0')}`;
}

/** Use only around synchronous, internally seeded recipe materialization. */
export function withStableGeneratedIds<T>(seed: string | undefined, work: () => T): T {
  if (!seed) return work();
  const previous = scopedIds;
  scopedIds = { seed, next: 0 };
  try {
    return work();
  } finally {
    scopedIds = previous;
  }
}
