import { DEFAULT_PUBLIC_MARKET_SYMBOLS, type FieldValue } from '@ograf-editor/scene-model';

export const PUBLIC_MARKET_FX_QUOTES = ['EUR', 'GBP', 'JPY', 'CHF', 'TRY', 'CAD'] as const;
const COINBASE = 'https://api.exchange.coinbase.com';
const FX_URL = `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${PUBLIC_MARKET_FX_QUOTES.join(',')}&providers=ecb`;
const COLORS = { up: '#44e6ad', down: '#ff667d', flat: '#c5d8e7', stale: '#e6be67' };
const FONT = 'Roboto Condensed, Arial Narrow, Arial, sans-serif';
const QUOTE_TTL = 15_000;
const STATS_TTL = 60_000;
const FX_TTL = 3_600_000;
const CRYPTO_STALE = 90_000;
const FX_STALE = 6 * FX_TTL;
const iso = (value: number) => new Date(value).toISOString();
const direction = (change: number) => (change > 0 ? '▲' : change < 0 ? '▼' : '•');
const percentage = (change: number) =>
  `${direction(change)} ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;

export type PublicMarketsSnapshot = Record<string, FieldValue>;

/** Discoverable output keys for mapping fields without fetching or touching editorial controls. */
export function publicMarketFieldKeys(
  symbols: readonly string[] = DEFAULT_PUBLIC_MARKET_SYMBOLS,
): string[] {
  const products = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))];
  return [
    'version',
    'generatedAt',
    'status',
    'source',
    'asOf',
    'cryptoStatus',
    'cryptoFresh',
    'fxStatus',
    'fxFresh',
    'fxDate',
    'movers',
    'cryptoItems',
    'fxItems',
    'errors',
    ...products.flatMap((product) =>
      ['Price', 'Change', 'Color', 'Stale', 'AsOf'].map(
        (suffix) => `${product.replace(/-USD$/, '').toLowerCase()}${suffix}`,
      ),
    ),
    ...PUBLIC_MARKET_FX_QUOTES.map((quote) => `usd${quote.toLowerCase()}`),
    ...Array.from({ length: Math.max(6, products.length) }, (_, index) =>
      ['Symbol', 'Price', 'Change', 'Color'].map((suffix) => `mover${index + 1}${suffix}`),
    ).flat(),
    'changeChartData',
    ...products.flatMap((product) =>
      [
        'PriceValue',
        'ChangeValue',
        'HighValue',
        'LowValue',
        'OpenValue',
        'Available',
        'RangeChartData',
      ].map((suffix) => `${product.replace(/-USD$/, '').toLowerCase()}${suffix}`),
    ),
  ];
}

interface CryptoQuote {
  symbol: string;
  price: number;
  open: number;
  change: number;
  high: number;
  low: number;
  tradeAt: number;
  fetchedAt: number;
}
interface FxQuote {
  quote: string;
  price: number;
  date: string;
  fetchedAt: number;
}
interface Failure {
  message: string;
  failedAt: string;
}
interface Attempt {
  nextAt: number;
  failures: number;
}
interface ProviderOptions {
  symbols?: readonly string[];
  fetcher?: typeof fetch;
  now?: () => number;
}
export interface PublicMarketsProvider {
  fetchSnapshot(options?: { signal?: AbortSignal }): Promise<PublicMarketsSnapshot>;
  dispose(): void;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid provider record');
  return value as Record<string, unknown>;
}
function numeric(value: unknown): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '')
    throw new Error('Invalid provider number');
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('Invalid provider number');
  return result;
}
export function normalizePublicCrypto(
  symbol: string,
  tick: unknown,
  rawStats: unknown,
  fetchedAt: number,
): CryptoQuote {
  const ticker = record(tick),
    stats = record(rawStats);
  const price = numeric(ticker.price),
    open = numeric(stats.open);
  const change = ((price - open) / open) * 100;
  const tradeAt = Date.parse(String(ticker.time));
  const high = numeric(stats.high),
    low = numeric(stats.low);
  if (
    price <= 0 ||
    open <= 0 ||
    !Number.isFinite(change) ||
    high <= 0 ||
    low <= 0 ||
    !Number.isFinite(tradeAt) ||
    tradeAt > fetchedAt + 60_000
  )
    throw new Error(`Invalid ${symbol} quote or source time`);
  return {
    symbol,
    price,
    open,
    change,
    high,
    low,
    tradeAt,
    fetchedAt,
  };
}
export function normalizePublicFx(payload: unknown, fetchedAt: number): FxQuote[] {
  if (!Array.isArray(payload)) throw new Error('FX provider did not return an array');
  const values = payload
    .map(record)
    .filter(
      (item) =>
        item.base === 'USD' && PUBLIC_MARKET_FX_QUOTES.some((quote) => quote === item.quote),
    );
  const rows = values.map((item) => {
    const price = numeric(item.rate),
      date = String(item.date);
    if (
      price <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      Date.parse(date) > fetchedAt + 86_400_000
    )
      throw new Error('Invalid FX reference rate or date');
    return { quote: String(item.quote), price, date, fetchedAt };
  });
  if (
    rows.length !== PUBLIC_MARKET_FX_QUOTES.length ||
    new Set(rows.map((row) => row.quote)).size !== rows.length
  )
    throw new Error('FX response is incomplete');
  return PUBLIC_MARKET_FX_QUOTES.map((quote) => rows.find((row) => row.quote === quote)!);
}

function tickerItem(
  id: string,
  label: string,
  value: string,
  detail: string,
  color: string,
  pale: boolean,
): FieldValue {
  const runs = [
    { text: `${label}   `, color: pale ? '#081521' : '#a7c0d3', fontWeight: 600 },
    { text: `${value}   `, color: pale ? '#081521' : '#f1f7fb', fontWeight: 700 },
    { text: detail, color, fontWeight: 600 },
  ];
  // Optional null values are omitted so this remains compatible with recursive GDD array fields.
  return {
    id,
    name: label,
    width: pale ? 490 : 430,
    height: 52,
    element: {
      type: 'text',
      content: runs.map((run) => run.text).join(''),
      runs,
      color: pale ? '#081521' : '#f1f7fb',
      strokeColor: 'transparent',
      strokeWidth: 0,
      fontFamily: FONT,
      fontSize: 30,
      fontWeight: 600,
      textAlign: 'left',
      verticalAlign: 'middle',
      lineHeight: 1,
      letterSpacing: 0,
      baselineShift: 0,
      textTransform: 'none',
      minFontSize: 30,
      overflowPolicy: 'clip',
      autoFit: 'fixed',
      direction: 'ltr',
      language: 'en',
      textAnimation: {
        type: 'none',
        split: 'grapheme',
        durationFrames: 18,
        cursor: 'none',
        cursorBlinkFrames: 30,
        replayOnUpdate: false,
      },
    },
  };
}

class ProviderError extends Error {
  retryAfterMs = 0;
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/** Browser-native, read-only public data. Instances are cached by normalized connection identity. */
export function createPublicMarketsProvider(options: ProviderOptions = {}): PublicMarketsProvider {
  const fetcher = options.fetcher ?? fetch,
    now = options.now ?? Date.now;
  const products = [...(options.symbols ?? DEFAULT_PUBLIC_MARKET_SYMBOLS)].map((value) =>
    value.trim().toUpperCase(),
  );
  if (
    !products.length ||
    products.length > 16 ||
    new Set(products).size !== products.length ||
    products.some((product) => !/^[A-Z0-9]{1,12}-USD$/.test(product))
  )
    throw new Error('Use 1–16 unique Coinbase USD product IDs');
  const crypto = new Map<string, CryptoQuote>();
  const stats = new Map<string, { value: unknown; at: number }>();
  const attempts = new Map<string, Attempt>();
  const errors: Record<string, Failure> = {};
  let fx: FxQuote[] = [],
    nextRequestAt = 0,
    inFlight: Promise<void> | undefined;
  const lifetime = new AbortController();

  async function request(url: string, caller?: AbortSignal): Promise<unknown> {
    const signal = caller ? AbortSignal.any([caller, lifetime.signal]) : lifetime.signal;
    aborted(signal);
    // A single provider schedules below Coinbase's 10 requests/second/IP public limit.
    const delay = Math.max(0, nextRequestAt - now());
    nextRequestAt = Math.max(nextRequestAt, now()) + 140;
    if (delay)
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, delay);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    aborted(signal);
    const response = await fetcher(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    });
    if (!response.ok) {
      const error = new ProviderError(`Provider HTTP ${response.status}`);
      error.retryAfterMs = Math.min(
        300_000,
        Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000,
      );
      throw error;
    }
    const text = await response.text();
    if (text.length > 1_048_576) throw new Error('Provider response exceeds 1 MiB');
    return JSON.parse(text) as unknown;
  }
  async function refreshOne(
    key: string,
    ttl: number,
    task: () => Promise<void>,
    signal?: AbortSignal,
  ) {
    if ((attempts.get(key)?.nextAt ?? 0) > now()) return;
    try {
      await task();
      aborted(signal);
      aborted(lifetime.signal);
      attempts.set(key, { nextAt: now() + ttl, failures: 0 });
      delete errors[key];
    } catch (error) {
      aborted(signal);
      aborted(lifetime.signal);
      const failures = (attempts.get(key)?.failures ?? 0) + 1;
      attempts.set(key, {
        failures,
        nextAt:
          now() +
          Math.max(
            error instanceof ProviderError ? error.retryAfterMs : 0,
            Math.min(300_000, Math.min(ttl, QUOTE_TTL) * 2 ** Math.min(failures, 5)),
          ),
      });
      errors[key] = {
        message: error instanceof Error ? error.message : String(error),
        failedAt: iso(now()),
      };
    }
  }
  async function refresh(signal?: AbortSignal) {
    aborted(signal);
    aborted(lifetime.signal);
    const tasks = products.map((product) =>
      refreshOne(
        product,
        QUOTE_TTL,
        async () => {
          let stat = stats.get(product);
          if (!stat || now() - stat.at >= STATS_TTL) {
            const value = await request(`${COINBASE}/products/${product}/stats`, signal);
            stat = { value, at: now() };
            stats.set(product, stat);
          }
          const ticker = await request(`${COINBASE}/products/${product}/ticker`, signal);
          const quote = normalizePublicCrypto(product.slice(0, -4), ticker, stat.value, now());
          aborted(signal);
          aborted(lifetime.signal);
          crypto.set(product, quote);
        },
        signal,
      ),
    );
    tasks.push(
      refreshOne(
        'FX',
        FX_TTL,
        async () => {
          const rows = normalizePublicFx(await request(FX_URL, signal), now());
          aborted(signal);
          aborted(lifetime.signal);
          fx = rows;
        },
        signal,
      ),
    );
    await Promise.all(tasks);
  }
  function snapshot(): PublicMarketsSnapshot {
    const at = now();
    const quotes = products.map((product) => {
      const quote = crypto.get(product),
        symbol = product.slice(0, -4);
      const stale =
        !quote || at - quote.fetchedAt > CRYPTO_STALE || at - quote.tradeAt > CRYPTO_STALE;
      return {
        symbol,
        available: !!quote,
        stale,
        priceText: quote
          ? quote.price.toLocaleString('en-US', {
              minimumFractionDigits: quote.price < 10 ? 4 : 2,
              maximumFractionDigits: quote.price < 10 ? 4 : 2,
            })
          : '—',
        changeText: quote ? percentage(quote.change) : 'WAITING',
        change: quote?.change ?? 0,
        color: stale
          ? COLORS.stale
          : quote!.change > 0
            ? COLORS.up
            : quote!.change < 0
              ? COLORS.down
              : COLORS.flat,
        tradeTime: quote ? iso(quote.tradeAt) : 'No quote received',
      };
    });
    const currencies = PUBLIC_MARKET_FX_QUOTES.map((currency) => {
      const quote = fx.find((row) => row.quote === currency);
      return {
        quote: currency,
        available: !!quote,
        stale:
          !quote || at - quote.fetchedAt > FX_STALE || at - Date.parse(quote.date) > 7 * 86_400_000,
        priceText: quote ? quote.price.toFixed(4) : '—',
        date: quote?.date ?? 'awaiting data',
      };
    });
    const cryptoFresh = quotes.every((quote) => !quote.stale),
      fxFresh = currencies.every((quote) => !quote.stale);
    const cryptoStatus = cryptoFresh
      ? 'LIVE · COINBASE · 24H CHANGE'
      : quotes.every((quote) => quote.available)
        ? 'STALE · LAST QUOTES'
        : 'CONNECTING · COINBASE';
    const fxDate = currencies.find((quote) => quote.available)?.date ?? 'awaiting data';
    const fxStatus = `${fxFresh ? 'ECB REFERENCE' : currencies.every((quote) => quote.available) ? 'STALE REFERENCE' : 'CONNECTING'} · ${fxDate}`;
    const times = [...crypto.values()].map((quote) => quote.tradeAt);
    const movers = quotes
      .filter((quote) => quote.available)
      .sort((a, b) => b.change - a.change)
      .map((quote) => ({
        id: quote.symbol,
        symbol: quote.symbol,
        price: quote.priceText,
        change: quote.changeText,
        color: quote.color,
        stale: quote.stale,
        tradeTime: quote.tradeTime,
      }));
    const data: PublicMarketsSnapshot = {
      version: 1,
      generatedAt: iso(at),
      status: cryptoFresh && fxFresh ? 'CONNECTED' : 'DEGRADED',
      source: 'Coinbase Exchange / ECB via Frankfurter',
      asOf: times.length ? iso(Math.min(...times)) : 'No quote received',
      cryptoStatus,
      cryptoFresh,
      fxStatus,
      fxFresh,
      fxDate,
      movers,
      cryptoItems: quotes.map((quote) =>
        tickerItem(
          `crypto-${quote.symbol.toLowerCase()}`,
          quote.symbol,
          quote.priceText,
          quote.available ? `${quote.changeText}${quote.stale ? ' STALE' : ''}` : 'WAITING',
          quote.stale
            ? '#8c5b00'
            : quote.change > 0
              ? '#08734d'
              : quote.change < 0
                ? '#b5293b'
                : '#33495b',
          true,
        ),
      ),
      fxItems: currencies.map((quote) =>
        tickerItem(
          `fx-${quote.quote.toLowerCase()}`,
          `USD/${quote.quote}`,
          quote.priceText,
          quote.stale ? (quote.available ? 'STALE REF' : 'WAITING') : 'ECB REF',
          quote.stale ? COLORS.stale : '#74c7ef',
          false,
        ),
      ),
      errors: Object.fromEntries(Object.entries(errors).map(([key, value]) => [key, { ...value }])),
    };
    for (const quote of quotes)
      Object.assign(data, {
        [`${quote.symbol.toLowerCase()}Price`]: quote.priceText,
        [`${quote.symbol.toLowerCase()}Change`]: quote.changeText,
        [`${quote.symbol.toLowerCase()}Color`]: quote.color,
        [`${quote.symbol.toLowerCase()}Stale`]: quote.stale,
        [`${quote.symbol.toLowerCase()}AsOf`]: quote.tradeTime,
      });
    for (const quote of currencies) data[`usd${quote.quote.toLowerCase()}`] = quote.priceText;
    for (let index = 0; index < Math.max(6, products.length); index++) {
      const quote = movers[index];
      Object.assign(data, {
        [`mover${index + 1}Symbol`]: quote?.symbol ?? '—',
        [`mover${index + 1}Price`]: quote?.price ?? '—',
        [`mover${index + 1}Change`]: quote?.change ?? 'WAITING',
        [`mover${index + 1}Color`]: quote?.color ?? COLORS.stale,
      });
    }
    // Keep numeric values separate from formatted operator text. Missing observations never
    // become zero-valued bars or alert inputs; Keep last and Available express that state.
    for (const [index, product] of products.entries()) {
      const quote = crypto.get(product);
      const prefix = product.slice(0, -4).toLowerCase();
      data[`${prefix}Available`] = !!quote;
      if (!quote) continue;
      Object.assign(data, {
        [`${prefix}PriceValue`]: quote.price,
        [`${prefix}ChangeValue`]: quote.change,
        [`${prefix}HighValue`]: quote.high,
        [`${prefix}LowValue`]: quote.low,
        [`${prefix}OpenValue`]: quote.open,
        [`${prefix}RangeChartData`]: JSON.stringify({
          labels: ['24H low', 'Latest', '24H high'],
          datasets: [
            {
              label: `${quote.symbol} / USD`,
              data: [quote.low, quote.price, quote.high],
              backgroundColor: quotes[index]!.stale
                ? [COLORS.stale, COLORS.stale, COLORS.stale]
                : [COLORS.down, '#74c7ef', COLORS.up],
              borderColor: '#74c7ef',
            },
          ],
        }),
      });
    }
    if (quotes.every((quote) => quote.available)) {
      data.changeChartData = JSON.stringify({
        labels: quotes.map((quote) => quote.symbol),
        datasets: [
          {
            label: '24-hour change (%)',
            data: quotes.map((quote) => quote.change),
            backgroundColor: quotes.map((quote) => quote.color),
            borderColor: '#74c7ef',
          },
        ],
      });
    }
    return data;
  }
  return {
    async fetchSnapshot({ signal } = {}) {
      aborted(signal);
      aborted(lifetime.signal);
      if (!inFlight)
        inFlight = refresh(signal).finally(() => {
          inFlight = undefined;
        });
      await inFlight;
      aborted(signal);
      aborted(lifetime.signal);
      return snapshot();
    },
    dispose() {
      lifetime.abort();
    },
  };
}
