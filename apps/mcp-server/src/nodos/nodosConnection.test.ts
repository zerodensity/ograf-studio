import * as grpc from '@grpc/grpc-js';
import * as flatbuffers from 'flatbuffers';
import { readFileSync } from 'node:fs';
import { nos, TypeSchema } from '@nodos/editor-sdk';
import { describe, expect, it, vi } from 'vitest';
import { NodosConnection, type NodosTypeList, type NodosPresetDefinition } from './nodosConnection';

type EngineStream = grpc.ServerDuplexStream<Uint8Array, Uint8Array>;
const path = '/nos.editor.EditorService/Connect';
const serialize = (value: Uint8Array) => Buffer.from(value);
const deserialize = (value: Buffer) => new Uint8Array(value);
const nativeTypes = new Uint8Array(readFileSync(new URL('./fixtures/types.bfbs', import.meta.url)));

function request(bytes: Uint8Array) {
  const message = nos.editor.FromEditor.getRootAsFromEditor(
    new flatbuffers.ByteBuffer(bytes),
  ).unpack();
  return {
    kind: message.eventType,
    id: Buffer.from(message.requestId!.bytes).toString('hex'),
    presets:
      message.eventType === nos.editor.FromEditorUnion.SetNodePresetsRequest
        ? (message.event as nos.editor.SetNodePresetsRequestT).presets
        : [],
  };
}

function connected(schema?: Uint8Array) {
  const builder = new flatbuffers.Builder(2048);
  const body = new nos.editor.ClientConnectedT();
  if (schema) body.state = new nos.editor.EngineStateT([...schema]);
  builder.finish(
    new nos.editor.FromEngineT(nos.editor.FromEngineUnion.ClientConnected, body).pack(builder),
  );
  return builder.asUint8Array();
}

function response(id: string, status = nos.editor.RequestStatus.SUCCESS) {
  const builder = new flatbuffers.Builder(128);
  const body = new nos.editor.ResponseT(null, null, status);
  builder.finish(
    new nos.editor.FromEngineT(
      nos.editor.FromEngineUnion.Response,
      body,
      new nos.fb.UUIDT([...Buffer.from(id, 'hex')]),
    ).pack(builder),
  );
  return builder.asUint8Array();
}

function typeUpdate(schema: Uint8Array) {
  const builder = new flatbuffers.Builder(2048);
  builder.finish(
    new nos.editor.FromEngineT(
      nos.editor.FromEngineUnion.EngineState,
      new nos.editor.EngineStateT([...schema]),
    ).pack(builder),
  );
  return builder.asUint8Array();
}

async function engine(
  handle: (stream: EngineStream, message: ReturnType<typeof request>, connection: number) => void,
) {
  const server = new grpc.Server();
  const streams: EngineStream[] = [];
  server.addService(
    {
      connect: {
        path,
        requestStream: true,
        responseStream: true,
        requestSerialize: serialize,
        requestDeserialize: deserialize,
        responseSerialize: serialize,
        responseDeserialize: deserialize,
      },
    },
    {
      connect: (stream: EngineStream) => {
        streams.push(stream);
        const index = streams.length;
        stream.on('error', () => undefined);
        stream.on('data', (bytes) => handle(stream, request(bytes), index));
      },
    },
  );
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) =>
      error ? reject(error) : resolve(port),
    ),
  );
  return { address: `127.0.0.1:${port}`, streams, close: () => server.forceShutdown() };
}

