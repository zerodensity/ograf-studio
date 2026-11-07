import type { CompiledDataExposure } from '@ograf-editor/ograf-types';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Remove external writes to internal fields; retain private descendants of edited objects. */
export function filterExposedData(
  input: unknown,
  policy: Record<string, CompiledDataExposure> | undefined,
  current: Record<string, unknown> = {},
): unknown {
  if (!policy || !record(input)) return input;
  const result = { ...input };
  const value = (incoming: unknown, branch: CompiledDataExposure, previous: unknown): unknown => {
    if (branch.items) {
      if (!Array.isArray(incoming)) return Array.isArray(previous) ? structuredClone(previous) : [];
      return incoming.map((item, index) =>
        value(item, branch.items!, Array.isArray(previous) ? previous[index] : undefined),
      );
    }
    if (!branch.properties) return incoming;
    if (!record(incoming)) incoming = record(previous) ? structuredClone(previous) : {};
    const next = filterExposedData(
      incoming,
      branch.properties,
      record(previous) ? previous : {},
    ) as Record<string, unknown>;
    for (const [key, child] of Object.entries(branch.properties)) {
      if (child.exposed) {
        // A partial parent replacement must not remove an omitted branch that
        // contains internal descendants. Reuse its current structure or fill
        // its private defaults when no previous branch exists.
        if (!Object.hasOwn(next, key))
          next[key] = value(undefined, child, record(previous) ? previous[key] : undefined);
        continue;
      }
      if (record(previous) && Object.hasOwn(previous, key)) next[key] = previous[key];
      else if (Object.hasOwn(child, 'defaultValue'))
        next[key] = structuredClone(child.defaultValue);
    }
    return next;
  };
  for (const [key, branch] of Object.entries(policy)) {
    if (!branch.exposed) delete result[key];
    else if (Object.hasOwn(result, key)) result[key] = value(result[key], branch, current[key]);
  }
  return result;
}
