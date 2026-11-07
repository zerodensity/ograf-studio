import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

// Prices are always provider observations. No randomized/demo values are generated.
export const PRODUCTS = ['BTC', 'ETH', 'SOL', 'XRP', 'LINK', 'AVAX'];
export const FX_QUOTES = ['EUR', 'GBP', 'JPY', 'CHF', 'TRY', 'CAD'];
export const COLORS = { up: '#44e6ad', down: '#ff667d', flat: '#c5d8e7', stale: '#e6be67' };
const COINBASE = 'https://api.exchange.coinbase.com';
const FX_URL = `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${FX_QUOTES.join(',')}&providers=ecb`;
const CRYPTO_STALE_MS = 90_000;
const FX_FETCH_STALE_MS = 6 * 60 * 60 * 1000;
const FONT = 'Roboto Condensed, Arial Narrow, Arial, sans-serif';
const iso = (value) => new Date(value).toISOString();
const number = (value) => {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n))
    throw new Error('Provider returned an invalid number');
  return n;
};
const money = (value) =>
  value.toLocaleString('en-US', {
    minimumFractionDigits: value < 10 ? 4 : 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  });
const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const arrow = (value) => (value > 0 ? '▲' : value < 0 ? '▼' : '•');

export function normalizeCrypto(symbol, ticker, stats, fetchedAt = Date.now()) {
  const price = number(ticker.price);
  const open = number(stats.open);
  const tradeAt = Date.parse(ticker.time);
  if (price <= 0 || open <= 0 || !Number.isFinite(tradeAt) || tradeAt > fetchedAt + 60_000)
    throw new Error(`Invalid ${symbol} quote or source time`);
  return {
    symbol,
    name: `${symbol} / USD`,
    price,
    change: ((price - open) / open) * 100,
    open,
    high: number(stats.high),
    low: number(stats.low),
    tradeAt,
    fetchedAt,
    source: 'Coinbase Exchange',
    changeBasis: 'rolling 24 hours',
  };
}

export function normalizeFx(payload, fetchedAt = Date.now()) {
  if (!Array.isArray(payload)) throw new Error('FX provider did not return an array');
  const result = payload
    .filter((item) => item.base === 'USD' && FX_QUOTES.includes(item.quote))
    .map((item) => {
      const rate = number(item.rate);
      if (
        rate <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
        !Number.isFinite(Date.parse(item.date)) ||
        Date.parse(item.date) > fetchedAt + 86_400_000
      )
        throw new Error('Invalid FX rate or publication date');
      return {
        symbol: `USD/${item.quote}`,
        quote: item.quote,
        price: rate,
        date: item.date,
        fetchedAt,
        source: 'ECB via Frankfurter',
        frequency: 'daily reference',
      };
    });
  if (
    result.length !== FX_QUOTES.length ||
    new Set(result.map((item) => item.quote)).size !== FX_QUOTES.length
  )
    throw new Error('FX response is incomplete');
  return FX_QUOTES.map((quote) => result.find((item) => item.quote === quote));
}

