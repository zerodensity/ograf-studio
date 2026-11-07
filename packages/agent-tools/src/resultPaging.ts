import type { AgentToolRecord } from './toolRecords';

export type ResultPath = Array<string | number>;
export interface ToolResultSource {
  toolName?: string;
  sessionId?: string;
  revision?: number | string;
  isError?: boolean;
}
export interface ToolResultPageRequest {
  resultId: string;
  sessionId?: string;
  path?: ResultPath;
  offset?: number;
  limit?: number;
  maxTokens?: number;
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type NodeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
interface ResultEntry {
  path: ResultPath;
  kind: NodeKind;
  key?: string;
  index?: number;
  value?: Json;
  total?: number;
  preview?: Record<string, Json>;
}
export interface ToolResultPage {
  kind: 'tool-result-page';
  resultId: string;
  source: ToolResultSource;
  path: ResultPath;
  node: {
    kind: NodeKind;
    entries?: ResultEntry[];
    items?: ResultEntry[];
    value?: Json;
    chunk?: string;
  };
  offset: number;
  total: number;
  hasMore: boolean;
  nextOffset?: number;
  maxTokens: number;
  expiresAt: string;
  readTool: 'ograf_read_result_page';
}
interface StoredResult {
  value: Json;
  source: ToolResultSource;
  expiresAt: number;
  bytes: number;
}
export class ToolResultPagingError extends Error {
  constructor(
    readonly code:
      | 'expired-result'
      | 'session-mismatch'
      | 'invalid-path'
      | 'invalid-page'
      | 'result-too-large'
      | 'budget-too-small',
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_MAX_TOKENS = 4096;
const encoder = new TextEncoder();
/** Conservative transport estimate, not a claim about any provider's exact tokenizer. */
export const estimateResultTokens = (text: string) =>
  Math.ceil(encoder.encode(text).byteLength / 3);
const kindOf = (value: Json): NodeKind =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : (typeof value as NodeKind);
const owner = (source: ToolResultSource) => source.sessionId ?? 'editor';
const PRIORITY_KEYS = new Set([
  'revision',
  'projectRevision',
  'sessionId',
  'valid',
  'status',
  'statusCode',
  'error',
  'errors',
  'proposalId',
  'proposal',
  'results',
  'summary',
]);
const PREVIEW_KEYS = [
  'id',
  'name',
  'type',
  'key',
  'label',
  'status',
  'layerId',
  'compositionId',
  'templateId',
  'fieldId',
  'parentId',
];

function smallEnough(value: unknown, tokens: number): boolean {
  // Stop before serializing a large string, array or project. Never make a partial JSON value.
  let remaining = Math.max(0, tokens * 3 - 2);
  const visit = (item: unknown, depth: number): boolean => {
    if (remaining < 0 || depth > 64) return false;
    if (typeof item === 'string') {
      if (item.length > remaining) return false;
      remaining -= encoder.encode(JSON.stringify(item)).byteLength;
    } else if (item === null || typeof item !== 'object') {
      remaining -= JSON.stringify(item ?? null)?.length ?? 4;
    } else if (Array.isArray(item)) {
      remaining -= 2 + item.length;
      for (const child of item) if (!visit(child, depth + 1)) return false;
    } else {
      remaining -= 2;
      for (const [key, child] of Object.entries(item)) {
        remaining -= encoder.encode(JSON.stringify(key)).byteLength + 2;
        if (!visit(child, depth + 1)) return false;
      }
    }
    return remaining >= 0;
  };
  try {
    return visit(value, 0) && estimateResultTokens(JSON.stringify(value ?? null)) <= tokens;
  } catch {
    return false;
  }
}

/** Immutable JSON snapshot with an estimated heap bound independent of model context limits. */
function snapshot(value: unknown, maxBytes: number): { value: Json; bytes: number } {
  let bytes = 0;
  const seen = new Set<object>();
  const copy = (item: unknown, depth: number): Json => {
    bytes += 16;
    if (depth > 128)
      throw new ToolResultPagingError(
        'result-too-large',
        'Result nesting exceeds the paging store depth. Use a narrower source projection.',
      );
    if (bytes > maxBytes)
      throw new ToolResultPagingError(
        'result-too-large',
        'Result exceeds the paging snapshot capacity. Use query filters, include sections, template IDs or source pagination. Do not repeat a mutation.',
      );
    if (item === null || item === undefined) return null;
    if (typeof item === 'string') {
      bytes += item.length * 2;
      if (bytes > maxBytes)
        throw new ToolResultPagingError(
          'result-too-large',
          'Result exceeds the paging snapshot capacity. Use a narrower source projection; do not repeat a mutation.',
        );
      return item;
    }
    if (typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object')
      throw new ToolResultPagingError(
        'invalid-page',
        'Only finite JSON data can be retained as a tool result.',
      );
    if (seen.has(item))
      throw new ToolResultPagingError('invalid-page', 'A cyclic tool result cannot be paged.');
    seen.add(item);
    let result: Json;
    if (Array.isArray(item)) result = item.map((child) => copy(child, depth + 1));
    else {
      const output: Record<string, Json> = Object.create(null);
      for (const [key, child] of Object.entries(item)) {
        if (child === undefined) continue;
        bytes += key.length * 2;
        output[key] = copy(child, depth + 1);
      }
      result = output;
    }
    seen.delete(item);
    return result;
  };
  return { value: copy(value, 0), bytes };
}

export class ToolResultPager {
  readonly #results = new Map<string, StoredResult>();
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  #bytes = 0;

  constructor(
    options: { now?: () => number; ttlMs?: number; maxEntries?: number; maxBytes?: number } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? 30 * 60_000;
    this.#maxEntries = Math.max(1, options.maxEntries ?? 64);
    this.#maxBytes = Math.max(256, options.maxBytes ?? 128 * 1024 * 1024);
  }

  #remove(id: string): void {
    const entry = this.#results.get(id);
    if (entry) this.#bytes -= entry.bytes;
    this.#results.delete(id);
  }
  #expire(): void {
    for (const [id, entry] of this.#results) if (entry.expiresAt <= this.#now()) this.#remove(id);
  }

  store(value: unknown, source: ToolResultSource = {}): string {
    const saved = snapshot(value, this.#maxBytes);
    this.#expire();
    while (this.#results.size >= this.#maxEntries || this.#bytes + saved.bytes > this.#maxBytes) {
      const oldest = this.#results.keys().next().value;
      if (!oldest) break;
      this.#remove(oldest);
    }
    const id = `result-${crypto.randomUUID()}`;
    const record =
      value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
    const revision = source.revision ?? record?.revision ?? record?.projectRevision;
    this.#results.set(id, {
      ...saved,
      source: {
        ...(source.toolName ? { toolName: source.toolName } : {}),
        ...(source.sessionId ? { sessionId: source.sessionId } : {}),
        ...(source.isError ? { isError: true } : {}),
        ...(typeof revision === 'number' || typeof revision === 'string' ? { revision } : {}),
      },
      expiresAt: this.#now() + this.#ttlMs,
    });
    this.#bytes += saved.bytes;
    return id;
  }

  read(request: ToolResultPageRequest): ToolResultPage {
    this.#expire();
    const entry = this.#results.get(request.resultId);
    if (!entry)
      throw new ToolResultPagingError(
        'expired-result',
        'The retained result expired or was evicted. Re-read its source with a read-only tool; never repeat a mutation to recover a result.',
      );
    if (owner(entry.source) !== (request.sessionId ?? 'editor'))
      throw new ToolResultPagingError(
        'session-mismatch',
        'This result belongs to a different authoring conversation.',
      );
    const path = request.path ?? [];
    if (
      !Array.isArray(path) ||
      path.length > 64 ||
      path.some(
        (part) => typeof part !== 'string' && (!Number.isSafeInteger(part) || Number(part) < 0),
      )
    )
      throw new ToolResultPagingError(
        'invalid-path',
        'Use a property/index path of at most 64 parts.',
      );
    let value: Json = entry.value;
    for (const part of path) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, part))
        throw new ToolResultPagingError(
          'invalid-path',
          'The requested path is absent from this immutable result snapshot.',
        );
      value = (value as Record<string | number, Json>)[part]!;
    }
    const offset = request.offset ?? 0;
    const limit = request.limit ?? (typeof value === 'string' ? 16_384 : 50);
    const maxTokens = Math.max(128, Math.min(65_536, request.maxTokens ?? DEFAULT_MAX_TOKENS));
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isFinite(maxTokens)
    )
      throw new ToolResultPagingError(
        'invalid-page',
        'Page offsets and limits must be nonnegative integers and a positive limit.',
      );
    const kind = kindOf(value);
    const total =
      typeof value === 'string' || Array.isArray(value)
        ? value.length
        : value && typeof value === 'object'
          ? Object.keys(value).length
          : 1;
    if (
      offset > total ||
      (kind !== 'string' && kind !== 'object' && kind !== 'array' && offset !== 0)
    )
      throw new ToolResultPagingError('invalid-page', 'Page offset exceeds this result node.');
    const page: ToolResultPage = {
      kind: 'tool-result-page',
      resultId: request.resultId,
      source: { ...entry.source },
      path: [...path],
      node: { kind },
      offset,
      total,
      hasMore: false,
      maxTokens,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      readTool: 'ograf_read_result_page',
    };
    const fits = () => estimateResultTokens(JSON.stringify(page)) <= maxTokens;
    if (!fits())
      throw new ToolResultPagingError(
        'budget-too-small',
        'The page metadata exceeds the requested token budget. Increase maxTokens or request a shorter path.',
      );
    if (typeof value === 'string') {
      if (
        offset &&
        /[\uDC00-\uDFFF]/.test(value[offset]!) &&
        /[\uD800-\uDBFF]/.test(value[offset - 1]!)
      )
        throw new ToolResultPagingError(
          'invalid-page',
          'String offsets must be at Unicode character boundaries; use nextOffset.',
        );
      let low = 0,
        high = Math.min(limit, total - offset);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        page.node.chunk = value.slice(offset, offset + middle);
        page.hasMore = offset + middle < total;
        page.nextOffset = page.hasMore ? offset + middle : undefined;
        if (fits()) low = middle;
        else high = middle - 1;
      }
      let end = offset + low;
      if (
        end < total &&
        /[\uD800-\uDBFF]/.test(value[end - 1]!) &&
        /[\uDC00-\uDFFF]/.test(value[end]!)
      )
        end--;
      page.node.chunk = value.slice(offset, end);
      page.hasMore = end < total;
      page.nextOffset = page.hasMore ? end : undefined;
      if (page.hasMore && end === offset)
        throw new ToolResultPagingError(
          'budget-too-small',
          'The requested budget cannot hold the next Unicode character. Increase maxTokens.',
        );
      if (!fits())
        throw new ToolResultPagingError(
          'budget-too-small',
          'The string plus page metadata exceeds maxTokens. Increase the page budget.',
        );
      return page;
    }
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      const keys = Array.isArray(value)
        ? value.map((_, index) => index)
        : Object.keys(value).sort(
            (a, b) => Number(PRIORITY_KEYS.has(b)) - Number(PRIORITY_KEYS.has(a)),
          );
      const output: ResultEntry[] = [];
      if (Array.isArray(value)) page.node.items = output;
      else page.node.entries = output;
      for (const key of keys.slice(offset, offset + Math.min(limit, 256))) {
        const item = (value as Record<string | number, Json>)[key]!;
        const itemPath = [...path, key];
        const itemKind = kindOf(item);
        const cell: ResultEntry = {
          path: itemPath,
          kind: itemKind,
          ...(typeof key === 'number' ? { index: key } : { key }),
        };
        if (smallEnough(item, Math.min(512, Math.floor(maxTokens / 3))))
          cell.value = structuredClone(item);
        else {
          cell.total =
            typeof item === 'string' || Array.isArray(item)
              ? item.length
              : item && typeof item === 'object'
                ? Object.keys(item).length
                : 1;
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            cell.preview = {};
            for (const name of PREVIEW_KEYS) {
              const detail = item[name];
              if (
                (typeof detail === 'string' && detail.length < 128) ||
                typeof detail === 'number' ||
                typeof detail === 'boolean'
              )
                cell.preview[name] = detail;
            }
          }
        }
        output.push(cell);
        page.hasMore = offset + output.length < total;
        page.nextOffset = page.hasMore ? offset + output.length : undefined;
        if (!fits()) {
          // Keep the complete entry as a reference rather than a chopped JSON subtree.
          delete cell.value;
          delete cell.preview;
          if (!fits()) {
            output.pop();
            break;
          }
        }
      }
      page.hasMore = offset + output.length < total;
      page.nextOffset = page.hasMore ? offset + output.length : undefined;
      if (page.hasMore && !output.length)
        throw new ToolResultPagingError(
          'budget-too-small',
          'The requested budget cannot hold an entry reference. Increase maxTokens.',
        );
      if (!fits())
        throw new ToolResultPagingError(
          'budget-too-small',
          'The collection plus page metadata exceeds maxTokens. Increase the page budget.',
        );
      return page;
    }
    page.node.value = value;
    if (!fits())
      throw new ToolResultPagingError(
        'budget-too-small',
        'The scalar plus page metadata exceeds maxTokens. Increase the page budget.',
      );
    return page;
  }

  format(value: unknown, options: ToolResultSource & { maxTokens: number }): unknown {
    if (smallEnough(value, options.maxTokens)) return value ?? null;
    let resultId: string | undefined;
    try {
      resultId = this.store(value, options);
      return this.read({ resultId, sessionId: options.sessionId, maxTokens: options.maxTokens });
    } catch (error) {
      if (!(error instanceof ToolResultPagingError)) throw error;
      const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const acknowledgement = Object.fromEntries(
        Object.entries(record).filter(
          ([key, item]) => PRIORITY_KEYS.has(key) && smallEnough(item, 256),
        ),
      );
      return {
        kind: 'tool-result-unavailable',
        ...(resultId ? { resultId, readTool: 'ograf_read_result_page' } : {}),
        source: options,
        acknowledgement,
        error: { code: error.code, message: error.message },
        guidance:
          'The original tool has already run. Do not rerun a mutation. Read current state using bounded read-only projections.',
      };
    }
  }
}

const workspacePagers = new WeakMap<object, ToolResultPager>();
const recordPagers = new WeakMap<AgentToolRecord[], ToolResultPager>();
export function toolResultPagerForWorkspace(workspace: object): ToolResultPager {
  let pager = workspacePagers.get(workspace);
  if (!pager) {
    pager = new ToolResultPager();
    workspacePagers.set(workspace, pager);
  }
  return pager;
}
export function registerToolResultPager(records: AgentToolRecord[], pager: ToolResultPager): void {
  recordPagers.set(records, pager);
}
export function toolResultPagerForRecords(records: AgentToolRecord[]): ToolResultPager | undefined {
  return recordPagers.get(records);
}
