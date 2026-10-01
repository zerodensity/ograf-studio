import { create } from 'zustand';
import { SCRIPT_LOG_EVENT, type ScriptLogEntry } from '@ograf-editor/scene-model';

export interface ScriptLogRow extends ScriptLogEntry {
  id: number;
  count: number;
}
export const useScriptLogsStore = create<{
  entries: ScriptLogRow[];
  paused: boolean;
}>(() => ({ entries: [], paused: false }));

let pending: ScriptLogRow[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;
const limit = 200;

function append(rows: ScriptLogRow[], entry: ScriptLogRow) {
  const last = rows.at(-1);
  if (
    last &&
    last.level === entry.level &&
    last.source === entry.source &&
    last.message === entry.message
  ) {
    rows[rows.length - 1] = { ...last, frame: entry.frame, count: last.count + entry.count };
  } else {
    rows.push(entry);
    if (rows.length > limit) rows.shift();
  }
}

function flush() {
  timer = undefined;
  const entries = [...useScriptLogsStore.getState().entries];
  for (const row of pending) append(entries, row);
  pending = [];
  useScriptLogsStore.setState({ entries });
}

export function clearScriptLogs() {
  clearTimeout(timer);
  timer = undefined;
  pending = [];
  useScriptLogsStore.setState({ entries: [] });
}

export function setScriptLogsPaused(paused: boolean) {
  if (paused && pending.length) {
    clearTimeout(timer);
    flush();
  }
  useScriptLogsStore.setState({ paused });
}

/** Collect only project-console events; batch UI notifications instead of rerendering each frame. */
export function installScriptLogs(target: Window) {
  const receive = (event: Event) => {
    if (useScriptLogsStore.getState().paused) return;
    const entry = (event as CustomEvent<ScriptLogEntry>).detail;
    if (
      !entry ||
      !['log', 'info', 'warn', 'error', 'debug'].includes(entry.level) ||
      typeof entry.message !== 'string' ||
      typeof entry.source !== 'string'
    )
      return;
    append(pending, {
      level: entry.level,
      message: entry.message.slice(0, 4000),
      source: entry.source.slice(0, 200),
      frame:
        typeof entry.frame === 'number' && Number.isFinite(entry.frame) ? entry.frame : undefined,
      id: ++nextId,
      count: 1,
    });
    timer ??= setTimeout(flush, 100);
  };
  target.addEventListener(SCRIPT_LOG_EVENT, receive);
  return () => {
    target.removeEventListener(SCRIPT_LOG_EVENT, receive);
    clearTimeout(timer);
    timer = undefined;
    pending = [];
  };
}