export function tickerItem(
  id,
  label,
  value,
  detail,
  color = COLORS.flat,
  width = 490,
  paleRail = false,
) {
  const runs = [
    { text: `${label}   `, color: paleRail ? '#081521' : '#a7c0d3', fontWeight: 600 },
    { text: `${value}   `, color: paleRail ? '#081521' : '#f1f7fb', fontWeight: 700 },
    { text: detail, color, fontWeight: 600 },
  ];
  return {
    id,
    name: label,
    width,
    height: 52,
    element: {
      type: 'text',
      content: runs.map((run) => run.text).join(''),
      runs,
      color: paleRail ? '#081521' : '#f1f7fb',
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

export function createState() {
  return { crypto: new Map(), fx: [], errors: {}, startedAt: Date.now() };
}

export function snapshot(state, now = Date.now()) {
  const crypto = PRODUCTS.map((symbol) => {
    const quote = state.crypto.get(symbol);
    if (!quote)
      return {
        symbol,
        name: `${symbol} / USD`,
        available: false,
        stale: true,
        priceText: '—',
        changeText: 'WAITING',
        color: COLORS.stale,
        tradeTime: 'No quote received',
      };
    const stale = now - quote.fetchedAt > CRYPTO_STALE_MS || now - quote.tradeAt > CRYPTO_STALE_MS;
    return {
      ...quote,
      available: true,
      stale,
      priceText: money(quote.price),
      changeText: `${arrow(quote.change)} ${signed(quote.change)}`,
      color: stale
        ? COLORS.stale
        : quote.change > 0
          ? COLORS.up
          : quote.change < 0
            ? COLORS.down
            : COLORS.flat,
      tradeTime: iso(quote.tradeAt),
      fetchedTime: iso(quote.fetchedAt),
    };
  });
  const fx = FX_QUOTES.map((currency) => {
    const quote = state.fx.find((item) => item.quote === currency);
    if (!quote)
      return {
        symbol: `USD/${currency}`,
        quote: currency,
        available: false,
        stale: true,
        priceText: '—',
        date: 'awaiting data',
      };
    // Weekends/holidays retain the published date. Old daily rates are never called live.
    const stale =
      now - quote.fetchedAt > FX_FETCH_STALE_MS || now - Date.parse(quote.date) > 7 * 86_400_000;
    return { ...quote, available: true, stale, priceText: quote.price.toFixed(4) };
  });
  const cryptoAvailable = crypto.every((quote) => quote.available);
  const cryptoFresh = cryptoAvailable && crypto.every((quote) => !quote.stale);
  const fxAvailable = fx.every((quote) => quote.available);
  const fxFresh = fxAvailable && fx.every((quote) => !quote.stale);
  const cryptoStatus = cryptoFresh
    ? 'LIVE · COINBASE · 24H CHANGE'
    : cryptoAvailable
      ? 'STALE · LAST QUOTES'
      : 'CONNECTING · COINBASE';
  const fxDate = fx.find((quote) => quote.available)?.date ?? 'awaiting data';
  const fxStatus = `${fxFresh ? 'ECB REFERENCE' : fxAvailable ? 'STALE REFERENCE' : 'CONNECTING'} · ${fxDate}`;
  const observed = crypto.filter((quote) => quote.available).map((quote) => quote.tradeAt);
  const data = {
    version: 1,
    generatedAt: iso(now),
    source: 'Coinbase Exchange / ECB via Frankfurter',
    status: cryptoFresh && fxFresh ? 'CONNECTED' : 'DEGRADED',
    asOf: observed.length ? iso(Math.min(...observed)) : 'No quote received',
    cryptoStatus,
    cryptoFresh,
    fxStatus,
    fxDate,
    fxFresh,
    crypto,
    fx,
    cryptoItems: crypto.map((quote) =>
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
        490,
        true,
      ),
    ),
    fxItems: fx.map((quote) =>
      tickerItem(
        `fx-${quote.quote.toLowerCase()}`,
        quote.symbol,
        quote.priceText,
        quote.stale ? (quote.available ? 'STALE REF' : 'WAITING') : 'ECB REF',
        quote.stale ? COLORS.stale : '#74c7ef',
        430,
      ),
    ),
    movers: [...crypto]
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
      })),
    errors: { ...state.errors },
  };
  for (const quote of crypto) {
    const prefix = quote.symbol.toLowerCase();
    Object.assign(data, {
      [`${prefix}Price`]: quote.priceText,
      [`${prefix}Change`]: quote.changeText,
      [`${prefix}Color`]: quote.color,
      [`${prefix}Stale`]: quote.stale,
      [`${prefix}AsOf`]: quote.tradeTime,
    });
  }
  for (const quote of fx) data[`usd${quote.quote.toLowerCase()}`] = quote.priceText;
  for (let index = 0; index < 6; index++) {
    const quote = data.movers[index];
    Object.assign(data, {
      [`mover${index + 1}Symbol`]: quote?.symbol ?? '—',
      [`mover${index + 1}Price`]: quote?.price ?? '—',
      [`mover${index + 1}Change`]: quote?.change ?? 'WAITING',
      [`mover${index + 1}Color`]: quote?.color ?? COLORS.stale,
    });
  }
  return data;
}

async function requestJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: 'application/json', 'User-Agent': 'OGraf-Economy-Example/1.0' },
  });
  if (!response.ok) {
    const error = new Error(`Provider HTTP ${response.status}`);
    // Retry-After is bounded; ordinary failures use exponential backoff below.
    error.retryAfterMs = Math.min(
      300_000,
      Math.max(0, Number(response.headers.get('retry-after')) || 0) * 1000,
    );
    throw error;
  }
  const text = await response.text();
  if (text.length > 1_048_576) throw new Error('Provider response exceeds 1 MiB');
  return JSON.parse(text);
}

