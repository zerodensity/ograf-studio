import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateExpression, evaluateCompositionScript } from './expressions';
import { scriptModules } from './scriptModules';
import { SCRIPT_LOG_EVENT, formatScriptLog, type ScriptLogEntry } from './scriptConsole';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function capture() {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  const entries: ScriptLogEntry[] = [];
  target.addEventListener(SCRIPT_LOG_EVENT, (event) => entries.push((event as CustomEvent).detail));
  return entries;
}

describe('project script console', () => {
  it('forwards to the native console without replacing it and identifies expression frames', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const entries = capture();
    expect(
      evaluateExpression(
        'console.log("hello", data); return 12;',
        { frame: 8, data: { a: 2 } },
        undefined,
        {
          currentLayer: { id: 'title', name: 'Title' },
          currentProperty: { name: 'x', value: 0, layerId: 'title' },
        },
      ),
    ).toBe(12);
    expect(console.log).toBe(log);
    expect(log).toHaveBeenCalledWith('hello', { a: 2 });
    expect(entries).toEqual([
      { level: 'log', source: 'Title.x', frame: 8, message: 'hello {a: 2}' },
    ]);
  });
  it('attributes helper logs and restores the caller context after nested expressions and failures', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const entries = capture();
    const modules = scriptModules({
      enabled: true,
      source: '',
      modules: [
        {
          fileName: 'helpers.js',
          source: 'export function run() { console.info("helper"); return 4; }',
        },
      ],
    });
    evaluateCompositionScript(
      'console.info("before"); layer("Other").x; console.info("after"); helpers.run();',
      { frame: 10 },
      () => {
        try {
          evaluateExpression('console.info("nested"); throw new Error("failed");', { frame: 2 });
        } catch {
          /* Caller continues. */
        }
        return 0;
      },
      { modules },
    );
    expect(entries.map(({ source, frame }) => [source, frame])).toEqual([
      ['Composition', 10],
      ['Expression', 2],
      ['Composition', 10],
      ['helpers.js', 10],
    ]);
  });
  it.each(['log', 'info', 'warn', 'error', 'debug'] as const)('captures console.%s', (level) => {
    vi.spyOn(console, level).mockImplementation(() => {});
    const entries = capture();
    evaluateExpression(`console.${level}("test"); return 1;`, {});
    expect(entries[0]?.level).toBe(level);
  });
  it('does not break evaluation when log formatting fails', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    capture();
    const broken = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('no');
        },
      },
    );
    expect(evaluateExpression('console.log(data); return 2;', { data: broken })).toBe(2);
  });
  it('formats bounded snapshots of cycles, errors and getters without invoking getters', () => {
    const getter = vi.fn();
    const value: Record<string, unknown> = {};
    value.self = value;
    Object.defineProperty(value, 'secret', { enumerable: true, get: getter });
    expect(formatScriptLog([value, new Error('failed')])).toContain('[Circular]');
    expect(formatScriptLog([value])).toContain('[Getter]');
    expect(getter).not.toHaveBeenCalled();
    expect(formatScriptLog(Array(30).fill('x'.repeat(10000))).length).toBeLessThanOrEqual(4000);
  });
});
