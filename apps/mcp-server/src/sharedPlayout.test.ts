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
    schema: { type: 'object', properties: { headline: { type: 'string' } } },
    customActions: [{ id: 'pulse', name: 'Pulse' }],
  },
  mainJs: 'export default class extends HTMLElement {};',
  resources: [{ path: 'assets/fixture.bin', data: 'AAH/', base64: true }],
};
const secondPkg = { ...pkg, mainJs: `${pkg.mainJs}\n// Second publication.` };
const autoplay = { revision: 1, command: { kind: 'play', delta: 1 } };

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

async function publish(editor: string, body = pkg) {
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
          revision: 0,
          commands: [],
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
      const idle = { publicationId: null, manifestUrl: null, revision: 0, commands: [] };
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
