import { describe, expect, it, vi } from 'vitest';
import {
  getTickerUpdateStatuses,
  setTickerOutputActive,
  type TickerUpdateStatus,
} from './tickerRendering';

class StatusNode extends EventTarget {
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  parentElement: StatusNode | null = null;
  shadowRoot: StatusNode | null = null;
  children: StatusNode[] = [];
  ownerDocument = {
    defaultView: {
      CustomEvent,
      getComputedStyle: vi.fn(() => {
        throw new Error('Ticker status must not measure CSS visibility.');
      }),
    },
  };
  append(...nodes: StatusNode[]) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  querySelectorAll(selector: string): StatusNode[] {
    if (selector !== '*') throw new Error(`Unexpected selector: ${selector}`);
    return this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
  }
  closest(selector: string): StatusNode | null {
    const match = /^\[data-([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match) throw new Error(`Unexpected closest selector: ${selector}`);
    const key = match[1]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (
      Object.hasOwn(this.dataset, key) &&
      (match[2] === undefined || this.dataset[key] === match[2])
    )
      return this;
    return this.parentElement?.closest(selector) ?? null;
  }
}

const html = (node: StatusNode) => node as unknown as HTMLElement;
const root = (node: StatusNode) => node as unknown as ParentNode;
function status(patch: Partial<TickerUpdateStatus> = {}): TickerUpdateStatus {
  return {
    id: 'ticker-instance-1',
    layerId: 'ticker-news',
    name: 'News ticker',
    policy: 'next-appearance',
    pendingCount: 3,
    updatedCount: 1,
    addedCount: 1,
    removedCount: 1,
    preparingCount: 0,
    ...patch,
  };
}
function ticker(value = status()) {
  const node = new StatusNode();
  node.dataset.ografTickerStatus = JSON.stringify(value);
  return node;
}
function snapshot(template: string, state: string, child: StatusNode) {
  const node = new StatusNode();
  node.dataset.ografTransitionSnapshot = 'true';
  node.dataset.ografTransitionTemplate = template;
  node.dataset.ografTransitionState = state;
  node.append(child);
  return node;
}

describe('ticker update status across output snapshots', () => {
  it('excludes inactive prepared queues and errors, then reveals the retained queue on activation', () => {
    const surface = new StatusNode();
    const prepared = new StatusNode();
    const value = status({ error: 'Image could not be prepared.' });
    prepared.append(ticker(value));
    surface.append(prepared);
    const events: Event[] = [];
    prepared.addEventListener('ograf-ticker-status', (event) => events.push(event));
    setTickerOutputActive(html(prepared), false);
    expect(getTickerUpdateStatuses(root(surface))).toEqual([]);
    setTickerOutputActive(html(prepared), false);
    expect(events).toHaveLength(1);
    setTickerOutputActive(html(prepared), true);
    expect(getTickerUpdateStatuses(root(surface))).toEqual([value]);
    expect(events).toHaveLength(2);
    expect(events[1]!.bubbles).toBe(true);
    expect(events[1]!.composed).toBe(true);
  });

  it('reports one logical queue for outgoing and incoming copies of the same ticker', () => {
    const surface = new StatusNode();
    surface.append(
      snapshot('template-news', 'state-news', ticker(status({ id: 'outgoing', pendingCount: 3 }))),
      snapshot('template-news', 'state-news', ticker(status({ id: 'incoming', pendingCount: 1 }))),
    );
    expect(getTickerUpdateStatuses(root(surface))).toEqual([
      status({ id: 'incoming', pendingCount: 1 }),
    ]);
  });

  it('keeps active outgoing status when the incoming copy is still only prepared', () => {
    const surface = new StatusNode();
    const outgoing = snapshot('template-news', 'state-news', ticker(status({ id: 'outgoing' })));
    const prepared = snapshot('template-news', 'state-news', ticker(status({ id: 'prepared' })));
    setTickerOutputActive(html(prepared), false);
    surface.append(outgoing, prepared);
    expect(getTickerUpdateStatuses(root(surface))).toEqual([status({ id: 'outgoing' })]);
  });

  it('keeps queues from distinct states or templates even when their source layer IDs match', () => {
    const surface = new StatusNode();
    const values = ['a', 'b', 'c'].map((id) => status({ id }));
    surface.append(
      snapshot('template-a', 'state-a', ticker(values[0]!)),
      snapshot('template-a', 'state-b', ticker(values[1]!)),
      snapshot('template-b', 'state-a', ticker(values[2]!)),
    );
    expect(getTickerUpdateStatuses(root(surface))).toEqual(values);
  });

  it('collects serialized status through multiple open shadow roots from another runtime bundle', () => {
    const surface = new StatusNode();
    const graphic = new StatusNode();
    graphic.shadowRoot = new StatusNode();
    const nestedGraphic = new StatusNode();
    nestedGraphic.shadowRoot = new StatusNode();
    const value = status();
    nestedGraphic.shadowRoot.append(ticker(value));
    graphic.shadowRoot.append(nestedGraphic);
    surface.append(graphic);
    expect(getTickerUpdateStatuses(root(surface))).toEqual([value]);
  });

  it('does not traverse an explicitly inactive prepared graphic into its open shadow root', () => {
    const surface = new StatusNode();
    const graphic = new StatusNode();
    graphic.shadowRoot = new StatusNode();
    graphic.shadowRoot.append(ticker(status({ error: 'Prepared image failed.' })));
    setTickerOutputActive(html(graphic), false);
    surface.append(graphic);
    expect(getTickerUpdateStatuses(root(surface))).toEqual([]);
    setTickerOutputActive(html(graphic), true);
    expect(getTickerUpdateStatuses(root(surface))).toHaveLength(1);
  });

  it('uses distinct identities when valid template/state IDs contain path separators', () => {
    const surface = new StatusNode();
    const values = [status({ id: 'one' }), status({ id: 'two' })];
    surface.append(
      snapshot('template/a', 'state', ticker(values[0]!)),
      snapshot('template', 'a/state', ticker(values[1]!)),
    );
    expect(getTickerUpdateStatuses(root(surface))).toEqual(values);
  });

  it('does not infer active state from opacity, display, visibility or layout size', () => {
    const node = ticker();
    node.style = {
      opacity: '0',
      display: 'none',
      visibility: 'hidden',
      width: '0px',
      height: '0px',
    };
    expect(getTickerUpdateStatuses(root(node))).toEqual([status()]);
    expect(node.ownerDocument.defaultView.getComputedStyle).not.toHaveBeenCalled();
  });

  it('ignores malformed status and retains independent standalone ticker identities', () => {
    const surface = new StatusNode();
    const malformed = new StatusNode();
    malformed.dataset.ografTickerStatus = '{broken';
    const missingId = new StatusNode();
    missingId.dataset.ografTickerStatus = '{}';
    const first = status({ id: 'first' });
    const second = status({ id: 'second' });
    surface.append(malformed, missingId, ticker(first), ticker(second));
    expect(getTickerUpdateStatuses(root(surface))).toEqual([first, second]);
  });
});
