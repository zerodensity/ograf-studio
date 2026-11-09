import {
  DEFAULT_PUBLIC_MARKET_SYMBOLS,
  type DataConnectionDefinition,
  type FieldDefinition,
  type FieldValue,
} from '@ograf-editor/scene-model';
import { mapConnectionPayload } from './dataConnections';

export interface DataConnectionStatus {
  phase: 'idle' | 'loading' | 'live' | 'error' | 'disabled' | 'paused';
  message: string;
  updatedAt?: number;
  pending: boolean;
}
export interface DataConnectionConsumer {
  key: string;
  statusKey: string;
  version: string;
  connection: DataConnectionDefinition;
  fields: FieldDefinition[];
  previous(): Record<string, FieldValue>;
  /** False retains the latest payload until the destination can safely receive it. */
  apply(values: Record<string, FieldValue>): boolean | Promise<boolean>;
}
export interface DataConnectionReader {
  read(signal: AbortSignal): Promise<unknown>;
  warning?(payload: unknown): string | undefined;
  dispose?(): void;
}

export function dataConnectionSourceKey(connection: DataConnectionDefinition): string {
  return JSON.stringify([
    connection.source,
    connection.format,
    connection.source === 'url' ? connection.url.trim() : '',
    connection.source === 'embedded' ? connection.embeddedText : '',
    connection.source === 'public-markets'
      ? { symbols: connection.publicMarkets?.symbols ?? [...DEFAULT_PUBLIC_MARKET_SYMBOLS] }
      : null,
  ]);
}
interface Entry {
  key: string;
  reader: DataConnectionReader;
  consumers: Map<string, DataConnectionConsumer>;
  timer?: ReturnType<typeof setTimeout>;
  abort?: AbortController;
  running?: Promise<void>;
  interval: number;
  payload?: unknown;
  hasPayload: boolean;
  updatedAt?: number;
  error?: string;
  disposed: boolean;
  delivered: Map<string, string>;
  delivering: Set<string>;
}

