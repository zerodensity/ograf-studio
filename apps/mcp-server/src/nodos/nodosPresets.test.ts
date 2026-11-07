import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { TypeSchema } from '@nodos/editor-sdk';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { nodosPresetObject, type NodosPresetDefinition, type NodosResult } from './nodosConnection';
import {
  NodosPresetHost,
  type NodosSendMessage,
  type NodosPresetHostOptions,
} from './nodosPresets';

const preset: NodosPresetDefinition = {
  name: 'ograf.Lower_Third',
  menu_info: { display_name: 'Lower Third', category: 'OGraf' },
  node: {
    class_name: 'nos.app.electronode.ElectroNode',
    display_name: 'Lower Third',
    pins: [
      { name: 'URL', type_name: 'string', data: 'nodos.html' },
      { name: 'Width', type_name: 'uint', data: 1920 },
      {
        name: 'headline',
        type_name: 'string',
        display_name: 'Headline',
        show_as: 'PROPERTY',
        can_show_as: 'INPUT_PIN_OR_PROPERTY',
        data: 'Breaking',
      },
    ],
  },
};

const base64 = (text: string) => Buffer.from(text).toString('base64');

function sendMessage(overrides: Partial<NodosSendMessage> = {}): NodosSendMessage {
  return {
    type: 'nodos.send',
    requestId: 'request-1',
    address: 'localhost:50052',
    preset,
    files: [
      { path: 'nodos.html', base64: base64('<!doctype html><title>Lower Third</title>') },
      { path: 'assets/logo.svg', base64: base64('<svg/>') },
    ],
    ...overrides,
  };
}

async function startHost(
  behavior?: (presets: NodosPresetDefinition[], count: number) => Promise<NodosResult>,
  options: NodosPresetHostOptions = {},
) {
  const sent: Array<{ address: string; presets: NodosPresetDefinition[] }> = [];
  const connection = {
    setPresets: async (address: string, presets: NodosPresetDefinition[]): Promise<NodosResult> => {
      sent.push({ address, presets });
      return behavior
        ? behavior(presets, sent.length)
        : { ok: true, message: 'Set 1 node presets.' };
    },
    types: async () => ({ ok: true as const, objects: [], enums: [] }),
    onTypes: null,
    close: () => undefined,
  };
  const app = express();
  const httpServer = createServer(app);
  const host = new NodosPresetHost(httpServer, connection, options);
  host.install(app);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const stop = () => {
    host.close();
    return new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  };
  return { host, sent, port, stop };
}

