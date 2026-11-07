import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SLOT_FIELDS = {
  identity: ['cryptoStatus'],
  crypto: ['cryptoItems', 'cryptoStatus'],
  fx: ['fxItems', 'fxStatus'],
  strip: [
    'btcPrice',
    'btcChange',
    'btcColor',
    'ethPrice',
    'ethChange',
    'ethColor',
    'solPrice',
    'solChange',
    'solColor',
    'cryptoStatus',
  ],
  board: [
    ...Array.from({ length: 6 }, (_, index) =>
      ['Symbol', 'Price', 'Change', 'Color'].map((suffix) => `mover${index + 1}${suffix}`),
    ).flat(),
    'cryptoStatus',
    'asOf',
  ],
};

function assertLocalUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('The example bridge accepts loopback HTTP URLs only');
  return url.href;
}

export function disconnectedSnapshot(previous = {}) {
  const data = structuredClone(previous);
  Object.assign(data, {
    status: 'DISCONNECTED',
    cryptoFresh: false,
    fxFresh: false,
    cryptoStatus: 'FEED DISCONNECTED · LAST QUOTES',
    fxStatus: 'FEED DISCONNECTED · LAST REFERENCE',
  });
  for (const key of Object.keys(data)) {
    if (key.endsWith('Color')) data[key] = '#e6be67';
    if (key.endsWith('Stale')) data[key] = true;
  }
  for (const key of ['cryptoItems', 'fxItems']) {
    for (const item of data[key] ?? []) {
      const runs = item.element?.runs;
      if (!runs?.length) continue;
      const last = runs.at(-1);
      last.color = key === 'cryptoItems' ? '#8c5b00' : '#e6be67';
      if (!last.text.includes('STALE')) last.text += ' STALE';
      item.element.content = runs.map((run) => run.text).join('');
    }
  }
  return data;
}

const isRevisionConflict = (error) => /revision (?:conflict|changed)/i.test(String(error.message));

export function chooseUpdates(playout, feed, expectedSetId) {
  if (
    !expectedSetId ||
    !playout.sessionId ||
    playout.sourceSetId !== expectedSetId ||
    (playout.openSetId !== undefined && playout.openSetId !== expectedSetId) ||
    playout.loading ||
    playout.sourceChanged ||
    !playout.snapshot?.loaded ||
    playout.snapshot.paused
  )
    return [];
  const operations = [];
  for (const [slotId, keys] of Object.entries(SLOT_FIELDS)) {
    const slot = playout.snapshot.slots[slotId];
    if (
      !slot?.current?.stateId ||
      slot.transition ||
      slot.pending ||
      slot.readiness === 'failed' ||
      playout.recentCommands?.some(
        (command) => command.slotId === slotId && command.status === 'running',
      )
    )
      continue;
    const state = playout.states?.find(
      (item) => item.id === slot.current.stateId && item.slotId === slotId,
    );
    const template = playout.templates?.find((item) => item.id === state?.templateId);
    const availableFields = new Set(template?.fields?.map((field) => field.key) ?? []);
    const data = {};
    for (const key of keys) {
      if (
        availableFields.has(key) &&
        Object.hasOwn(feed, key) &&
        JSON.stringify(slot.current.data?.[key]) !== JSON.stringify(feed[key])
      )
        data[key] = feed[key];
    }
    if (Object.keys(data).length)
      operations.push({
        type: 'update',
        mode: 'in-place',
        slotId,
        stateId: slot.current.stateId,
        data,
      });
  }
  return operations;
}

