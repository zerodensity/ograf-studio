import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createOGrafAuthoringHost } from './index';
import { createSharedPlayoutHost, SHARED_PLAYOUT_ASSET_FILES } from './sharedPlayout';

const pkg = {
  manifestFileName: 'test-graphic.ograf.json',
  manifest: {
    $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
    id: 'test-graphic',
    name: 'Shared preview fixture',
    main: 'main.js',
    supportsRealTime: true,
    supportsNonRealTime: false,
    schema: {
      type: 'object',
      properties: { headline: { type: 'string' }, subtitle: { type: 'string' } },
    },
    customActions: [{ id: 'pulse', name: 'Pulse' }],
  },
  mainJs: 'export default class extends HTMLElement {};',
  resources: [{ path: 'assets/fixture.bin', data: 'AAH/', base64: true }],
};
const secondPkg = { ...pkg, mainJs: `${pkg.mainJs}\n// Second publication.` };
const autoplay = { revision: 1, command: { kind: 'play', delta: 1 } };
const lane = {
  type: 'object',
  properties: { stateId: { type: 'string', enum: ['', 'main', 'other'] } },
};
const coordinatedPkg = {
  ...pkg,
  manifest: {
    ...pkg.manifest,
    schema: {
      type: 'object',
      properties: {
        slots: { type: 'object', properties: { left: lane, right: lane } },
      },
    },
    customActions: ['patch', 'take', 'out', 'clear'].map((name) => ({
      id: `transition.${name}`,
      name,
    })),
  },
};

const servers: Server[] = [];
const hosts: ReturnType<typeof createSharedPlayoutHost>[] = [];

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