describe('Nodos presets', () => {
  it('points the preset at the files this server serves and sends it', async () => {
    const { host, sent, port, stop } = await startHost();
    try {
      expect(await host.send(sendMessage())).toEqual({ ok: true, message: 'Set 1 node presets.' });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.address).toBe('localhost:50052');
      const url = sent[0]!.presets[0]!.node.pins[0]!.data;
      expect(url).toMatch(
        new RegExp(
          `^http://127.0.0.1:${port}/nodos/ograf\\.Lower_Third/_versions/[a-f0-9-]+/nodos\\.html$`,
        ),
      );
      expect(preset.node.pins[0]!.data).toBe('nodos.html');

      const page = await fetch(String(url));
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(await page.text()).toContain('Lower Third');
      const asset = await fetch(new URL('assets/logo.svg', String(url)));
      expect(asset.headers.get('content-type')).toContain('image/svg+xml');
      expect((await fetch(`http://127.0.0.1:${port}/nodos/ograf.Other/nodos.html`)).status).toBe(
        404,
      );
    } finally {
      await stop();
    }
  });

  it('replaces the files of a template sent again', async () => {
    const { host, sent, port, stop } = await startHost();
    try {
      await host.send(sendMessage());
      await host.send(
        sendMessage({
          files: [{ path: 'nodos.html', base64: base64('<title>Version 2</title>') }],
        }),
      );
      const page = await fetch(`http://127.0.0.1:${port}/nodos/ograf.Lower_Third/nodos.html`);
      expect(await page.text()).toContain('Version 2');
      const asset = await fetch(`http://127.0.0.1:${port}/nodos/ograf.Lower_Third/assets/logo.svg`);
      expect(asset.status).toBe(404);
      const previousUrl = String(sent[0]!.presets[0]!.node.pins[0]!.data);
      expect(await (await fetch(previousUrl)).text()).toContain('Lower Third');
      expect((await fetch(new URL('assets/logo.svg', previousUrl))).status).toBe(200);
    } finally {
      await stop();
    }
  });

  it('refuses a preset whose page is not among its files', async () => {
    const { host, sent, stop } = await startHost();
    try {
      const result = await host.send(sendMessage({ files: [] }));
      expect(result.ok).toBe(false);
      expect(result.message).toContain('nodos.html');
      expect(sent).toHaveLength(0);
    } finally {
      await stop();
    }
  });

  it('serves a staged version during registration but preserves accepted files after explicit rejection', async () => {
    const proposed: string[] = [];
    const { host, port, stop } = await startHost(async (presets, count) => {
      const url = String(presets[0]!.node.pins[0]!.data);
      proposed.push(url);
      expect(await (await fetch(url)).text()).toContain(count === 1 ? 'Lower Third' : 'rejected');
      return count === 1
        ? { ok: true, message: 'accepted' }
        : { ok: false, message: 'bad schema', outcome: 'rejected' };
    });
    try {
      await host.send(sendMessage());
      const result = await host.send(
        sendMessage({ files: [{ path: 'nodos.html', base64: base64('rejected') }] }),
      );
      expect(result.ok).toBe(false);
      expect(await (await fetch(proposed[0]!)).text()).toContain('Lower Third');
      expect((await fetch(proposed[1]!)).status).toBe(404);
      expect(
        await (await fetch(`http://127.0.0.1:${port}/nodos/ograf.Lower_Third/nodos.html`)).text(),
      ).toContain('Lower Third');
    } finally {
      await stop();
    }
  });

  it('serializes concurrent registrations of one preset without replacing any staged bytes', async () => {
    let release!: (result: NodosResult) => void;
    const { host, sent, stop } = await startHost(async (_presets, count) =>
      count === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : { ok: true, message: 'second accepted' },
    );
    try {
      const first = host.send(sendMessage());
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const firstUrl = String(sent[0]!.presets[0]!.node.pins[0]!.data);
      const second = host.send(
        sendMessage({ files: [{ path: 'nodos.html', base64: base64('second') }] }),
      );
      await Promise.resolve();
      expect(sent).toHaveLength(1);
      expect(await (await fetch(firstUrl)).text()).toContain('Lower Third');
      release({ ok: true, message: 'first accepted' });
      expect((await first).ok).toBe(true);
      expect((await second).ok).toBe(true);
      const secondUrl = String(sent[1]!.presets[0]!.node.pins[0]!.data);
      expect(secondUrl).not.toBe(firstUrl);
      expect(await (await fetch(firstUrl)).text()).toContain('Lower Third');
      expect(await (await fetch(secondUrl)).text()).toBe('second');
    } finally {
      await stop();
    }
  });

  it('keeps uncertain registrations fetchable for a bounded grace period', async () => {
    let now = 0;
    const { host, sent, stop } = await startHost(
      async (_presets, count) =>
        count === 1
          ? { ok: true, message: 'accepted' }
          : { ok: false, message: 'timed out', outcome: 'unknown' },
      { now: () => now, retentionMs: 1000 },
    );
    try {
      await host.send(sendMessage());
      await host.send(
        sendMessage({ files: [{ path: 'nodos.html', base64: base64('uncertain') }] }),
      );
      const oldUrl = String(sent[0]!.presets[0]!.node.pins[0]!.data);
      const pendingUrl = String(sent[1]!.presets[0]!.node.pins[0]!.data);
      now = 999;
      expect(await (await fetch(pendingUrl)).text()).toBe('uncertain');
      expect(await (await fetch(oldUrl)).text()).toContain('Lower Third');
      now = 1000;
      expect((await fetch(pendingUrl)).status).toBe(404);
      expect((await fetch(oldUrl)).status).toBe(200);
    } finally {
      await stop();
    }
  });

  it('retains current and previous accepted versions and only expires older versions after grace', async () => {
    let now = 0;
    const { host, sent, stop } = await startHost(undefined, {
      now: () => now,
      retentionMs: 1000,
      maxVersions: 3,
    });
    try {
      for (const value of ['one', 'two', 'three'])
        expect(
          (await host.send(sendMessage({ files: [{ path: 'nodos.html', base64: base64(value) }] })))
            .ok,
        ).toBe(true);
      const urls = sent.map((entry) => String(entry.presets[0]!.node.pins[0]!.data));
      expect((await host.send(sendMessage())).ok).toBe(false);
      expect(sent).toHaveLength(3);
      expect(await (await fetch(urls[0]!)).text()).toBe('one');
      now = 1000;
      expect((await fetch(urls[0]!)).status).toBe(404);
      expect(await (await fetch(urls[1]!)).text()).toBe('two');
      expect(await (await fetch(urls[2]!)).text()).toBe('three');
      expect((await host.send(sendMessage())).ok).toBe(true);
    } finally {
      await stop();
    }
  });

  it('rejects byte-budget overflow without evicting accepted packages or issuing an engine request', async () => {
    const { host, sent, stop } = await startHost(undefined, { maxBytes: 30, maxPackageBytes: 15 });
    try {
      const message = (value: string) =>
        sendMessage({ files: [{ path: 'nodos.html', base64: base64(value) }] });
      expect((await host.send(message('12345'))).ok).toBe(true);
      expect((await host.send(message('67890'))).ok).toBe(true);
      expect((await host.send(message('x'))).ok).toBe(false);
      expect(sent).toHaveLength(2);
      for (const entry of sent)
        expect((await fetch(String(entry.presets[0]!.node.pins[0]!.data))).status).toBe(200);
    } finally {
      await stop();
    }
  });

  it('bounds pending work and releases staged files on close', async () => {
    let release!: (result: NodosResult) => void;
    const { host, sent, stop } = await startHost(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      { maxPending: 1 },
    );
    try {
      const request = host.send(sendMessage());
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const url = String(sent[0]!.presets[0]!.node.pins[0]!.data);
      expect((await host.send(sendMessage())).ok).toBe(false);
      expect(sent).toHaveLength(1);
      host.close();
      release({ ok: true, message: 'late response' });
      expect((await request).ok).toBe(false);
      expect((await fetch(url)).status).toBe(404);
      expect((await host.send(sendMessage())).ok).toBe(false);
    } finally {
      await stop();
    }
  });

  it('retains accepted resources on the previous engine after switching addresses', async () => {
    let now = 0;
    const { host, sent, stop } = await startHost(undefined, { now: () => now, retentionMs: 1000 });
    try {
      await host.send(sendMessage());
      const oldEngineUrl = String(sent[0]!.presets[0]!.node.pins[0]!.data);
      for (const value of ['one', 'two', 'three'])
        await host.send(
          sendMessage({
            address: 'localhost:50053',
            files: [{ path: 'nodos.html', base64: base64(value) }],
          }),
        );
      now = 2000;
      expect(await (await fetch(oldEngineUrl)).text()).toContain('Lower Third');
      expect((await fetch(String(sent[1]!.presets[0]!.node.pins[0]!.data))).status).toBe(404);
      expect(await (await fetch(String(sent[2]!.presets[0]!.node.pins[0]!.data))).text()).toBe(
        'two',
      );
      expect(await (await fetch(String(sent[3]!.presets[0]!.node.pins[0]!.data))).text()).toBe(
        'three',
      );
    } finally {
      await stop();
    }
  });
});

