import { readFile, writeFile } from 'node:fs/promises';
const endpoint = process.env.OGRAF_MCP_URL ?? 'http://127.0.0.1:5242/mcp';
const path = process.env.AXIS_BUILD_STATE ?? '.axis-build-state.json';
const state = JSON.parse(await readFile(path, 'utf8'));
const panelGap = 16;
const fxReservation = 52 + panelGap;
const watchReservation = 68 + panelGap;
async function call(name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(600000),
  });
  const body = await response.text();
  const data = body
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .at(-1);
  const rpc = JSON.parse(data ? data.slice(6) : body);
  if (rpc.error) throw Error(JSON.stringify(rpc.error));
  let value = rpc.result.structuredContent;
  const raw = rpc.result.content.find((c) => c.type === 'text')?.text;
  if (value === undefined) {
    try {
      value = JSON.parse(raw);
    } catch {
      throw Error(raw);
    }
  }
  if (rpc.result.isError) throw Error(JSON.stringify(value));
  return value;
}
const slots = [
  ['identity', 'Identity & UTC'],
  ['crypto', 'Digital assets crawl'],
  ['fx', 'FX reference crawl'],
  ['strip', 'Market watch cards'],
  ['headline', 'Market brief / alert'],
  ['board', 'Market pulse board'],
].map(([id, name], order) => ({ id, name, order }));
const graph = {
  version: 5,
  id: 'axis-market-network',
  name: 'AXIS / Independent live markets',
  defaultTransitionId: 'axis-dissolve',
  slots,
  states: [],
  transitions: [
    {
      id: 'axis-dissolve',
      name: 'AXIS / Soft reveal',
      durationFrames: 35,
      outgoingFrames: 25,
      incomingStartFrame: 5,
      incomingFrames: 30,
      sharedFrames: 35,
      easing: 'ease-in-out',
      contentMotion: 'fade',
    },
    {
      id: 'reserve-in',
      name: 'Make room, then reveal',
      durationFrames: 75,
      outgoingFrames: 0,
      incomingStartFrame: 35,
      incomingFrames: 40,
      sharedFrames: 35,
      layoutPhase: { startFrame: 0, durationFrames: 30 },
      easing: 'ease-in-out',
      incomingAnimation: {
        type: 'builtin',
        motion: { style: 'slide', direction: 'up', distance: 20, easing: 'cubic-out' },
      },
    },
    {
      id: 'reserve-out',
      name: 'Hide, then restore room',
      durationFrames: 65,
      outgoingFrames: 25,
      incomingStartFrame: 0,
      incomingFrames: 0,
      sharedFrames: 25,
      layoutPhase: { startFrame: 30, durationFrames: 35 },
      easing: 'ease-in-out',
      outgoingAnimation: {
        type: 'builtin',
        motion: { style: 'slide', direction: 'down', distance: 12, easing: 'cubic-in' },
      },
    },
  ],
  routes: [],
  sharedInstances: [],
  initialSharedValues: [],
  layoutRules: [],
};
for (const [id, t] of Object.entries(state.templates)) {
  if (!t.done) throw Error(`Unfinished template ${id}`);
  const slotId = id === 'alert' ? 'headline' : id;
  const item = {
    id: `${id}-on`,
    name: id === 'alert' ? 'Market Alert' : slots.find((s) => s.id === slotId).name,
    slotId,
    templateId: t.templateId,
  };
  if (['headline', 'alert', 'strip', 'identity', 'board'].includes(id)) {
    const c = t.component;
    if (!c) throw Error('Missing component identity');
    graph.sharedInstances.push({
      id: c.instanceId,
      name: `AXIS ${id}`,
      componentAssetId: c.componentId,
      continuityKey: `axis-${id}`,
      slotId,
    });
    item.sharedValues = [];
    for (const [sourceLayerId, layerId] of Object.entries(c.layers)) {
      const layer = t.layers.find((l) => l.id === layerId);
      if (!Number.isFinite(layer?.y)) throw Error('Missing resting layer position');
      for (const [property, value] of [
        ['y', layer.y],
        ['opacity', 0],
      ])
        graph.initialSharedValues.push({
          instanceId: c.instanceId,
          sourceLayerId,
          property,
          value,
        });
      item.sharedValues.push(
        { instanceId: c.instanceId, sourceLayerId, property: 'y', value: layer.y },
        { instanceId: c.instanceId, sourceLayerId, property: 'opacity', value: 1 },
      );
      if (
        (id === 'identity' && layer.name === 'Network plate') ||
        (id === 'board' && layer.name === 'Board glass')
      ) {
        if (!Number.isFinite(layer.height))
          throw Error(
            `Missing resting height for ${id}/${layer.name}; refresh the build-state layer geometry.`,
          );
        const size = {
          instanceId: c.instanceId,
          sourceLayerId,
          property: 'height',
          value: layer.height,
        };
        graph.initialSharedValues.push(size);
        item.sharedValues.push({ ...size });
      }
    }
    const offsets = (amount) =>
      Object.keys(c.layers).map((sourceLayerId) => ({
        instanceId: c.instanceId,
        sourceLayerId,
        property: 'y',
        value: amount,
      }));
    const namedOffset = (name, property, value) => {
      const layer = t.layers.find((layer) => layer.name === name);
      const sourceLayerId = Object.keys(c.layers).find(
        (sourceId) => c.layers[sourceId] === layer?.id,
      );
      if (!sourceLayerId) throw Error(`Missing shared source layer ${id}/${name}`);
      return { instanceId: c.instanceId, sourceLayerId, property, value };
    };
    if (id === 'identity') {
      graph.layoutRules.push({
        id: 'identity-span-fx',
        name: 'Extend network identity alongside both tickers',
        slotId,
        whenSlotId: 'fx',
        sharedOffsets: [
          namedOffset('Network plate', 'y', -fxReservation),
          namedOffset('Network plate', 'height', fxReservation),
          namedOffset('AXIS wordmark', 'y', -fxReservation / 2),
          namedOffset('Network', 'y', -fxReservation / 2),
        ],
      });
    } else if (id === 'board') {
      for (const [whenSlotId, amount] of [
        ['fx', fxReservation],
        ['strip', watchReservation],
      ])
        graph.layoutRules.push({
          id: `board-above-${whenSlotId}`,
          name: `Resize market pulse above ${whenSlotId}`,
          slotId,
          whenSlotId,
          sharedOffsets: [
            namedOffset('Board glass', 'height', -amount),
            namedOffset('Board source', 'y', -amount),
            namedOffset('Board time', 'y', -amount),
          ],
        });
    } else {
      graph.layoutRules.push({
        id: `${id}-above-fx`,
        name: `Lift ${id} above FX`,
        slotId,
        whenSlotId: 'fx',
        sharedOffsets: offsets(-fxReservation),
      });
    }
    if (slotId === 'headline')
      graph.layoutRules.push({
        id: `${id}-above-watch`,
        name: `Lift ${id} above market watch`,
        slotId,
        whenSlotId: 'strip',
        sharedOffsets: offsets(-watchReservation),
      });
  }
  graph.states.push(item);
}
for (const slotId of ['fx', 'strip'])
  graph.routes.push(
    {
      id: `${slotId}-enter`,
      slotId,
      from: null,
      to: '*',
      transitionId: 'reserve-in',
      priority: 10,
    },
    {
      id: `${slotId}-leave`,
      slotId,
      from: '*',
      to: null,
      transitionId: 'reserve-out',
      priority: 20,
    },
  );
const set = await call('ograf_get_template_set');
const result = await call('ograf_update_template_set', {
  expectedRevision: set.revision,
  operation: { type: 'set_transition_logic', definition: graph },
});
state.setId = result.templateSet?.id ?? set.templateSet?.id;
state.graph = graph;
await writeFile(path, JSON.stringify(state, null, 2));
console.log(
  JSON.stringify({
    setId: state.setId,
    slots: slots.length,
    states: graph.states.length,
    layoutRules: graph.layoutRules.length,
    revision: result.revision,
  }),
);
