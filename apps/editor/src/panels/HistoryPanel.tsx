import { useSyncExternalStore } from 'react';
import { getHistorySnapshot, jumpToHistoryPosition, subscribeHistory } from '../state/historyStore';
import { Panel } from './Panel';
import './HistoryPanel.css';

export function HistoryPanel() {
  const history = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistorySnapshot);
  const steps = [...history.past, ...history.future];
  const current = history.past.length;
  return (
    <Panel title="History">
      <div className="history-pane">
        <p>Choose a step to return to that point. New edits discard later steps.</p>
        <ol className="history-list" aria-label="Edit history">
          <li>
            <button
              type="button"
              className={current === 0 ? 'current' : ''}
              aria-current={current === 0 ? 'step' : undefined}
              onClick={() => jumpToHistoryPosition(0)}
            >
              <span>Earliest available state</span>
              {current === 0 && <small>Current</small>}
            </button>
          </li>
          {steps.map((item, index) => {
            const position = index + 1;
            const isCurrent = position === current;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`${isCurrent ? 'current' : ''}${position > current ? ' future' : ''}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => jumpToHistoryPosition(position)}
                >
                  <span>{item.label}</span>
                  <small title={new Date(item.timestamp).toLocaleString()}>
                    {isCurrent ? 'Current · ' : ''}
                    {new Date(item.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </small>
                </button>
              </li>
            );
          })}
        </ol>
        {!steps.length && <p>No edits yet.</p>}
      </div>
    </Panel>
  );
}