/** Application-owned polling, shared by destinations. It never depends on panel mounts. */
export function createDataConnectionRuntime(options: {
  createReader(connection: DataConnectionDefinition): DataConnectionReader;
  status(consumer: DataConnectionConsumer, status: DataConnectionStatus): void;
  now?: () => number;
}) {
  const entries = new Map<string, Entry>();
  const now = options.now ?? Date.now;
  let disposed = false;
  const owns = (entry: Entry, consumer: DataConnectionConsumer) =>
    !disposed && !entry.disposed && entry.consumers.get(consumer.key) === consumer;
  const publish = (
    entry: Entry,
    consumer: DataConnectionConsumer,
    status: DataConnectionStatus,
  ) => {
    if (owns(entry, consumer)) options.status(consumer, status);
  };
  const deliver = async (entry: Entry, consumer: DataConnectionConsumer) => {
    if (!entry.hasPayload || !owns(entry, consumer) || entry.delivering.has(consumer.key)) return;
    const payloadAtStart = entry.payload;
    const values = mapConnectionPayload(
      consumer.connection,
      consumer.fields,
      entry.payload,
      consumer.previous(),
    );
    const identity = JSON.stringify([consumer.version, values]);
    if (entry.delivered.get(consumer.key) === identity) {
      publish(entry, consumer, {
        phase: entry.error ? 'error' : 'live',
        message: entry.error ?? 'Connected',
        updatedAt: entry.updatedAt,
        pending: false,
      });
      return;
    }
    entry.delivering.add(consumer.key);
    try {
      const applied = await consumer.apply(values);
      if (!owns(entry, consumer)) return;
      if (applied) entry.delivered.set(consumer.key, identity);
      publish(entry, consumer, {
        phase: entry.error ? 'error' : applied ? 'live' : 'paused',
        message:
          entry.error ??
          (applied ? 'Connected' : 'Latest data ready · waiting for preview to settle or resume'),
        updatedAt: entry.updatedAt,
        pending: !applied,
      });
    } catch (cause) {
      publish(entry, consumer, {
        phase: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
        updatedAt: entry.updatedAt,
        // A rejected update is finished. Keep manual refresh available after a repair.
        pending: false,
      });
    } finally {
      entry.delivering.delete(consumer.key);
      // A newer response or destination replaced this one while its update was in flight.
      const latest = entry.consumers.get(consumer.key);
      if (
        latest &&
        owns(entry, latest) &&
        (latest !== consumer || entry.payload !== payloadAtStart)
      )
        void deliver(entry, latest);
    }
  };
  const flush = (entry: Entry) => {
    for (const consumer of entry.consumers.values()) {
      void deliver(entry, consumer);
    }
  };
  const schedule = (entry: Entry) => {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    if (!disposed && !entry.disposed && entry.interval > 0)
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        void poll(entry);
      }, entry.interval);
  };
  const poll = (entry: Entry): Promise<void> => {
    if (disposed || entry.disposed) return Promise.resolve();
    if (entry.running) return entry.running;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 30_000);
    entry.abort = controller;
    for (const consumer of entry.consumers.values())
      publish(entry, consumer, {
        phase: 'loading',
        message: 'Connecting…',
        updatedAt: entry.updatedAt,
        pending: false,
      });
    entry.running = (async () => {
      try {
        const payload = await Promise.resolve().then(() => entry.reader.read(controller.signal));
        if (disposed || entry.disposed || controller.signal.aborted) return;
        entry.payload = payload;
        entry.hasPayload = true;
        entry.updatedAt = now();
        entry.error = entry.reader.warning?.(payload);
        flush(entry);
      } catch (cause) {
        if (disposed || entry.disposed) return;
        entry.error = controller.signal.aborted
          ? 'Data request timed out after 30 seconds.'
          : cause instanceof Error
            ? cause.message
            : String(cause);
        for (const consumer of entry.consumers.values())
          publish(entry, consumer, {
            phase: 'error',
            message: entry.error,
            updatedAt: entry.updatedAt,
            pending: false,
          });
      } finally {
        clearTimeout(deadline);
        entry.running = undefined;
        entry.abort = undefined;
        schedule(entry);
      }
    })();
    return entry.running;
  };
  const release = (entry: Entry) => {
    entry.disposed = true;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.abort?.abort();
    entry.reader.dispose?.();
    entries.delete(entry.key);
  };
  return {
    reconcile(consumers: DataConnectionConsumer[]) {
      if (disposed) return;
      const grouped = new Map<string, DataConnectionConsumer[]>();
      for (const consumer of consumers) {
        if (!consumer.connection.enabled) continue;
        const key = dataConnectionSourceKey(consumer.connection);
        const group = grouped.get(key) ?? [];
        group.push(consumer);
        grouped.set(key, group);
      }
      for (const [key, entry] of entries) if (!grouped.has(key)) release(entry);
      for (const [key, group] of grouped) {
        let entry = entries.get(key);
        const created = !entry;
        if (!entry) {
          let reader: DataConnectionReader;
          try {
            reader = options.createReader(group[0]!.connection);
          } catch (cause) {
            reader = {
              read: async () => {
                throw cause;
              },
            };
          }
          entry = {
            key,
            reader,
            consumers: new Map(),
            interval: 0,
            hasPayload: false,
            disposed: false,
            delivered: new Map(),
            delivering: new Set(),
          };
          entries.set(key, entry);
        }
        const previousInterval = entry.interval;
        entry.consumers = new Map(
          group.map((consumer) => {
            const previous = entry!.consumers.get(consumer.key);
            return [consumer.key, previous?.version === consumer.version ? previous : consumer];
          }),
        );
        for (const consumerKey of entry.delivered.keys())
          if (!entry.consumers.has(consumerKey)) entry.delivered.delete(consumerKey);
        const intervals = group.flatMap(({ connection }) =>
          connection.source !== 'embedded' && connection.refreshMs > 0
            ? [Math.max(1000, connection.refreshMs)]
            : [],
        );
        entry.interval = intervals.length ? Math.min(...intervals) : 0;
        if (created && entry.interval > 0) void poll(entry);
        else {
          flush(entry);
          if (previousInterval !== entry.interval && !entry.running) schedule(entry);
        }
      }
    },
    refresh(statusKey: string): Promise<void> {
      const matches = [...entries.values()].filter((entry) =>
        [...entry.consumers.values()].some((consumer) => consumer.statusKey === statusKey),
      );
      if (!matches.length)
        return Promise.reject(new Error('Enable this connection before refreshing.'));
      return Promise.all(matches.map(poll)).then(() => undefined);
    },
    dispose() {
      disposed = true;
      for (const entry of [...entries.values()]) release(entry);
    },
  };
}