describe('Nodos preset objects', () => {
  it.each([
    ['uint', -1, 'Pin "value"'],
    ['int', 1.9, 'Pin "value"'],
    ['byte', 128, 'Pin "value"'],
    ['ushort', 65536, 'Pin "value"'],
    ['float', 1e40, 'Pin "value"'],
    ['double', Infinity, 'Pin "value"'],
    ['long', Number.MAX_SAFE_INTEGER + 1, 'Pin "value"'],
    ['ulong', -1, 'Pin "value"'],
    ['demo.Trend', 128, 'Pin "value"'],
    ['demo.LargeCode', 'TooLarge', 'Pin "value"'],
    ['demo.Quote', { trend: 128 }, 'Pin "value".trend'],
    ['demo.Counter', { value: 1.2 }, 'Pin "value".value'],
    ['demo.Counter', { values: [1, -1] }, 'Pin "value".values[1]'],
    ['[demo.Vec2]', [{ x: 1, y: 1e40 }], 'Pin "value"[0].y'],
    ['nos.Dict', { quotes: [{ price: NaN }] }, 'Pin "value".quotes[0].price'],
  ] as const)('rejects lossy %s values before the SDK writer runs', (typeName, value, path) => {
    const types = new TypeSchema(
      new Uint8Array(readFileSync(new URL('./fixtures/types.bfbs', import.meta.url))),
    );
    const write = vi.spyOn(types, 'write');
    expect(() =>
      nodosPresetObject(
        {
          ...preset,
          node: { ...preset.node, pins: [{ name: 'value', type_name: typeName, data: value }] },
        },
        types,
      ),
    ).toThrow(path);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ['byte', -128],
    ['byte', 127],
    ['uint', 4294967295],
    ['int', -2147483648],
    ['long', Number.MIN_SAFE_INTEGER],
    ['long', Number.MAX_SAFE_INTEGER],
    ['ulong', Number.MAX_SAFE_INTEGER],
    ['demo.LargeCode', 'SafeMax'],
    ['[uint]', [0, 4294967295]],
    ['demo.Counter', { value: 2147483647, values: [0, 255] }],
    [
      'demo.Quote',
      { label: 'market', position: { x: 1.5, y: -2 }, trend: 'Up', values: [1.25, 2.5] },
    ],
  ] as const)('keeps valid %s data unchanged through the SDK codec', (typeName, value) => {
    const types = new TypeSchema(
      new Uint8Array(readFileSync(new URL('./fixtures/types.bfbs', import.meta.url))),
    );
    const object = nodosPresetObject(
      {
        ...preset,
        node: { ...preset.node, pins: [{ name: 'value', type_name: typeName, data: value }] },
      },
      types,
    );
    expect(types.read(typeName, new Uint8Array(object.node!.pins[0]!.data))).toEqual(value);
  });

  it('bounds deeply nested values and reports the offending path', () => {
    let value: Record<string, unknown> = { last: 1 };
    for (let i = 0; i < 70; i++) value = { next: value };
    const types = new TypeSchema();
    expect(() =>
      nodosPresetObject(
        {
          ...preset,
          node: { ...preset.node, pins: [{ name: 'nested', type_name: 'nos.Dict', data: value }] },
        },
        types,
      ),
    ).toThrow(/Pin "nested"\.next.*nesting/);
    const cyclic: Record<string, unknown> = {};
    cyclic.next = cyclic;
    expect(() =>
      nodosPresetObject(
        {
          ...preset,
          node: { ...preset.node, pins: [{ name: 'cycle', type_name: 'nos.Dict', data: cyclic }] },
        },
        types,
      ),
    ).toThrow('Pin "cycle".next: native values cannot contain cycles.');
  });

  it('writes each pin value as its Nodos type', () => {
    const types = new TypeSchema();
    const object = nodosPresetObject(
      {
        ...preset,
        node: {
          ...preset.node,
          pins: [
            ...preset.node.pins,
            { name: 'person', type_name: 'nos.Dict', data: { name: 'Ada', tags: ['a', 'b'] } },
          ],
        },
      },
      types,
    );
    expect(object.name).toBe('ograf.Lower_Third');
    expect(object.menuInfo?.category).toBe('OGraf');
    const pins = object.node!.pins;
    expect(pins.map((pin) => pin.typeName)).toEqual(['string', 'uint', 'string', 'nos.Dict']);
    expect(pins[1]!.data).toEqual([0x80, 0x07, 0, 0]);
    expect(types.read('nos.Dict', new Uint8Array(pins[3]!.data))).toEqual({
      name: 'Ada',
      tags: ['a', 'b'],
    });
  });

  it('refuses a value that does not fit its pin type', () => {
    expect(() =>
      nodosPresetObject(
        {
          ...preset,
          node: { ...preset.node, pins: [{ name: 'n', type_name: 'uint', data: 'x' }] },
        },
        new TypeSchema(),
      ),
    ).toThrow(/needs a number/);
  });
});
