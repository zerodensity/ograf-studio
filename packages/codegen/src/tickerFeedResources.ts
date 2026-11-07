/** Resource-bearing fields in a native feed item. Editorial strings never pass through URL rebasing. */
export const TICKER_FEED_RESOURCE_PATHS = [
  ['element', 'src'],
  ['element', 'frames'],
  ['element', 'inputImage', 'source'],
  ...['fill', 'strokePaint'].flatMap((paint) => [
    ['element', paint, 'inputImage', 'source'],
    ['element', paint, 'source', 'src'],
    ['element', paint, 'source', 'fallback'],
  ]),
  ['effects', 'stack', 'shader', 'inputImage', 'source'],
] as const;

/** Internal compiled resource-path terminator, never a user field name. */
export const TICKER_FEED_RESOURCE_PATH = '$ografTickerItems';

export function mapTickerFeedResources(value: unknown, resource: (url: string) => string): unknown {
  let result = value;
  const json = typeof value === 'string';
  if (json) {
    try {
      result = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (!Array.isArray(result)) return value;
  const at = (node: unknown, path: readonly string[]): unknown => {
    if (Array.isArray(node)) return node.map((item) => at(item, path));
    if (!path.length) return typeof node === 'string' ? resource(node) : node;
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, path[0]!)) return node;
    const record = node as Record<string, unknown>;
    return { ...record, [path[0]!]: at(record[path[0]!], path.slice(1)) };
  };
  for (const path of TICKER_FEED_RESOURCE_PATHS) result = at(result, path);
  return json ? JSON.stringify(result) : result;
}

export function tickerFeedResourceValues(value: unknown): string[] {
  const values: string[] = [];
  mapTickerFeedResources(value, (url) => {
    values.push(url);
    return url;
  });
  return values;
}

/** The same narrow traversal runs inside portable single and coordinated entry modules. */
export function tickerFeedResourceRuntimeSource(resolver: string): string {
  return `function exportedTickerFeedResources(value) {
  const json = typeof value === 'string';
  let result = value;
  if (json) { try { result = JSON.parse(value); } catch { return value; } }
  if (!Array.isArray(result)) return value;
  function at(node, path) {
    if (Array.isArray(node)) return node.map((item) => at(item, path));
    if (!path.length) return typeof node === 'string' ? ${resolver}(node) : node;
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, path[0])) return node;
    return { ...node, [path[0]]: at(node[path[0]], path.slice(1)) };
  }
  for (const path of ${JSON.stringify(TICKER_FEED_RESOURCE_PATHS)}) result = at(result, path);
  return json ? JSON.stringify(result) : result;
}`;
}
