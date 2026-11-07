import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTickerElement,
  tickerErrors,
  parseChartData,
  type TickerItem,
} from '@ograf-editor/scene-model';
import {
  createPublicMarketsProvider,
  normalizePublicCrypto,
  normalizePublicFx,
  PUBLIC_MARKET_FX_QUOTES,
  publicMarketFieldKeys,
} from './publicMarkets';

const INITIAL = Date.parse('2026-10-25T10:00:00Z');

it('exposes only actual provider keys for automatic field mapping', async () => {
  const feed = mockFeed();
  const provider = createPublicMarketsProvider({
    symbols: ['ETH-USD'],
    fetcher: feed.fetcher,
    now: feed.now,
  });
  const snapshot = await provider.fetchSnapshot();
  expect(publicMarketFieldKeys(['ETH-USD']).sort()).toEqual(Object.keys(snapshot).sort());
  expect(publicMarketFieldKeys(['ETH-USD'])).not.toContain('headline');
  expect(publicMarketFieldKeys(['ETH-USD'])).not.toContain('btcPrice');
  provider.dispose();
});
const fx = () =>
  PUBLIC_MARKET_FX_QUOTES.map((quote, index) => ({
    base: 'USD',
    quote,
    rate: index + 1,
    date: '2026-10-23',
  }));
