import type { TickerUpdateStatus } from '@ograf-editor/ograf-runtime';

export function tickerUpdateSummary(status: TickerUpdateStatus): string {
  const parts = [
    status.updatedCount ? `${status.updatedCount} changed` : '',
    status.addedCount ? `${status.addedCount} added` : '',
    status.removedCount ? `${status.removedCount} removed` : '',
    status.preparingCount ? `${status.preparingCount} preparing` : '',
  ].filter(Boolean);
  return [
    status.policy === 'immediate'
      ? 'Updates apply when their artwork is ready.'
      : 'Visible items finish their pass. Changes apply on the next appearance.',
    parts.join(' · '),
    status.error,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Status events fire only when the pending queue changes; no frame polling is needed. */
export function subscribeTickerUpdates(
  root: EventTarget,
  read: () => TickerUpdateStatus[],
  publish: (statuses: TickerUpdateStatus[]) => void,
): () => void {
  let signature = '';
  const refresh = () => {
    const statuses = read();
    const next = JSON.stringify(statuses);
    if (signature === next) return;
    signature = next;
    publish(statuses);
  };
  root.addEventListener('ograf-ticker-status', refresh);
  refresh();
  return () => root.removeEventListener('ograf-ticker-status', refresh);
}