export function startFeed({
  port = 5250,
  host = '127.0.0.1',
  cryptoIntervalMs = 15_000,
  fxIntervalMs = 60 * 60 * 1000,
  fetchJson = requestJson,
  now = Date.now,
} = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new Error('Example relay binds to loopback only');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid relay port');
  const state = createState();
  const timers = new Set();
  const subscribers = new Set();
  let closed = false;
  const schedule = (callback, delay) => {
    if (closed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      void callback();
    }, delay);
    timers.add(timer);
  };
  function poll(name, interval, task) {
    let failures = 0;
    const run = async () => {
      let delay = interval;
      try {
        await task();
        failures = 0;
        delete state.errors[name];
      } catch (error) {
        failures += 1;
        state.errors[name] = { message: String(error.message ?? error), failedAt: iso(now()) };
        delay = Math.max(
          error.retryAfterMs || 0,
          Math.min(300_000, interval * 2 ** Math.min(failures, 5)),
        );
      }
      schedule(run, delay);
    };
    return run;
  }
  for (let index = 0; index < PRODUCTS.length; index++) {
    const symbol = PRODUCTS[index];
    let stats,
      statsAt = 0;
    const run = poll(symbol, cryptoIntervalMs, async () => {
      if (!stats || now() - statsAt >= 60_000) {
        stats = await fetchJson(`${COINBASE}/products/${symbol}-USD/stats`);
        statsAt = now();
      }
      const ticker = await fetchJson(`${COINBASE}/products/${symbol}-USD/ticker`);
      state.crypto.set(symbol, normalizeCrypto(symbol, ticker, stats, now()));
    });
    // Spread initial requests; the public API allows ten requests/second per IP.
    schedule(run, index * 500);
  }
  schedule(
    poll('FX', fxIntervalMs, async () => {
      state.fx = normalizeFx(await fetchJson(FX_URL), now());
    }),
    0,
  );
  const server = createServer((request, response) => {
    const origin = request.headers.origin;
    let allowedOrigin = false;
    try {
      allowedOrigin =
        !origin || ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname);
    } catch {
      /* invalid origin */
    }
    if (!allowedOrigin) {
      response.writeHead(403);
      response.end('Loopback clients only');
      return;
    }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405);
      response.end();
      return;
    }
    const path = new URL(request.url ?? '/', `http://${host}`).pathname;
    if (path === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      response.write(`data: ${JSON.stringify(snapshot(state, now()))}\n\n`);
      subscribers.add(response);
      request.on('close', () => subscribers.delete(response));
      return;
    }
    if (!['/', '/market.json', '/health'].includes(path)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const data = snapshot(state, now());
    response.writeHead(path === '/health' && data.status !== 'CONNECTED' ? 503 : 200, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(
      JSON.stringify(
        path === '/health'
          ? {
              status: data.status,
              cryptoStatus: data.cryptoStatus,
              fxStatus: data.fxStatus,
              generatedAt: data.generatedAt,
              errors: data.errors,
            }
          : data,
      ),
    );
  });
  const publish = () => {
    if (subscribers.size) {
      const message = `data: ${JSON.stringify(snapshot(state, now()))}\n\n`;
      for (const response of subscribers) {
        if (response.writableLength > 1_048_576) {
          response.destroy();
          subscribers.delete(response);
        } else response.write(message);
      }
    }
    schedule(publish, 1000);
  };
  schedule(publish, 1000);
  server.listen(port, host);
  return {
    server,
    state,
    close: () => {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      for (const response of subscribers) response.end();
      server.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = startFeed({ port: Number(process.env.ECONOMY_FEED_PORT || 5250) });
  relay.server.on('listening', () =>
    console.log(`Market feed: http://127.0.0.1:${relay.server.address().port}/market.json`),
  );
  relay.server.on('error', (error) => {
    console.error(error.message);
    relay.close();
    process.exitCode = 1;
  });
  process.on('SIGINT', () => relay.close());
  process.on('SIGTERM', () => relay.close());
}
