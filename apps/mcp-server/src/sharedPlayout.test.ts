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

async function publish(editor: string) {
  const response = await post(editor + 'api/shared-playout/publish', pkg);
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
  it('waits at a boot-scoped viewer link and opens the latest published viewer session', async () => {
    const { editor, lan, host } = await setup();
    const entry = host.viewerEntryUrl();
    expect(entry.origin).toBe(new URL(lan).origin);
    expect(entry.pathname).toMatch(/^\/v\/[A-Za-z0-9_-]{22}$/);
    expect((await fetch(lan + 'v/unknown')).status).toBe(404);
    const waiting = await fetch(entry);
    expect(waiting.status).toBe(200);
    expect(waiting.headers.get('cache-control')).toContain('no-store');
    expect(await waiting.text()).toContain('<meta http-equiv="refresh" content="2">');

    const first = await publish(editor);
    const firstRedirect = await fetch(entry, { redirect: 'manual' });
    expect(firstRedirect.status).toBe(307);
    expect(firstRedirect.headers.get('location')).toBe(new URL(first.viewerUrl).pathname);

    const second = await publish(editor);
    const latest = await fetch(entry);
    expect(latest.url).toBe(second.viewerUrl);
    expect(await (await fetch(latest.url + 'state')).json()).toMatchObject({
      publicationId: second.publicationId,
      canControl: false,
    });
    expect((await post(latest.url + 'command', { command: { kind: 'play' } })).status).toBe(403);
    expect(await (await fetch(first.viewerUrl + 'state')).json()).toMatchObject({
      publicationId: first.publicationId,
      canControl: false,
    });
    expect((await fetch(lan + 'v/unknown')).status).toBe(404);
  });

  it('serves exactly the published files and keeps authoring behind a separate listener', async () => {
    const { editor, lan } = await setup();
    const disabled = await listen(createOGrafAuthoringHost().httpServer);
    expect(await (await fetch(disabled + 'api/shared-playout/status')).json()).toEqual({
      enabled: false,
    });
    expect(await (await fetch(editor + 'api/shared-playout/status')).json()).toEqual({
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
    const state = await (await fetch(viewerUrl + 'state')).json();
    expect(state).toMatchObject({ publicationId, canControl: false, revision: 0, commands: [] });
    expect(await (await fetch(state.manifestUrl)).text()).toBe(
      JSON.stringify(pkg.manifest, null, 2),
    );
    expect(await (await fetch(viewerUrl + 'package/main.js')).text()).toBe(pkg.mainJs);
    const binary = await fetch(viewerUrl + 'package/assets/fixture.bin');
    expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([0, 1, 255]);
    expect((await fetch(viewerUrl + 'package/%2E%2E%2Fmain.js')).status).toBe(404);
    expect((await fetch(lan + 's/unknown/state')).status).toBe(404);
    expect((await fetch(lan + 'api/shared-playout/status')).status).toBe(404);
    expect((await fetch(lan + 'mcp')).status).toBe(404);
    expect((await post(viewerUrl + 'command', { command: { kind: 'play' } })).status).toBe(403);
  });

  it('fans out one ordered journal and makes stale or duplicated commands safe', async () => {
    const { editor } = await setup();
    const { viewerUrl, operatorUrl } = await publish(editor);
    const streams = await Promise.all([
      openEvents(viewerUrl + 'events'),
      openEvents(operatorUrl + 'events'),
    ]);
    try {
      const [view, control] = await Promise.all(streams.map((stream) => stream.next()));
      expect(view).toMatchObject({ type: 'snapshot', data: { canControl: false, revision: 0 } });
      expect(control).toMatchObject({ type: 'snapshot', data: { canControl: true, revision: 0 } });
      const commands = [
        { kind: 'play', delta: 1 },
        { kind: 'update', data: { headline: 'ON AIR' } },
        { kind: 'action', actionId: 'pulse' },
        { kind: 'stop' },
      ];
      for (const [revision, command] of commands.entries()) {
        const payload = { requestId: `request-${revision}`, expectedRevision: revision, command };
        expect(await (await post(operatorUrl + 'command', payload)).json()).toEqual({
          revision: revision + 1,
        });
        for (const stream of streams)
          expect(await stream.next()).toEqual({
            type: 'command',
            data: { revision: revision + 1, command },
          });
      }
      const duplicate = { requestId: 'request-0', expectedRevision: 0, command: commands[0] };
      expect(await (await post(operatorUrl + 'command', duplicate)).json()).toEqual({
        revision: 1,
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
          revision: 4,
          commands: commands.map((command, index) => ({ revision: index + 1, command })),
        });
        expect(await late.next()).toEqual({ type: 'snapshot', data: state });
      } finally {
        await late.close();
      }
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
    }
  });

  it('rejects invalid publications and commands without replacing a full journal', async () => {
    const { editor } = await setup({ maxCommands: 1, maxPublications: 1 });
    const url = editor + 'api/shared-playout/publish';
    for (const path of ['../main.js', 'main.js', 'assets/%2e%2e/other']) {
      expect(
        (await post(url, { ...pkg, resources: [{ path, data: '', base64: false }] })).status,
      ).toBe(400);
    }
    const { operatorUrl, viewerUrl } = await publish(editor);
    expect((await post(url, pkg)).status).toBe(409);
    const route = operatorUrl + 'command';
    const payload = { requestId: 'take-1', expectedRevision: 0, command: { kind: 'play' } };
    expect((await post(route, payload, 'http://other.invalid')).status).toBe(403);
    expect(
      (await post(route, { ...payload, command: { kind: 'action', actionId: 'hidden' } })).status,
    ).toBe(400);
    expect(
      (await post(route, { ...payload, command: { kind: 'update', data: { hidden: 'bad' } } }))
        .status,
    ).toBe(400);
    expect(await (await post(route, payload)).json()).toEqual({ revision: 1 });
    const overflow = await post(route, { ...payload, expectedRevision: 1, requestId: 'take-2' });
    expect(overflow.status).toBe(409);
    expect(await (await post(route, payload)).json()).toEqual({ revision: 1 });
    expect(await (await fetch(viewerUrl + 'state')).json()).toMatchObject({ revision: 1 });
  });
});