describe('Nodos Editor API connection lifecycle', () => {
  it('uses SDK messages and the engine schema for native scalar, Dict, struct, enum and array pins', async () => {
    let received: nos.fb.NodePresetDefinitionT | undefined;
    const server = await engine((stream, message) => {
      if (message.kind === nos.editor.FromEditorUnion.ConnectionRequest)
        stream.write(connected(nativeTypes));
      else {
        received = message.presets[0];
        stream.write(response(message.id));
      }
    });
    const connection = new NodosConnection();
    const preset: NodosPresetDefinition = {
      name: 'ograf.Native',
      menu_info: { display_name: 'Native', category: 'OGraf' },
      node: {
        class_name: 'nos.app.electronode.ElectroNode',
        pins: [
          { name: 'count', type_name: 'uint', data: 42 },
          { name: 'visible', type_name: 'bool', data: true },
          { name: 'title', type_name: 'string', data: 'Hello' },
          { name: 'extra', type_name: 'nos.Dict', data: { name: 'Ada', scores: [1, 2] } },
          { name: 'position', type_name: 'demo.Vec2', data: { x: 1.5, y: -2 } },
          { name: 'trend', type_name: 'demo.Trend', data: 'Up' },
          {
            name: 'positions',
            type_name: '[demo.Vec2]',
            data: [
              { x: 2, y: 3 },
              { x: 4, y: 5 },
            ],
          },
          {
            name: 'quote',
            type_name: 'demo.Quote',
            data: { label: 'BTC', position: { x: 1, y: 2 }, trend: 'Down', values: [10.5, 11.5] },
          },
        ],
      },
    };
    try {
      expect((await connection.setPresets(server.address, [preset])).ok).toBe(true);
      const types = new TypeSchema(nativeTypes);
      expect(received?.name).toBe(preset.name);
      for (const pin of received!.node!.pins) {
        const input = preset.node.pins.find((value) => value.name === pin.name)!;
        expect(types.read(String(pin.typeName), new Uint8Array(pin.data))).toEqual(input.data);
      }
      const result = await connection.types(server.address);
      expect(result).toMatchObject({
        ok: true,
        objects: expect.arrayContaining([
          expect.objectContaining({
            name: 'demo.Vec2',
            isStruct: true,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'x',
                type: expect.objectContaining({ base: 'Float' }),
              }),
            ]),
          }),
          expect.objectContaining({ name: 'demo.Quote', isStruct: false }),
        ]),
        enums: expect.arrayContaining([
          expect.objectContaining({ name: 'demo.Trend', values: ['Down', 'Flat', 'Up'] }),
        ]),
      });
      if ('enums' in result)
        expect(result.enums.map((value) => value.name)).not.toContain('demo.LargeCode');
    } finally {
      connection.close();
      server.close();
    }
  });

  it.each([
    { type: 'demo.Vec2', data: 'bad' },
    { type: 'uint', data: -1 },
  ])('rejects invalid $type values before sending a preset request', async (input) => {
    let writes = 0;
    const server = await engine((stream, message) => {
      if (message.kind === nos.editor.FromEditorUnion.ConnectionRequest)
        stream.write(connected(nativeTypes));
      else {
        writes++;
        stream.write(response(message.id));
      }
    });
    const connection = new NodosConnection();
    try {
      const result = await connection.setPresets(server.address, [
        {
          name: 'ograf.Invalid',
          menu_info: { display_name: 'Invalid', category: 'OGraf' },
          node: {
            class_name: 'test',
            pins: [{ name: 'value', type_name: input.type, data: input.data }],
          },
        },
      ]);
      expect(result).toMatchObject({ ok: false, outcome: 'not-sent' });
      expect(writes).toBe(0);
    } finally {
      connection.close();
      server.close();
    }
  });

  it('publishes changing type catalogs without allowing a listener failure to break the connection', async () => {
    const changes: Array<{ address: string; types: NodosTypeList }> = [];
    const server = await engine((stream, message) => {
      if (message.kind === nos.editor.FromEditorUnion.ConnectionRequest)
        stream.write(connected(nativeTypes));
      else stream.write(response(message.id));
    });
    const connection = new NodosConnection();
    connection.onTypes = (address, types) => {
      changes.push({ address, types });
      throw new Error('UI listener failure');
    };
    try {
      expect((await connection.types(server.address)).ok).toBe(true);
      server.streams[0]!.write(typeUpdate(nativeTypes));
      await vi.waitFor(() => expect(changes).toHaveLength(2));
      expect(changes.every((change) => change.address === server.address)).toBe(true);
      expect((await connection.setPresets(server.address, [])).ok).toBe(true);
    } finally {
      connection.close();
      server.close();
    }
  });

  it('does not publish a late type catalog from a superseded engine', async () => {
    const changes: string[] = [];
    const oldServer = await engine(() => undefined);
    const newServer = await engine((stream, message) => {
      if (message.kind === nos.editor.FromEditorUnion.ConnectionRequest)
        stream.write(connected(nativeTypes));
      else stream.write(response(message.id));
    });
    const connection = new NodosConnection({ connectTimeoutMs: 1000 });
    connection.onTypes = (address) => changes.push(address);
    try {
      const old = connection.types(oldServer.address);
      await vi.waitFor(() => expect(oldServer.streams).toHaveLength(1));
      expect((await connection.types(newServer.address)).ok).toBe(true);
      oldServer.streams[0]!.write(connected(nativeTypes));
      expect(await old).toMatchObject({ ok: false, outcome: 'not-sent' });
      expect((await connection.setPresets(newServer.address, [])).ok).toBe(true);
      expect(changes).toEqual([newServer.address]);
    } finally {
      connection.close();
      oldServer.close();
      newServer.close();
    }
  });
  it('reconnects after a handshake timeout instead of reusing a permanently rejected promise', async () => {
    const server = await engine((stream, message, index) => {
      if (index === 1) return;
      if (message.kind === 3) stream.write(connected());
      else if (message.kind === 67) stream.write(response(message.id));
    });
    const connection = new NodosConnection({ connectTimeoutMs: 250, requestTimeoutMs: 1000 });
    try {
      const first = await connection.setPresets(server.address, []);
      expect(first).toMatchObject({ ok: false, outcome: 'not-sent' });
      expect(first.message).toContain('did not answer');
      expect(connection.address).toBeNull();
      expect(await connection.setPresets(server.address, [])).toEqual({ ok: true, message: '' });
      expect(server.streams).toHaveLength(2);
    } finally {
      connection.close();
      server.close();
    }
  });

  it('settles an old pending handshake when the engine address changes', async () => {
    const oldServer = await engine(() => undefined);
    const newServer = await engine((stream, message) => {
      if (message.kind === 3) stream.write(connected());
      else stream.write(response(message.id));
    });
    const connection = new NodosConnection({ connectTimeoutMs: 1000 });
    try {
      const old = connection.setPresets(oldServer.address, []);
      await vi.waitFor(() => expect(oldServer.streams).toHaveLength(1));
      expect((await connection.setPresets(newServer.address, [])).ok).toBe(true);
      expect(await old).toMatchObject({
        ok: false,
        outcome: 'not-sent',
        message: 'The Nodos engine address changed.',
      });
      expect(connection.address).toBe(newServer.address);
    } finally {
      connection.close();
      oldServer.close();
      newServer.close();
    }
  });

  it('settles a sent request immediately when closed and marks its outcome unknown', async () => {
    let sent = false;
    const server = await engine((stream, message) => {
      if (message.kind === 3) stream.write(connected());
      else sent = true;
    });
    const connection = new NodosConnection({ requestTimeoutMs: 5000 });
    try {
      const pending = connection.setPresets(server.address, []);
      await vi.waitFor(() => expect(sent).toBe(true));
      connection.close();
      expect(await pending).toEqual({
        ok: false,
        outcome: 'unknown',
        message: 'The Nodos connection was closed.',
      });
      expect(connection.address).toBeNull();
    } finally {
      connection.close();
      server.close();
    }
  });

  it('distinguishes explicit rejection from a request timeout and ignores a late response', async () => {
    let sequence = 0;
    let late: { stream: EngineStream; id: string } | undefined;
    const server = await engine((stream, message) => {
      if (message.kind === 3) {
        stream.write(connected());
        return;
      }
      sequence++;
      if (sequence === 1) stream.write(response(message.id, 1));
      else if (sequence === 2) late = { stream, id: message.id };
      else stream.write(response(message.id));
    });
    const connection = new NodosConnection({ requestTimeoutMs: 60 });
    try {
      expect(await connection.setPresets(server.address, [])).toEqual({
        ok: false,
        outcome: 'rejected',
        message: 'Nodos rejected the preset update.',
      });
      expect(await connection.setPresets(server.address, [])).toMatchObject({
        ok: false,
        outcome: 'unknown',
      });
      late!.stream.write(response(late!.id));
      expect(await connection.setPresets(server.address, [])).toEqual({ ok: true, message: '' });
      expect(server.streams).toHaveLength(1);
    } finally {
      connection.close();
      server.close();
    }
  });

  it('correlates concurrent request responses independently of arrival order', async () => {
    const pending: Array<{ stream: EngineStream; id: string }> = [];
    const server = await engine((stream, message) => {
      if (message.kind === 3) {
        stream.write(connected());
        return;
      }
      pending.push({ stream, id: message.id });
      if (pending.length === 2) {
        pending[1]!.stream.write(response(pending[1]!.id, 1));
        pending[0]!.stream.write(response(pending[0]!.id));
      }
    });
    const connection = new NodosConnection();
    try {
      const first = connection.setPresets(server.address, []);
      const second = connection.setPresets(server.address, []);
      expect(await first).toEqual({ ok: true, message: '' });
      expect(await second).toEqual({
        ok: false,
        outcome: 'rejected',
        message: 'Nodos rejected the preset update.',
      });
    } finally {
      connection.close();
      server.close();
    }
  });
});
