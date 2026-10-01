/** Browser event also crosses separately bundled Studio/runtime module instances. */
export const SCRIPT_LOG_EVENT = 'ograf:script-log';
export type ScriptLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
export interface ScriptLogEntry {
  level: ScriptLogLevel;
  source: string;
  frame?: number | undefined;
  message: string;
}

let current: { source: string; frame?: number | undefined } = { source: 'Script' };

export function withScriptLogContext<T>(source: string, frame: unknown, run: () => T): T {
  const previous = current;
  current = { source, frame: typeof frame === 'number' ? frame : undefined };
  try {
    return run();
  } finally {
    current = previous;
  }
}

/** Bounded snapshots, without invoking object getters or toJSON hooks. */
export function formatScriptLog(args: unknown[]): string {
  const seen = new WeakSet<object>();
  let remaining = 100;
  const format = (value: unknown, depth: number): string => {
    if (--remaining < 0) return '�';
    if (typeof value === 'string') return value.slice(0, 1000);
    if (value === null || typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (value instanceof Error) return `${value.name}: ${value.message}`.slice(0, 1000);
    if (depth >= 3) return Array.isArray(value) ? '[Array]' : '[Object]';
    const keys = Object.keys(value);
    const parts = keys.slice(0, 20).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const content =
        descriptor && 'value' in descriptor ? format(descriptor.value, depth + 1) : '[Getter]';
      return Array.isArray(value) ? content : `${key}: ${content}`;
    });
    if (keys.length > 20) parts.push('…');
    return Array.isArray(value) ? `[${parts.join(', ')}]` : `{${parts.join(', ')}}`;
  };
  return args
    .slice(0, 20)
    .map((arg) => format(arg, 0))
    .join(' ')
    .slice(0, 4000);
}

/** Only project code receives this console; the application's native console stays untouched. */
export function createScriptConsole(moduleName?: string): Console {
  const output = Object.create(console) as Console;
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    Object.defineProperty(output, level, {
      value: (...args: unknown[]) => {
        console[level](...args);
        if (typeof window === 'undefined') return;
        try {
          const detail: ScriptLogEntry = {
            level,
            source: moduleName ?? current.source,
            frame: current.frame,
            message: formatScriptLog(args),
          };
          window.dispatchEvent(new CustomEvent(SCRIPT_LOG_EVENT, { detail }));
        } catch {
          /* Logging must never make a valid expression fail. */
        }
      },
    });
  }
  return output;
}

export const scriptConsole = createScriptConsole();
