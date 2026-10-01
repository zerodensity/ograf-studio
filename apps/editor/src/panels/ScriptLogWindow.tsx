import { useEffect, useRef } from 'react';
import { clearScriptLogs, setScriptLogsPaused, useScriptLogsStore } from '../state/scriptLogsStore';

export function ScriptLogWindow() {
  const { entries, paused } = useScriptLogsStore();
  const output = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [entries]);
  return (
    <section className="scripts-log" aria-label="Script console">
      <div className="scripts-toolbar">
        <strong>Console</strong>
        <button type="button" onClick={() => setScriptLogsPaused(!paused)}>
          {paused ? 'Resume logs' : 'Pause logs'}
        </button>
        <button type="button" onClick={clearScriptLogs}>
          Clear logs
        </button>
      </div>
      <div
        ref={output}
        className="scripts-log-output"
        role="log"
        aria-label="Script logs"
        aria-live="off"
        onScroll={() => {
          const node = output.current;
          if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {entries.length === 0 ? (
          <p>No script logs yet. Use console.log() in your code.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`scripts-log-row scripts-log-${entry.level}`}>
              <small>
                {entry.level} · {entry.source}
                {entry.frame === undefined ? '' : ` · frame ${entry.frame}`}
                {entry.count > 1 ? ` · ×${entry.count}` : ''}
              </small>
              <pre>{entry.message}</pre>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
