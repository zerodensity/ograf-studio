import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseUpdates, disconnectedSnapshot } from './studio-bridge.mjs';

test('a stopped relay changes the visible status and color but never invents a replacement quote', () => {
  const previous = {
    btcPrice: '80,000.00',
    btcColor: '#44e6ad',
    btcStale: false,
    cryptoItems: [
      {
        id: 'crypto-btc',
        element: {
          content: 'BTC 80,000.00 +2%',
          runs: [
            { text: 'BTC 80,000.00 ', color: '#081521' },
            { text: '+2%', color: '#08734d' },
          ],
        },
      },
    ],
  };
  const disconnected = disconnectedSnapshot(previous);
  assert.equal(disconnected.btcPrice, previous.btcPrice);
  assert.equal(disconnected.btcStale, true);
  assert.match(disconnected.cryptoStatus, /DISCONNECTED/);
  assert.equal(disconnected.cryptoItems[0].element.runs[0].color, '#081521');
  assert.equal(disconnected.cryptoItems[0].element.runs[1].color, '#8c5b00');
  assert.match(disconnected.cryptoItems[0].element.content, /STALE/);
  assert.equal(previous.btcStale, false);
  assert.deepEqual(disconnectedSnapshot(disconnected), disconnected);
});

const active = () => ({
  sessionId: 'session',
  sourceSetId: 'set-economy',
  openSetId: 'set-economy',
  loading: false,
  sourceChanged: false,
  snapshot: {
    loaded: true,
    paused: false,
    slots: {
      crypto: {
        current: { stateId: 'crypto-on', data: { cryptoStatus: 'OLD', cryptoItems: [] } },
        readiness: 'ready',
      },
      fx: { current: null, readiness: 'idle' },
    },
  },
  states: [{ id: 'crypto-on', slotId: 'crypto', templateId: 'crypto-template' }],
  templates: [{ id: 'crypto-template', fields: [{ key: 'cryptoStatus' }, { key: 'cryptoItems' }] }],
  recentCommands: [],
});

test('only expected set, active settled lanes and real declared fields receive in-place updates', () => {
  const state = active();
  const feed = { cryptoStatus: 'LIVE', cryptoItems: [], unknown: 'not exposed', fxStatus: 'REF' };
  assert.deepEqual(chooseUpdates(state, feed, 'set-economy'), [
    {
      type: 'update',
      mode: 'in-place',
      slotId: 'crypto',
      stateId: 'crypto-on',
      data: { cryptoStatus: 'LIVE' },
    },
  ]);
  assert.deepEqual(chooseUpdates(state, feed, 'other-set'), []);
  state.openSetId = 'other-set';
  assert.deepEqual(chooseUpdates(state, feed, 'set-economy'), []);
});

test('identical values cause no command and source-only edits, paused output and pending transitions are respected', () => {
  const state = active();
  assert.deepEqual(
    chooseUpdates(state, { cryptoStatus: 'OLD', cryptoItems: [] }, 'set-economy'),
    [],
  );
  for (const property of ['transition', 'pending']) {
    state.snapshot.slots.crypto[property] = {};
    assert.deepEqual(chooseUpdates(state, { cryptoStatus: 'LIVE' }, 'set-economy'), []);
    state.snapshot.slots.crypto[property] = null;
  }
  state.snapshot.paused = true;
  assert.deepEqual(chooseUpdates(state, { cryptoStatus: 'LIVE' }, 'set-economy'), []);
  state.snapshot.paused = false;
  state.sourceChanged = true;
  assert.deepEqual(chooseUpdates(state, { cryptoStatus: 'LIVE' }, 'set-economy'), []);
});

test('settled coordinator lanes can retain incoming/outgoing snapshots without blocking current data', () => {
  const state = active();
  state.snapshot.slots.crypto.incoming = structuredClone(state.snapshot.slots.crypto.current);
  state.snapshot.slots.crypto.outgoing = { stateId: 'previous-state', data: {} };
  state.snapshot.slots.crypto.readiness = 'idle';
  assert.deepEqual(chooseUpdates(state, { cryptoStatus: 'LIVE' }, 'set-economy'), [
    {
      type: 'update',
      mode: 'in-place',
      slotId: 'crypto',
      stateId: 'crypto-on',
      data: { cryptoStatus: 'LIVE' },
    },
  ]);
  state.snapshot.slots.crypto.current = null;
  assert.deepEqual(chooseUpdates(state, { cryptoStatus: 'LIVE' }, 'set-economy'), []);
});

test('in-flight updates and hidden templates are not brought on air by a quote refresh', () => {
  const state = active();
  state.recentCommands = [{ slotId: 'crypto', status: 'running' }];
  assert.deepEqual(chooseUpdates(state, { cryptoStatus: 'LIVE' }, 'set-economy'), []);
  state.recentCommands = [];
  state.snapshot.slots.crypto.current = null;
  assert.deepEqual(chooseUpdates(state, { cryptoStatus: 'LIVE' }, 'set-economy'), []);
});

test('visible preview accepts optional openSetId while still requiring the exact source set and loaded session', () => {
  const preview = active();
  delete preview.openSetId;
  assert.equal(chooseUpdates(preview, { cryptoStatus: 'LIVE' }, 'set-economy').length, 1);
  assert.deepEqual(chooseUpdates(preview, { cryptoStatus: 'LIVE' }, 'another-set'), []);
  preview.sessionId = null;
  assert.deepEqual(chooseUpdates(preview, { cryptoStatus: 'LIVE' }, 'set-economy'), []);
});
