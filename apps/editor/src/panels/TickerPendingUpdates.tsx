import type { TickerUpdateStatus } from '@ograf-editor/ograf-runtime';
import { tickerUpdateSummary } from '../state/tickerUpdateStatus';
import './TickerPendingUpdates.css';

export function TickerPendingUpdates({ statuses }: { statuses: TickerUpdateStatus[] }) {
  const pending = statuses.filter((status) => status.pendingCount > 0 || status.error);
  if (!pending.length) return null;
  return (
    <div className="ticker-pending-updates" aria-label="Ticker updates" aria-live="polite">
      {pending.map((status) => (
        <div
          key={status.id}
          className={status.error ? 'ticker-pending-error' : undefined}
          title={tickerUpdateSummary(status)}
        >
          <span>{status.name || 'Ticker'}</span>
          <span>
            {status.pendingCount} pending{status.error ? ' · needs attention' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
