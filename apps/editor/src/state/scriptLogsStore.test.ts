import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCRIPT_LOG_EVENT } from '@ograf-editor/scene-model';
import {
  clearScriptLogs,
  installScriptLogs,
  setScriptLogsPaused,
  useScriptLogsStore,
} from './scriptLogsStore';

let target: EventTarget;
let dispose: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  clearScriptLogs();
  setScriptLogsPaused(false);
  target = new EventTarget();
  dispose = installScriptLogs(target as Window);
});
afterEach(() => {
  dispose();
  clearScriptLogs();
  vi.useRealTimers();
});
function log(message = 'test', frame = 1) {
  target.dispatchEvent(
    new CustomEvent(SCRIPT_LOG_EVENT, {
      detail: { level: 'log', source: 'Title.x', frame, message },
    }),
  );
}
describe('script log history', () => {
  it('batches updates and counts repeated frames', () => {
    const listener = vi.fn();
    const unsubscribe = useScriptLogsStore.subscribe(listener);
    for (let i = 0; i < 100; i++) log('same', i);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useScriptLogsStore.getState().entries).toMatchObject([
      { message: 'same', count: 100, frame: 99 },
    ]);
    log('same', 100);
    vi.advanceTimersByTime(100);
    expect(useScriptLogsStore.getState().entries[0]?.count).toBe(101);
    unsubscribe();
  });
  it('bounds pending and displayed history', () => {
    for (let i = 0; i < 500; i++) log(String(i));
    vi.advanceTimersByTime(100);
    expect(useScriptLogsStore.getState().entries).toHaveLength(200);
    expect(useScriptLogsStore.getState().entries[0]?.message).toBe('300');
  });
  it('clears queued logs and pauses collection without replaying dropped messages', () => {
    log();
    clearScriptLogs();
    vi.advanceTimersByTime(100);
    expect(useScriptLogsStore.getState().entries).toEqual([]);
    setScriptLogsPaused(true);
    log('paused');
    vi.advanceTimersByTime(100);
    expect(useScriptLogsStore.getState().entries).toEqual([]);
    setScriptLogsPaused(false);
    log('resumed');
    vi.advanceTimersByTime(100);
    expect(useScriptLogsStore.getState().entries).toMatchObject([{ message: 'resumed' }]);
  });
  it('ignores unrelated or malformed events and removes the listener on cleanup', () => {
    target.dispatchEvent(new Event('other'));
    target.dispatchEvent(
      new CustomEvent(SCRIPT_LOG_EVENT, { detail: { level: 'bogus', message: 'bad' } }),
    );
    dispose();
    log();
    vi.advanceTimersByTime(100);
    expect(useScriptLogsStore.getState().entries).toEqual([]);
  });
});