function mockFeed() {
  let time = INITIAL,
    price = '105',
    fail = false;
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (fail) return new Response('unavailable', { status: 503 });
    const value = String(url).includes('frankfurter')
      ? fx()
      : String(url).endsWith('/stats')
        ? { open: '100', high: '110', low: '90' }
        : { price, time: new Date(time - 1000).toISOString() };
    return new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  });
  return {
    fetcher,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    setPrice: (next: string) => {
      price = next;
    },
    setFailure: (next: boolean) => {
      fail = next;
    },
  };
}
async function settle<T>(promise: Promise<T>): Promise<T> {
  // Attach rejection handling immediately, before advancing abort/delay timers.
  const result = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await result;
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

describe('native public market data provider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches browser CORS data without credentials and emits valid atomic tickers with matching direction colors', async () => {
    const feed = mockFeed();
    const provider = createPublicMarketsProvider({ ...feed, symbols: ['BTC-USD', 'ETH-USD'] });
    const data = await settle(provider.fetchSnapshot());
    expect(data.status).toBe('CONNECTED');
    expect(data.btcChange).toBe('▲ +5.00%');
    expect(data.btcColor).toBe('#44e6ad');
    expect(data.ethChange).toBe(data.btcChange);
    expect(data.fxStatus).toBe('ECB REFERENCE · 2026-10-23');
    for (const [, options] of feed.fetcher.mock.calls) {
      expect(options).toMatchObject({ mode: 'cors', credentials: 'omit', cache: 'no-store' });
      expect(options?.headers).toEqual({ Accept: 'application/json' });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(tickerErrors({ ...createTickerElement(), items: data.cryptoItems })).toEqual([]);
    expect(tickerErrors({ ...createTickerElement(), items: data.fxItems })).toEqual([]);
    const crypto = data.cryptoItems as unknown as TickerItem[];
    expect(crypto[0]!.element).toMatchObject({
      color: '#081521',
      runs: [{ color: '#081521' }, { color: '#081521' }, { color: '#08734d', text: '▲ +5.00%' }],
    });
    expect(JSON.stringify(data.cryptoItems)).not.toContain('null');
    provider.dispose();
  });

  it('deduplicates concurrent reads and uses separate quote, stats and FX cache lifetimes', async () => {
    const feed = mockFeed();
    const provider = createPublicMarketsProvider({ ...feed, symbols: ['BTC-USD'] });
    await settle(Promise.all([provider.fetchSnapshot(), provider.fetchSnapshot()]));
    expect(feed.fetcher).toHaveBeenCalledTimes(3);
    await settle(provider.fetchSnapshot());
    expect(feed.fetcher).toHaveBeenCalledTimes(3);
    feed.advance(15_001);
    feed.setPrice('95');
    const down = await settle(provider.fetchSnapshot());
    expect(feed.fetcher).toHaveBeenCalledTimes(4);
    expect(down.btcChange).toBe('▼ -5.00%');
    expect(down.btcColor).toBe('#ff667d');
    feed.advance(45_001);
    feed.setPrice('100');
    const flat = await settle(provider.fetchSnapshot());
    expect(feed.fetcher).toHaveBeenCalledTimes(6);
    expect(flat.btcChange).toBe('• +0.00%');
    expect(flat.btcColor).toBe('#c5d8e7');
    expect(
      feed.fetcher.mock.calls.filter(([url]) => String(url).includes('frankfurter')),
    ).toHaveLength(1);
    provider.dispose();
  });

  it('retains genuine last values through failures, labels stale data and recovers without invented prices', async () => {
    const feed = mockFeed();
    const provider = createPublicMarketsProvider({ ...feed, symbols: ['BTC-USD'] });
    await settle(provider.fetchSnapshot());
    feed.advance(91_000);
    feed.setFailure(true);
    const stale = await settle(provider.fetchSnapshot());
    expect(stale.btcPrice).toBe('105.00');
    expect(stale.btcStale).toBe(true);
    expect(stale.cryptoStatus).toBe('STALE · LAST QUOTES');
    expect(stale.btcColor).toBe('#e6be67');
    expect(stale.btcAvailable).toBe(true);
    expect(stale.btcPriceValue).toBe(105);
    expect(parseChartData(stale.changeChartData).datasets[0]!.data).toEqual([5]);
    expect(parseChartData(stale.changeChartData).datasets[0]!.backgroundColor).toEqual(['#e6be67']);
    expect(parseChartData(stale.btcRangeChartData).datasets[0]!.data).toEqual([90, 105, 110]);
    const requests = feed.fetcher.mock.calls.length;
    await settle(provider.fetchSnapshot());
    expect(feed.fetcher).toHaveBeenCalledTimes(requests);
    feed.advance(30_001);
    feed.setFailure(false);
    feed.setPrice('103');
    const recovered = await settle(provider.fetchSnapshot());
    expect(recovered.btcPrice).toBe('103.00');
    expect(recovered.cryptoFresh).toBe(true);
    expect(recovered.errors).toEqual({});
    provider.dispose();
  });

  it('shows waiting when the initial requests fail and rejects malformed provider numbers', async () => {
    const feed = mockFeed();
    feed.setFailure(true);
    const provider = createPublicMarketsProvider({ ...feed, symbols: ['BTC-USD'] });
    const data = await settle(provider.fetchSnapshot());
    expect(data.btcPrice).toBe('—');
    expect(data.btcChange).toBe('WAITING');
    expect(data.cryptoFresh).toBe(false);
    expect(data.movers).toEqual([]);
    expect(data.btcAvailable).toBe(false);
    for (const suffix of [
      'PriceValue',
      'ChangeValue',
      'LowValue',
      'HighValue',
      'OpenValue',
      'RangeChartData',
    ])
      expect(Object.hasOwn(data, `btc${suffix}`)).toBe(false);
    expect(Object.hasOwn(data, 'changeChartData')).toBe(false);
    expect(() =>
      normalizePublicCrypto(
        'BTC',
        { price: 'NaN', time: new Date(INITIAL).toISOString() },
        { open: '100', high: '110', low: '90' },
        INITIAL,
      ),
    ).toThrow();
    expect(() => normalizePublicFx(fx().slice(1), INITIAL)).toThrow('incomplete');
    provider.dispose();
  });

  it('aborts pending browser work and does not let a disposed provider publish a response', async () => {
    const feed = mockFeed();
    const controller = new AbortController();
    controller.abort();
    const provider = createPublicMarketsProvider({ ...feed, symbols: ['BTC-USD'] });
    await expect(provider.fetchSnapshot({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(feed.fetcher).not.toHaveBeenCalled();
    const pending = provider.fetchSnapshot();
    provider.dispose();
    await expect(settle(pending)).rejects.toMatchObject({ name: 'AbortError' });
    expect(feed.fetcher.mock.calls.length).toBeLessThan(3);
    await expect(provider.fetchSnapshot()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('validates configured product identities before any network request', () => {
    expect(() => createPublicMarketsProvider({ symbols: [] })).toThrow();
    expect(() => createPublicMarketsProvider({ symbols: ['BTC-USD', 'BTC-USD'] })).toThrow();
    expect(() => createPublicMarketsProvider({ symbols: ['../../private'] })).toThrow();
  });

  it('publishes full-precision numeric observations and signed chart data in configured symbol order', async () => {
    const feed = mockFeed();
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith('/ticker'))
        return new Response(
          JSON.stringify({
            price: String(url).includes('/ETH-USD/') ? '95.125' : '105',
            time: new Date(INITIAL).toISOString(),
          }),
        );
      return feed.fetcher(url, options);
    });
    const provider = createPublicMarketsProvider({
      symbols: ['ETH-USD', 'BTC-USD'],
      fetcher,
      now: feed.now,
    });
    const data = await settle(provider.fetchSnapshot());
    expect(data.ethPriceValue).toBe(95.125);
    expect(data.ethChangeValue).toBeCloseTo(-4.875);
    expect(data.ethOpenValue).toBe(100);
    expect(data.ethLowValue).toBe(90);
    expect(data.ethHighValue).toBe(110);
    expect(data.ethAvailable).toBe(true);
    const comparison = parseChartData(data.changeChartData);
    expect(comparison.labels).toEqual(['ETH', 'BTC']);
    expect(comparison.datasets[0]!.data).toEqual([-4.875, 5]);
    expect(comparison.datasets[0]!.backgroundColor).toEqual(['#ff667d', '#44e6ad']);
    expect(comparison.mode).toBeUndefined();
    const range = parseChartData(data.ethRangeChartData);
    expect(range.labels).toEqual(['24H low', 'Latest', '24H high']);
    expect(range.datasets[0]!.data).toEqual([90, 95.125, 110]);
    expect(data.ethPrice).toBe('95.13');
    expect(data.ethChange).toBe('▼ -4.88%');
    expect(publicMarketFieldKeys(['ETH-USD', 'BTC-USD']).sort()).toEqual(Object.keys(data).sort());
    provider.dispose();
  });

  it('omits incomplete comparisons and missing numeric observations rather than filling them with zero', async () => {
    const feed = mockFeed();
    const provider = createPublicMarketsProvider({
      symbols: ['BTC-USD', 'ETH-USD'],
      now: feed.now,
      fetcher: async (url, options) =>
        String(url).includes('/ETH-USD/')
          ? new Response('unavailable', { status: 503 })
          : feed.fetcher(url, options),
    });
    const data = await settle(provider.fetchSnapshot());
    expect(data.btcAvailable).toBe(true);
    expect(data.btcPriceValue).toBe(105);
    expect(parseChartData(data.btcRangeChartData).datasets[0]!.data).toEqual([90, 105, 110]);
    expect(data.ethAvailable).toBe(false);
    for (const suffix of [
      'PriceValue',
      'ChangeValue',
      'LowValue',
      'HighValue',
      'OpenValue',
      'RangeChartData',
    ])
      expect(Object.hasOwn(data, `eth${suffix}`)).toBe(false);
    expect(Object.hasOwn(data, 'changeChartData')).toBe(false);
    provider.dispose();
  });

  it('rejects non-finite derived changes instead of serializing invalid chart points to null', () => {
    expect(() =>
      normalizePublicCrypto(
        'BTC',
        { price: Number.MAX_VALUE, time: new Date(INITIAL).toISOString() },
        { open: Number.MIN_VALUE, high: Number.MAX_VALUE, low: Number.MIN_VALUE },
        INITIAL,
      ),
    ).toThrow();
  });

  it('paces sixteen products below the public request limit while allowing overlapping responses', async () => {
    vi.setSystemTime(INITIAL);
    const starts: number[] = [];
    let active = 0,
      maximumActive = 0;
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      starts.push(Date.now());
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
      active -= 1;
      const value = String(url).includes('frankfurter')
        ? fx()
        : String(url).endsWith('/stats')
          ? { open: '100', high: '110', low: '90' }
          : { price: '105', time: new Date(Date.now()).toISOString() };
      return new Response(JSON.stringify(value));
    });
    const symbols = Array.from({ length: 16 }, (_, index) => `ASSET${index}-USD`);
    const provider = createPublicMarketsProvider({ symbols, fetcher, now: () => Date.now() });
    await settle(provider.fetchSnapshot());
    expect(starts).toHaveLength(33); // 16 statistics + 16 quotes + one shared FX request.
    for (let index = 1; index < starts.length; index++)
      expect(starts[index]! - starts[index - 1]!).toBeGreaterThanOrEqual(140);
    for (const start of starts)
      expect(
        starts.filter((value) => value >= start && value < start + 1000).length,
      ).toBeLessThanOrEqual(8);
    expect(maximumActive).toBeGreaterThan(1); // Pacing request starts does not serialize slow responses.
    provider.dispose();
  });
});