afterEach(async () => {
  for (const host of hosts.splice(0)) host.disconnectClients();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function setup(limits?: Parameters<typeof createSharedPlayoutHost>[2]) {
  const assets = new Map(SHARED_PLAYOUT_ASSET_FILES.map((name) => [name, Buffer.from(name)]));
  const host = createSharedPlayoutHost('127.0.0.1', assets, limits);
  hosts.push(host);
  const lan = await listen(host.httpServer);
  const editor = await listen(createOGrafAuthoringHost({ sharedPlayout: host }).httpServer);
  return { editor, lan, host };
}

function post(url: string, body: unknown, origin?: string) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
}

async function publish(editor: string, body: unknown = pkg) {
  const response = await post(editor + 'api/shared-playout/publish', body);
  expect(response.status).toBe(201);
  return (await response.json()) as {
    publicationId: string;
    viewerUrl: string;
    operatorUrl: string;
  };
}

async function openEvents(url: string) {
  const response = await fetch(url);
  expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  return {
    async next() {
      while (!pending.includes('\n\n')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('The event stream closed.');
        pending += decoder.decode(chunk.value, { stream: true });
      }
      const end = pending.indexOf('\n\n');
      const [type, data] = pending.slice(0, end).split('\n');
      pending = pending.slice(end + 2);
      return {
        type: type!.slice('event: '.length),
        data: JSON.parse(data!.slice('data: '.length)),
      };
    },
    close: () => reader.cancel(),
  };
}

describe('shared playout host', () => {
  it('shares the same journal between native Studio and LAN with same-origin Studio assets', async () => {
    const { editor, lan } = await setup();
    const api = editor + 'api/shared-playout/';
    const studio = await openEvents(api + 'events');
    const viewer = await openEvents(lan + 'preview/events');
    try {
      expect(await studio.next()).toEqual({
        type: 'snapshot',
        data: {
          publicationId: null,
          manifestUrl: null,
          canControl: true,
          syncViewers: true,
          syncVersion: 0,
          revision: 0,
          commands: [],
          feeds: [],
        },
      });
      await viewer.next();
      const { publicationId, operatorUrl } = await publish(editor);
      const studioState = await studio.next();
      const viewerState = await viewer.next();
      expect(studioState).toMatchObject({
        type: 'snapshot',
        data: { publicationId, canControl: true, revision: 1, commands: [autoplay] },
      });
      expect(studioState.data.manifestUrl).toMatch(
        /^\/api\/shared-playout\/packages\/[A-Za-z0-9_-]{32}\//,
      );
      expect(viewerState).toMatchObject({
        type: 'snapshot',
        data: { publicationId, canControl: false, revision: 1 },
      });
      expect(viewerState.data.manifestUrl.startsWith(lan)).toBe(true);
      expect(await (await fetch(api + 'state')).json()).toEqual(studioState.data);
      const manifest = new URL(studioState.data.manifestUrl, editor);
      const file = await fetch(manifest);
      expect(file.headers.get('access-control-allow-origin')).toBeNull();
      expect(await file.text()).toBe(JSON.stringify(pkg.manifest, null, 2));
      expect(await (await fetch(new URL('main.js', manifest))).text()).toBe(pkg.mainJs);
      expect((await fetch(new URL('%2E%2E%2Fmain.js', manifest))).status).toBe(404);
      expect((await fetch(lan + 'api/shared-playout/state')).status).toBe(404);

      const origin = new URL(editor).origin;
      const command = { kind: 'play', goto: 0 };
      const request = { publicationId, expectedRevision: 1, requestId: 'studio-goto', command };
      expect((await post(api + 'command', request, 'http://other.invalid')).status).toBe(403);
      expect(
        (await post(api + 'command', { ...request, command: { ...command, delta: 1 } }, origin))
          .status,
      ).toBe(400);
      expect(await (await post(api + 'command', request, origin)).json()).toEqual({ revision: 2 });
      const goto = { type: 'command', data: { publicationId, revision: 2, command } };
      expect(await studio.next()).toEqual(goto);
      expect(await viewer.next()).toEqual(goto);

      const stop = { kind: 'stop' };
      expect(
        await (
          await post(operatorUrl + 'command', {
            publicationId,
            expectedRevision: 2,
            requestId: 'operator-stop',
            command: stop,
          })
        ).json(),
      ).toEqual({ revision: 3 });
      const stopped = { type: 'command', data: { publicationId, revision: 3, command: stop } };
      expect(await studio.next()).toEqual(stopped);
      expect(await viewer.next()).toEqual(stopped);
    } finally {
      await Promise.all([studio.close(), viewer.close()]);
    }
  });

  it('switches connected viewers to each new publication at stable preview and control links', async () => {
    const { editor, lan, host } = await setup();
    const viewerUrl = host.viewerEntryUrl().href;
    const operatorUrl = host.operatorEntryUrl().href;
    expect(viewerUrl).toBe(lan + 'preview/');
    expect(host.operatorEntryUrl().pathname).toMatch(/^\/control\/[A-Za-z0-9_-]{32}\/$/);
    expect(await (await fetch(editor + 'api/shared-playout/status')).json()).toEqual({
      enabled: true,
      viewerUrl,
      operatorUrl,
    });
    const waiting = await fetch(viewerUrl);
    expect(waiting.headers.get('cache-control')).toContain('no-store');
    expect(await waiting.text()).toBe('shared-playout.html');

    const viewers = await Promise.all([
      openEvents(viewerUrl + 'events'),
      openEvents(operatorUrl + 'events'),
    ]);
    try {
      const idle = {
        publicationId: null,
        manifestUrl: null,
        syncViewers: true,
        syncVersion: 0,
        revision: 0,
        commands: [],
        feeds: [],
      };
      expect(await viewers[0]!.next()).toEqual({
        type: 'snapshot',
        data: { ...idle, canControl: false },
      });
      expect(await viewers[1]!.next()).toEqual({
        type: 'snapshot',
        data: { ...idle, canControl: true },
      });

      const first = await publish(editor);
      const previous = await viewers[0]!.next();
      expect(previous).toMatchObject({
        type: 'snapshot',
        data: {
          publicationId: first.publicationId,
          canControl: false,
          revision: 1,
          commands: [autoplay],
        },
      });
      expect(await viewers[1]!.next()).toEqual({
        type: 'snapshot',
        data: { ...previous.data, canControl: true },
      });

      const second = await publish(editor, secondPkg);
      expect(first).toMatchObject({ viewerUrl, operatorUrl });
      expect(second).toMatchObject({ viewerUrl, operatorUrl });
      expect(second.publicationId).not.toBe(first.publicationId);
      const latest = await viewers[0]!.next();
      expect(latest).toMatchObject({
        type: 'snapshot',
        data: {
          publicationId: second.publicationId,
          canControl: false,
          revision: 1,
          commands: [autoplay],
        },
      });
      expect(await viewers[1]!.next()).toEqual({
        type: 'snapshot',
        data: { ...latest.data, canControl: true },
      });
      expect(await (await fetch(viewerUrl + 'state')).json()).toEqual(latest.data);
      expect(await (await fetch(new URL('main.js', previous.data.manifestUrl))).text()).toBe(
        pkg.mainJs,
      );
      expect(await (await fetch(new URL('main.js', latest.data.manifestUrl))).text()).toBe(
        secondPkg.mainJs,
      );

      const stale = await post(operatorUrl + 'command', {
        publicationId: first.publicationId,
        requestId: 'before-replacement',
        expectedRevision: 1,
        command: { kind: 'stop' },
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        publicationId: second.publicationId,
        revision: 1,
      });
      expect((await fetch(lan + 'control/unknown/state')).status).toBe(404);
    } finally {
      await Promise.all(viewers.map((viewer) => viewer.close()));
    }
  });

  it('shares viewer sync mode across Studio and LAN without advancing the command journal', async () => {
    const { editor, lan } = await setup();
    const api = editor + 'api/shared-playout/';
    const { publicationId, viewerUrl, operatorUrl } = await publish(editor);
    const links = [api, viewerUrl, operatorUrl];
    const streams = await Promise.all(links.map((url) => openEvents(url + 'events')));
    const initial = { publicationId, revision: 1, commands: [autoplay] };
    const enabled = { syncViewers: true, syncVersion: 0 };
    const paused = { syncViewers: false, syncVersion: 1 };
    const resumed = { syncViewers: true, syncVersion: 2 };
    try {
      for (const stream of streams)
        expect(await stream.next()).toMatchObject({
          type: 'snapshot',
          data: { ...initial, ...enabled },
        });

      expect((await post(viewerUrl + 'mode', { syncViewers: false })).status).toBe(403);
      expect((await post(lan + 'control/unknown/mode', { syncViewers: false })).status).toBe(404);
      for (const route of [api, operatorUrl]) {
        expect((await post(route + 'mode', { syncViewers: 'false' })).status).toBe(400);
        expect((await post(route + 'mode', { syncViewers: false, revision: 1 })).status).toBe(400);
        expect(
          (await post(route + 'mode', { syncViewers: false }, 'http://other.invalid')).status,
        ).toBe(403);
      }

      expect(
        await (await post(api + 'mode', { syncViewers: false }, new URL(editor).origin)).json(),
      ).toEqual(paused);
      for (const [index, stream] of streams.entries()) {
        const state = await (await fetch(links[index]! + 'state')).json();
        expect(state).toMatchObject({ ...initial, ...paused, canControl: index !== 1 });
        expect(await stream.next()).toEqual({ type: 'snapshot', data: state });
      }

      const operatorMode = operatorUrl + 'mode';
      expect(await (await post(operatorMode, { syncViewers: false })).json()).toEqual(paused);
      expect(
        await (await post(operatorMode, { syncViewers: true }, new URL(lan).origin)).json(),
      ).toEqual(resumed);
      for (const stream of streams)
        expect(await stream.next()).toMatchObject({
          type: 'snapshot',
          data: { ...initial, ...resumed },
        });

      const replacement = await publish(editor, secondPkg);
      for (const stream of streams)
        expect(await stream.next()).toMatchObject({
          type: 'snapshot',
          data: { ...initial, publicationId: replacement.publicationId, ...resumed },
        });
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
    }
  });

  it('serves exactly the published files and keeps authoring behind a separate listener', async () => {
    const { editor, lan } = await setup();
    const disabled = await listen(createOGrafAuthoringHost().httpServer);
    expect(await (await fetch(disabled + 'api/shared-playout/status')).json()).toEqual({
      enabled: false,
    });
    expect(await (await fetch(editor + 'api/shared-playout/status')).json()).toMatchObject({
      enabled: true,
    });
    expect(
      (await post(editor + 'api/shared-playout/publish', pkg, 'http://other.invalid')).status,
    ).toBe(403);
    const { publicationId, viewerUrl, operatorUrl } = await publish(editor);
    expect(viewerUrl.startsWith(lan)).toBe(true);
    expect(operatorUrl).not.toBe(viewerUrl);
    const page = await fetch(viewerUrl);
    expect(await page.text()).toBe('shared-playout.html');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await (await fetch(viewerUrl + 'ograf-player.js')).text()).toBe('ograf-player.js');
    for (const url of [viewerUrl, operatorUrl]) {
      const style = await fetch(url + 'preview-controls.css');
      expect(style.headers.get('content-type')).toMatch(/text\/css/);
      expect(await style.text()).toBe('preview-controls.css');
    }
    expect((await fetch(lan + 'control/unknown/preview-controls.css')).status).toBe(404);
    const state = await (await fetch(viewerUrl + 'state')).json();
    expect(state).toMatchObject({
      publicationId,
      canControl: false,
      revision: 1,
      commands: [autoplay],
    });
    expect(await (await fetch(state.manifestUrl)).text()).toBe(
      JSON.stringify(pkg.manifest, null, 2),
    );
    expect(await (await fetch(new URL('main.js', state.manifestUrl))).text()).toBe(pkg.mainJs);
    const binary = await fetch(new URL('assets/fixture.bin', state.manifestUrl));
    expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([0, 1, 255]);
    expect((await fetch(new URL('%2E%2E%2Fmain.js', state.manifestUrl))).status).toBe(404);
    expect((await fetch(lan + 's/unknown/package/main.js')).status).toBe(404);
    expect((await fetch(lan + 'api/shared-playout/status')).status).toBe(404);
    expect((await fetch(lan + 'mcp')).status).toBe(404);
    expect((await post(viewerUrl + 'command', { command: { kind: 'play' } })).status).toBe(403);
  });

  it('streams live patches and retains only their latest fields outside the command journal', async () => {
    const { editor, lan } = await setup({ maxCommands: 2, maxFeedBytes: 300 });
    const api = editor + 'api/shared-playout/';
    const { publicationId, viewerUrl, operatorUrl } = await publish(editor);
    const streams = await Promise.all(
      [api, viewerUrl, operatorUrl].map((url) => openEvents(url + 'events')),
    );
    const target = { kind: 'graphic' };
    const feed = (data: object) => ({ publicationId, target, data });
    const state = async () => (await fetch(viewerUrl + 'state')).json();
    try {
      for (const stream of streams) await stream.next();
      const first = feed({ headline: 'First', subtitle: 'Keep' });
      expect((await post(lan + 'preview/feed', first)).status).toBe(404);
      expect((await post(operatorUrl + 'feed', first)).status).toBe(404);
      expect((await post(api + 'feed', first, 'http://other.invalid')).status).toBe(403);
      expect((await post(api + 'feed', { ...first, publicationId: 'stale' })).status).toBe(409);
      expect((await post(api + 'feed', feed({ hidden: 'no' }))).status).toBe(400);
      expect((await post(api + 'feed', feed({ headline: 'X'.repeat(300) }))).status).toBe(413);

      const patches = [first, feed({ headline: 'Second' }), feed({ headline: 'Latest' })];
      for (const [index, patch] of patches.entries()) {
        const sequence = index + 1;
        expect(await (await post(api + 'feed', patch)).json()).toEqual({ sequence });
        for (const stream of streams)
          expect(await stream.next()).toEqual({ type: 'feed', data: { ...patch, sequence } });
      }
      expect(await state()).toMatchObject({
        revision: 1,
        commands: [autoplay],
        feeds: [{ ...feed({ headline: 'Latest', subtitle: 'Keep' }), sequence: 3 }],
      });

      for (const syncViewers of [false, true]) {
        await post(api + 'mode', { syncViewers });
        for (const stream of streams)
          expect(await stream.next()).toMatchObject({
            type: 'snapshot',
            data: { syncViewers, revision: 1, feeds: [{ sequence: 3 }] },
          });
      }

      const command = { kind: 'update', data: { headline: 'Manual' } };
      expect(
        await (
          await post(operatorUrl + 'command', {
            publicationId,
            requestId: 'manual',
            expectedRevision: 1,
            command,
          })
        ).json(),
      ).toEqual({ revision: 2 });
      expect(await state()).toMatchObject({
        revision: 2,
        feeds: [{ ...feed({ subtitle: 'Keep' }), sequence: 3 }],
      });
      const late = await openEvents(viewerUrl + 'events');
      try {
        expect(await late.next()).toEqual({ type: 'snapshot', data: await state() });
      } finally {
        await late.close();
      }
      const replacement = await publish(editor, secondPkg);
      expect(await state()).toMatchObject({
        publicationId: replacement.publicationId,
        revision: 1,
        feeds: [],
      });
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
    }
  });

  it('invalidates scoped feed values on manual lane updates and lifecycle commands', async () => {
    const { editor } = await setup();
    const { publicationId, viewerUrl, operatorUrl } = await publish(editor, coordinatedPkg);
    const feedUrl = editor + 'api/shared-playout/feed';
    const left = { kind: 'slot', slotId: 'left', stateId: 'main' };
    const right = { ...left, slotId: 'right' };
    const writeFeed = (target: object, data = { title: 'Live', body: 'Live body' }) =>
      post(feedUrl, { publicationId, target, data });
    const state = async () => (await fetch(viewerUrl + 'state')).json();
    let revision = 1;
    async function send(command: object) {
      const result = await post(operatorUrl + 'command', {
        publicationId,
        requestId: `revision-${revision}`,
        expectedRevision: revision,
        command,
      });
      expect(await result.json()).toEqual({ revision: ++revision });
    }
    const action = (id: string, payload?: object) =>
      send({ kind: 'action', actionId: `transition.${id}`, payload });

    expect((await writeFeed({ ...left, stateId: 'missing' })).status).toBe(400);
    expect((await writeFeed({ ...left, slotId: 'missing' })).status).toBe(400);
    expect(await (await writeFeed(left)).json()).toEqual({ sequence: 1 });
    expect(await (await writeFeed(right)).json()).toEqual({ sequence: 2 });
    await action('patch', { slotId: 'left', stateId: 'main', data: { title: 'Manual' } });
    expect((await state()).feeds).toMatchObject([
      { target: left, data: { body: 'Live body' } },
      { target: right, data: { title: 'Live', body: 'Live body' } },
    ]);
    expect(Object.keys((await state()).feeds[0].data)).toEqual(['body']);
    await send({ kind: 'update', data: { slots: { right: { data: { body: 'Manual body' } } } } });
    expect((await state()).feeds[1].data).toEqual({ title: 'Live' });
    await send({ kind: 'update', data: { slots: { right: { stateId: 'other' } } } });
    expect((await state()).feeds).toMatchObject([{ target: left }]);

    await action('take', { slotId: 'left', stateId: 'main' });
    expect((await state()).feeds).toEqual([]);
    for (const id of ['out', 'clear']) {
      expect((await writeFeed(left)).status).toBe(200);
      expect((await writeFeed(right)).status).toBe(200);
      await action(id, { slotId: 'left' });
      expect((await state()).feeds).toMatchObject([{ target: right }]);
      await action('clear');
      expect((await state()).feeds).toEqual([]);
    }
    expect((await writeFeed(left)).status).toBe(200);
    await send({ kind: 'stop' });
    expect((await state()).feeds).toEqual([]);
  });

  it('fans out one ordered journal and makes stale or duplicated commands safe', async () => {
    const { editor } = await setup();
    const { publicationId, viewerUrl, operatorUrl } = await publish(editor);
    const streams = await Promise.all([
      openEvents(viewerUrl + 'events'),
      openEvents(operatorUrl + 'events'),
    ]);
    try {
      const [view, control] = await Promise.all(streams.map((stream) => stream.next()));
      expect(view).toMatchObject({ type: 'snapshot', data: { canControl: false, revision: 1 } });
      expect(control).toMatchObject({ type: 'snapshot', data: { canControl: true, revision: 1 } });
      const commands = [
        { kind: 'play', delta: 1 },
        { kind: 'update', data: { headline: 'ON AIR' } },
        { kind: 'action', actionId: 'pulse' },
        { kind: 'stop' },
      ];
      for (const [index, command] of commands.entries()) {
        const revision = index + 1;
        const payload = {
          publicationId,
          requestId: `request-${index}`,
          expectedRevision: revision,
          command,
        };
        expect(await (await post(operatorUrl + 'command', payload)).json()).toEqual({
          revision: revision + 1,
        });
        for (const stream of streams)
          expect(await stream.next()).toEqual({
            type: 'command',
            data: { publicationId, revision: revision + 1, command },
          });
      }
      const duplicate = {
        publicationId,
        requestId: 'request-0',
        expectedRevision: 1,
        command: commands[0],
      };
      expect(await (await post(operatorUrl + 'command', duplicate)).json()).toEqual({
        revision: 2,
      });
      expect(
        (await post(operatorUrl + 'command', { ...duplicate, command: commands[1] })).status,
      ).toBe(409);
      expect(
        (await post(operatorUrl + 'command', { ...duplicate, requestId: 'stale' })).status,
      ).toBe(409);
      const late = await openEvents(viewerUrl + 'events');
      try {
        const state = await (await fetch(viewerUrl + 'state')).json();
        expect(state).toMatchObject({
          revision: 5,
          commands: [
            autoplay,
            ...commands.map((command, index) => ({ revision: index + 2, command })),
          ],
        });
        expect(await late.next()).toEqual({ type: 'snapshot', data: state });
      } finally {
        await late.close();
      }
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
    }
  });

  it('rejects invalid inputs, retains an identical publication and evicts old packages on replacement', async () => {
    const { editor } = await setup({ maxCommands: 2, maxPublications: 1 });
    const url = editor + 'api/shared-playout/publish';
    for (const path of ['../main.js', 'main.js', 'assets/%2e%2e/other']) {
      expect(
        (await post(url, { ...pkg, resources: [{ path, data: '', base64: false }] })).status,
      ).toBe(400);
    }
    const first = await publish(editor);
    const { publicationId, operatorUrl, viewerUrl } = first;
    const firstState = await (await fetch(viewerUrl + 'state')).json();
    const route = operatorUrl + 'command';
    const payload = {
      publicationId,
      requestId: 'take-1',
      expectedRevision: 1,
      command: { kind: 'stop' },
    };
    expect((await post(route, payload, 'http://other.invalid')).status).toBe(403);
    expect(
      (await post(route, { ...payload, command: { kind: 'action', actionId: 'hidden' } })).status,
    ).toBe(400);
    expect(
      (await post(route, { ...payload, command: { kind: 'update', data: { hidden: 'bad' } } }))
        .status,
    ).toBe(400);
    expect(await (await post(route, payload)).json()).toEqual({ revision: 2 });
    const overflow = await post(route, { ...payload, expectedRevision: 2, requestId: 'take-2' });
    expect(overflow.status).toBe(409);
    expect(await (await post(route, payload)).json()).toEqual({ revision: 2 });
    expect(await publish(editor)).toEqual(first);
    expect(await (await fetch(viewerUrl + 'state')).json()).toMatchObject({ revision: 2 });

    const replacement = await publish(editor, secondPkg);
    expect(replacement.publicationId).not.toBe(publicationId);
    expect(replacement).toMatchObject({ operatorUrl, viewerUrl });
    expect((await fetch(firstState.manifestUrl)).status).toBe(404);
    expect(await (await fetch(viewerUrl + 'state')).json()).toMatchObject({
      publicationId: replacement.publicationId,
      revision: 1,
      commands: [autoplay],
    });
  });
});