export async function callStudio(endpoint, name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Studio HTTP ${response.status}`);
  const body = await response.text();
  const event = body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .at(-1);
  const rpc = JSON.parse(event ? event.slice(6) : body);
  if (rpc.error) throw new Error(rpc.error.message ?? 'Studio RPC failed');
  const result = rpc.result;
  const value =
    result.structuredContent ??
    JSON.parse(result.content.find((item) => item.type === 'text')?.text ?? '{}');
  if (result.isError) throw new Error(typeof value === 'string' ? value : JSON.stringify(value));
  return value;
}

export function startStudioBridge({
  studio,
  setId,
  target = 'preview',
  feedUrl = 'http://127.0.0.1:5250/market.json',
  intervalMs = 2000,
  log = console.log,
  call = callStudio,
} = {}) {
  const endpoint = assertLocalUrl(studio);
  const source = assertLocalUrl(feedUrl);
  if (!setId || typeof setId !== 'string')
    throw new Error('--set must be the economy template set ID');
  if (!['preview', 'live'].includes(target)) throw new Error('--target must be preview or live');
  let stopped = false,
    timer,
    receipt = null,
    lastError = '',
    lastFeed = null,
    feedDisconnected = false;
  const tick = async () => {
    try {
      let playout = await call(endpoint, 'ograf_get_playout', { target });
      if (receipt) {
        if (playout.sessionId !== receipt.sessionId) receipt = null;
        else {
          const status = playout.recentCommands?.find(
            (item) => item.requestId === receipt.requestId,
          );
          if (status?.status === 'running') return;
          if (status?.status === 'failed') log(`Feed update failed: ${status.error}`);
          if (!status) {
            // The previous HTTP result was uncertain. Reuse its exact idempotency key and body.
            try {
              playout = await call(endpoint, 'ograf_control_playout', receipt.args);
            } catch (error) {
              if (isRevisionConflict(error)) receipt = null;
              throw error;
            }
            if (playout.request?.status === 'running') return;
          }
          receipt = null;
        }
      }
      let feed;
      try {
        const response = await fetch(source, {
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Market relay HTTP ${response.status}`);
        feed = await response.json();
        if (feed.version !== 1 || !Array.isArray(feed.cryptoItems) || !Array.isArray(feed.fxItems))
          throw new Error('Market relay returned an invalid snapshot');
        lastFeed = feed;
        if (feedDisconnected) log('Market relay connected');
        feedDisconnected = false;
      } catch (error) {
        if (!feedDisconnected) log(`Market relay unavailable: ${error.message}`);
        feedDisconnected = true;
        feed = disconnectedSnapshot(lastFeed ?? {});
      }
      // Re-read before each later slot: an operator may issue Take/Out meanwhile.
      const slotIds = chooseUpdates(playout, feed, setId).map((operation) => operation.slotId);
      for (let index = 0; index < slotIds.length; index++) {
        if (stopped) break;
        if (index) playout = await call(endpoint, 'ograf_get_playout', { target });
        const operation = chooseUpdates(playout, feed, setId).find(
          (item) => item.slotId === slotIds[index],
        );
        if (!operation) continue;
        const args = {
          target,
          expectedRevision: playout.revision,
          requestId: `economy-feed-${randomUUID()}`,
          operation,
        };
        receipt = { sessionId: playout.sessionId, requestId: args.requestId, args };
        try {
          playout = await call(endpoint, 'ograf_control_playout', args);
        } catch (error) {
          // A rejected revision was never admitted. Re-read and consciously plan a new update later.
          if (isRevisionConflict(error)) receipt = null;
          throw error;
        }
        if (playout.request?.status === 'running') break;
        if (playout.request?.status === 'failed')
          throw new Error(playout.request.error ?? 'Feed update failed');
        receipt = null;
      }
      if (lastError) log('Studio feed bridge connected');
      lastError = '';
    } catch (error) {
      const message = String(error.message ?? error);
      if (message !== lastError) log(`Studio feed bridge: ${message}`);
      lastError = message;
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };
  void tick();
  return {
    close() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  if (!args.includes('--studio') || !args.includes('--set')) {
    console.error(
      'Usage: node studio-bridge.mjs --studio http://127.0.0.1:5242/mcp --set SET_ID [--target preview|live] [--feed http://127.0.0.1:5250/market.json]',
    );
    process.exitCode = 1;
  } else {
    const bridge = startStudioBridge({
      studio: option('--studio'),
      setId: option('--set'),
      target: args.includes('--target') ? option('--target') : 'preview',
      feedUrl: args.includes('--feed') ? option('--feed') : undefined,
    });
    console.log(
      'Economy feed bridge active. It updates already on-air lanes only; it never takes graphics in or out.',
    );
    process.on('SIGINT', () => bridge.close());
    process.on('SIGTERM', () => bridge.close());
  }
}
