import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCrypto,
  normalizeFx,
  createState,
  snapshot,
  PRODUCTS,
  FX_QUOTES,
} from './market-feed.mjs';

const NOW = Date.parse('2026-10-25T10:00:00Z');
const stats = { open: '100', high: '110', low: '90' };
const quote = (price = '105', time = new Date(NOW - 2000).toISOString()) => ({ price, time });
const fx = () =>
  FX_QUOTES.map((currency, index) => ({
    base: 'USD',
    quote: currency,
    date: '2026-10-23',
    rate: index + 1,
  }));

test('24h change comes from the actual last trade and rolling open', () => {
  const data = normalizeCrypto('BTC', quote(), stats, NOW);
  assert.equal(data.price, 105);
  assert.equal(data.change, 5);
  assert.equal(data.tradeAt, NOW - 2000);
  assert.equal(normalizeCrypto('BTC', quote('95'), stats, NOW).change, -5);
});

test('invalid provider prices and source times are rejected', () => {
  for (const price of ['', null, 'NaN', '-1', '0'])
    assert.throws(() => normalizeCrypto('BTC', quote(price), stats, NOW));
  assert.throws(() => normalizeCrypto('BTC', quote('100', 'invalid'), stats, NOW));
  assert.throws(() =>
    normalizeCrypto('BTC', quote('100', new Date(NOW + 120_000).toISOString()), stats, NOW),
  );
  assert.throws(() => normalizeCrypto('BTC', quote(), { ...stats, open: '0' }, NOW));
});

test('all six quote cards, mover rows and native ticker values share one signed direction indicator', () => {
  for (const [price, change, color] of [
    ['105', '▲ +5.00%', '#44e6ad'],
    ['95', '▼ -5.00%', '#ff667d'],
    ['100', '• +0.00%', '#c5d8e7'],
  ]) {
    const state = createState();
    for (const symbol of PRODUCTS)
      state.crypto.set(symbol, normalizeCrypto(symbol, quote(price), stats, NOW));
    const data = snapshot(state, NOW);
    for (let index = 0; index < PRODUCTS.length; index++) {
      const prefix = PRODUCTS[index].toLowerCase();
      assert.equal(data[`${prefix}Change`], change);
      assert.equal(data[`${prefix}Color`], color);
      assert.equal(data[`mover${index + 1}Change`], change);
      assert.equal(data[`mover${index + 1}Color`], color);
      assert.equal(data.cryptoItems[index].element.runs.at(-1).text, change);
      assert.equal(data.cryptoItems[index].element.content.match(/[▲▼•]/g).length, 1);
    }
  }
});

test('initial output shows waiting rather than invented market prices', () => {
  const data = snapshot(createState(), NOW);
  assert.equal(data.status, 'DEGRADED');
  assert.equal(data.btcPrice, '—');
  assert.equal(data.cryptoFresh, false);
  assert.equal(data.fxFresh, false);
  assert.equal(data.movers.length, 0);
  assert.ok(data.cryptoItems.every((item) => item.element.content.includes('WAITING')));
});

test('stale last values survive with visible stale labels and color; recovery clears them', () => {
  const state = createState();
  for (const symbol of PRODUCTS)
    state.crypto.set(symbol, normalizeCrypto(symbol, quote(), stats, NOW));
  state.fx = normalizeFx(fx(), NOW);
  assert.equal(snapshot(state, NOW).status, 'CONNECTED');
  const stale = snapshot(state, NOW + 91_000);
  assert.equal(stale.btcPrice, '105.00');
  assert.equal(stale.btcStale, true);
  assert.ok(stale.cryptoItems[0].element.content.includes('STALE'));
  assert.equal(stale.cryptoStatus, 'STALE · LAST QUOTES');
  for (const symbol of PRODUCTS)
    state.crypto.set(
      symbol,
      normalizeCrypto(
        symbol,
        quote('106', new Date(NOW + 91_000).toISOString()),
        stats,
        NOW + 91_000,
      ),
    );
  assert.equal(snapshot(state, NOW + 91_000).status, 'CONNECTED');
});

test('fresh HTTP receipt does not turn an old exchange trade into live data', () => {
  const state = createState();
  state.crypto.set(
    'BTC',
    normalizeCrypto('BTC', quote('100', new Date(NOW - 120_000).toISOString()), stats, NOW),
  );
  const data = snapshot(state, NOW);
  assert.equal(data.btcStale, true);
  assert.ok(data.cryptoItems[0].element.content.includes('STALE'));
});

test('FX is explicitly daily reference data, including weekends, never a simulated live change', () => {
  const state = createState();
  state.fx = normalizeFx(fx(), NOW);
  const data = snapshot(state, NOW);
  assert.equal(data.fxFresh, true);
  assert.equal(data.fxDate, '2026-10-23');
  assert.match(data.fxStatus, /^ECB REFERENCE/);
  assert.ok(data.fxItems.every((item) => item.element.content.includes('ECB REF')));
  assert.equal(snapshot(state, NOW + 6 * 60 * 60 * 1000 + 1).fxFresh, false);
  assert.throws(() => normalizeFx(fx().slice(1), NOW));
  assert.throws(() => normalizeFx([...fx().slice(1), fx()[1]], NOW));
});

test('native ticker item identity and widths survive changes and sort order', () => {
  const state = createState();
  const first = snapshot(state, NOW);
  for (const symbol of PRODUCTS)
    state.crypto.set(symbol, normalizeCrypto(symbol, quote(), stats, NOW));
  state.fx = normalizeFx(fx(), NOW);
  const second = snapshot(state, NOW);
  assert.equal(second.cryptoItems[0].element.color, '#081521');
  assert.equal(second.cryptoItems[0].element.runs[0].color, '#081521');
  assert.equal(second.cryptoItems[0].element.runs[1].color, '#081521');
  assert.equal(second.cryptoItems[0].element.runs[2].color, '#08734d');
  assert.equal(second.btcColor, '#44e6ad');
  assert.equal(second.fxItems[0].element.color, '#f1f7fb');
  assert.deepEqual(
    first.cryptoItems.map(({ id, width }) => ({ id, width })),
    second.cryptoItems.map(({ id, width }) => ({ id, width })),
  );
  assert.ok(
    second.cryptoItems.every(
      (item) => item.element.content === item.element.runs.map((run) => run.text).join(''),
    ),
  );
});
