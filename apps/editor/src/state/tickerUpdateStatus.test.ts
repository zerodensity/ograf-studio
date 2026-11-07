import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TickerUpdateStatus } from '@ograf-editor/ograf-runtime';
import { TickerPendingUpdates } from '../panels/TickerPendingUpdates';
import { subscribeTickerUpdates, tickerUpdateSummary } from './tickerUpdateStatus';

const pending = (patch: Partial<TickerUpdateStatus> = {}): TickerUpdateStatus => ({
  id: 'ticker-instance-1',
  layerId: 'ticker-main',
  name: 'News ticker',
  pendingCount: 3,
  updatedCount: 1,
  addedCount: 1,
  removedCount: 1,
  preparingCount: 1,
  policy: 'next-appearance',
  ...patch,
});

describe('ticker pending updates in Studio controls', () => {
  it('shows a compact pending count with a complete update description', () => {
    const markup = renderToStaticMarkup(
      createElement(TickerPendingUpdates, { statuses: [pending()] }),
    );
    expect(markup).toContain('News ticker');
    expect(markup).toContain('3 pending');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('1 changed · 1 added · 1 removed · 1 preparing');
    expect(markup).toContain('Visible items finish their pass.');
  });

  it('does not add empty status rows to Properties, fullscreen or dockable controls', () => {
    expect(
      renderToStaticMarkup(
        createElement(TickerPendingUpdates, {
          statuses: [pending({ pendingCount: 0 })],
        }),
      ),
    ).toBe('');
  });

  it('retains resource failures and explains immediate updates', () => {
    const status = pending({ pendingCount: 0, policy: 'immediate', error: 'Image unavailable.' });
    const markup = renderToStaticMarkup(
      createElement(TickerPendingUpdates, { statuses: [status] }),
    );
    expect(markup).toContain('needs attention');
    expect(markup).toContain('Image unavailable.');
    expect(tickerUpdateSummary(status)).toContain('Updates apply when their artwork is ready.');
  });

  it('publishes changed statuses from the output without a timer or frame callback', () => {
    const root = new EventTarget();
    let statuses = [pending()];
    const read = vi.fn(() => statuses);
    const publish = vi.fn();
    const dispose = subscribeTickerUpdates(root, read, publish);
    expect(publish).toHaveBeenCalledTimes(1);
    root.dispatchEvent(new Event('ograf-ticker-status'));
    expect(publish).toHaveBeenCalledTimes(1);
    statuses = [pending({ pendingCount: 2 })];
    root.dispatchEvent(new Event('ograf-ticker-status'));
    expect(publish).toHaveBeenCalledTimes(2);
    statuses = [];
    root.dispatchEvent(new Event('ograf-ticker-status'));
    expect(publish).toHaveBeenLastCalledWith([]);
    dispose();
    root.dispatchEvent(new Event('ograf-ticker-status'));
    expect(read).toHaveBeenCalledTimes(4);
  });
});
