import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import * as flatbuffers from 'flatbuffers';
import {
  BaseType,
  nos,
  TypeSchema,
  type EditorEvent,
  type RequestResult,
  type FieldType,
} from '@nodos/editor-sdk';

const EDITOR_SERVICE_METHOD = '/nos.editor.EditorService/Connect';
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface NodosResult extends RequestResult {
  /** Only an explicit engine rejection or an unsent request proves the proposed preset was not applied. */
  outcome?: 'rejected' | 'not-sent' | 'unknown';
}
export interface NodosConnectionOptions {
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}
type Stream = grpc.ClientDuplexStream<Uint8Array, Uint8Array>;

function uuid(id: string): nos.fb.UUIDT {
  const hex = id.replace(/-/g, '');
  return new nos.fb.UUIDT(
    Array.from({ length: 16 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16)),
  );
}
function formatUuid(value: nos.fb.UUID): string {
  const hex = Array.from({ length: 16 }, (_, index) =>
    (value.bytes(index) ?? 0).toString(16).padStart(2, '0'),
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
function encode(
  kind: nos.editor.FromEditorUnion,
  event: EditorEvent,
  requestId: string,
): Uint8Array {
  const builder = new flatbuffers.Builder(1024);
  builder.finish(new nos.editor.FromEditorT(kind, event, uuid(requestId)).pack(builder));
  return builder.asUint8Array();
}

// SDK 5.1 supplies the generated protocol and native value codec. Its EditorConnection does
// not expose request outcome identity/cancellation, so retain Studio's bounded transport and
// explicit FAILED versus uncertain-result semantics instead of handwritten protocol fields.
export type NodosShowAs = 'PROPERTY' | 'OUTPUT_PIN' | 'INPUT_PIN';
export type NodosCanShowAs =
  | 'PROPERTY_ONLY'
  | 'OUTPUT_PIN_ONLY'
  | 'OUTPUT_PIN_OR_PROPERTY'
  | 'INPUT_PIN_ONLY'
  | 'INPUT_PIN_OR_PROPERTY'
  | 'INPUT_OUTPUT'
  | 'INPUT_OUTPUT_PROPERTY';

export interface NodosPresetPin {
  name: string;
  /** Any Nodos type: a scalar, string, nos.Dict, an engine struct, table or enum, or an array [T] of one. */
  type_name: string;
  display_name?: string;
  description?: string;
  show_as?: NodosShowAs;
  can_show_as?: NodosCanShowAs;
  /** The value as JSON data, written as the pin's type. */
  data?: unknown;
}

/** A NodePresetDefinition as the editor sends it: the preset's name, its node menu entry, and its class's node. */
export interface NodosPresetDefinition {
  name: string;
  menu_info: { display_name: string; category: string };
  node: { class_name: string; display_name?: string; pins: NodosPresetPin[] };
}

/** A field's type as the editor gets it, with kinds by name. */
export interface NodosTypeDescription {
  base: string;
  element: string;
  object?: string;
  enum?: string;
  fixedLength: number;
}

/** The engine's structs, tables and enums, as the editor gets them to offer as field types. */
export interface NodosTypeList {
  objects: {
    name: string;
    isStruct: boolean;
    attributes: Record<string, string>;
    fields: { name: string; type: NodosTypeDescription; deprecated: boolean; dynamic: boolean }[];
  }[];
  enums: { name: string; isUnion: boolean; values: string[] }[];
}

const NATIVE_SCALARS: Record<string, BaseType> = {
  bool: BaseType.Bool,
  byte: BaseType.Byte,
  ubyte: BaseType.UByte,
  short: BaseType.Short,
  ushort: BaseType.UShort,
  int: BaseType.Int,
  uint: BaseType.UInt,
  long: BaseType.Long,
  ulong: BaseType.ULong,
  float: BaseType.Float,
  double: BaseType.Double,
};
const INTEGER_BOUNDS: Partial<Record<BaseType, readonly [number, number]>> = {
  [BaseType.UType]: [0, 255],
  [BaseType.Byte]: [-128, 127],
  [BaseType.UByte]: [0, 255],
  [BaseType.Short]: [-32768, 32767],
  [BaseType.UShort]: [0, 65535],
  [BaseType.Int]: [-2147483648, 2147483647],
  [BaseType.UInt]: [0, 4294967295],
  [BaseType.Long]: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  [BaseType.ULong]: [0, Number.MAX_SAFE_INTEGER],
};

/** SDK 5.1 writes numeric C values with DataView coercion; reject loss/wrap before asking it to serialize. */
function validateNativeNumbers(
  types: TypeSchema,
  name: string,
  value: unknown,
  path: string,
): void {
  let nodes = 0;
  const visiting = new Set<object>();
  const enter = (value: unknown, path: string, depth: number, body: () => void) => {
    if (++nodes > 65536 || depth > 64)
      throw new Error(`${path}: native value exceeds the nesting/value limit.`);
    const object = value !== null && typeof value === 'object' ? value : null;
    if (object && visiting.has(object))
      throw new Error(`${path}: native values cannot contain cycles.`);
    if (object) visiting.add(object);
    try {
      body();
    } finally {
      if (object) visiting.delete(object);
    }
  };
  const scalar = (base: BaseType, value: unknown, path: string, enumName?: string) => {
    if (enumName && typeof value === 'string')
      value = types.enums.get(enumName)?.values.find((entry) => entry.name === value)?.value;
    // The SDK owns nonnumeric shape/type validation; it is wrapped with the pin path below.
    if (typeof value !== 'number') return;
    if (!Number.isFinite(value))
      throw new Error(`${path}: ${BaseType[base]} needs a finite number.`);
    const bounds = INTEGER_BOUNDS[base];
    if (bounds && (!Number.isSafeInteger(value) || value < bounds[0] || value > bounds[1]))
      throw new Error(
        `${path}: ${BaseType[base]} needs an integer between ${bounds[0]} and ${bounds[1]}.`,
      );
    if (base === BaseType.Float && !Number.isFinite(Math.fround(value)))
      throw new Error(`${path}: value overflows a 32-bit float.`);
  };
  const dict = (value: unknown, path: string, depth: number) =>
    enter(value, path, depth, () => {
      if (typeof value === 'number') scalar(BaseType.Double, value, path);
      else if (Array.isArray(value))
        value.forEach((entry, index) => dict(entry, `${path}[${index}]`, depth + 1));
      else if (value && typeof value === 'object')
        for (const [key, entry] of Object.entries(value)) dict(entry, `${path}.${key}`, depth + 1);
    });
  const object = (name: string, value: unknown, path: string, depth: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const field of types.objects.get(name)?.fields ?? []) {
      if (field.deprecated) continue;
      const input = value as Record<string, unknown>;
      const entry = input[field.name];
      if (entry === undefined || entry === null) continue;
      if (field.dynamicTypeField) {
        const dynamic = input[field.dynamicTypeField];
        if (typeof dynamic === 'string') named(dynamic, entry, `${path}.${field.name}`, depth + 1);
      } else typed(field.type, entry, `${path}.${field.name}`, depth + 1);
    }
  };
  const typed = (
    type: Pick<FieldType, 'base' | 'element' | 'object' | 'enum'>,
    value: unknown,
    path: string,
    depth: number,
  ): void =>
    enter(value, path, depth, () => {
      if (type.base === BaseType.Vector || type.base === BaseType.Array) {
        if (Array.isArray(value))
          value.forEach((entry, index) =>
            typed(
              { ...type, base: type.element, element: BaseType.None },
              entry,
              `${path}[${index}]`,
              depth + 1,
            ),
          );
      } else if (type.base === BaseType.Obj && type.object === 'nos.Dict') {
        // The outer object is already counted; visit its dynamically typed entries.
        if (value && typeof value === 'object' && !Array.isArray(value))
          for (const [key, entry] of Object.entries(value))
            dict(entry, `${path}.${key}`, depth + 1);
      } else if (type.base === BaseType.Obj && type.object) object(type.object, value, path, depth);
      else scalar(type.base, value, path, type.enum);
    });
  const named = (name: string, value: unknown, path: string, depth: number): void => {
    if (name.startsWith('[') && name.endsWith(']')) {
      enter(value, path, depth, () => {
        if (Array.isArray(value))
          value.forEach((entry, index) =>
            named(name.slice(1, -1), entry, `${path}[${index}]`, depth + 1),
          );
      });
    } else if (name === 'nos.Dict') dict(value, path, depth);
    else if (types.objects.has(name))
      typed({ base: BaseType.Obj, element: BaseType.None, object: name }, value, path, depth);
    else {
      const enumeration = types.enums.get(name);
      enter(value, path, depth, () =>
        scalar(
          enumeration?.underlying ?? NATIVE_SCALARS[name] ?? BaseType.None,
          value,
          path,
          enumeration?.name,
        ),
      );
    }
  };
  named(name, value, path, 0);
}

/** The preset as the Editor API's object, with each pin's value written as its type. Throws when a value does not fit. */
export function nodosPresetObject(
  preset: NodosPresetDefinition,
  types: TypeSchema,
): nos.fb.NodePresetDefinitionT {
  const pins = preset.node.pins.map((pin) => {
    const object = new nos.fb.PinT();
    object.name = pin.name;
    object.typeName = pin.type_name;
    if (pin.display_name) object.displayName = pin.display_name;
    if (pin.description) object.description = pin.description;
    if (pin.show_as) object.showAs = nos.fb.ShowAs[pin.show_as];
    if (pin.can_show_as) object.canShowAs = nos.fb.CanShowAs[pin.can_show_as];
    if (pin.data !== undefined) {
      const path = `Pin "${pin.name}"`;
      validateNativeNumbers(types, pin.type_name, pin.data, path);
      try {
        object.data = [
          ...types.write(pin.type_name, pin.data as Parameters<TypeSchema['write']>[1]),
        ];
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return object;
  });
  const node = new nos.fb.NodeT();
  node.className = preset.node.class_name;
  if (preset.node.display_name) node.displayName = preset.node.display_name;
  node.pins = pins;
  return new nos.fb.NodePresetDefinitionT(
    preset.name,
    new nos.fb.NodeMenuInfoT(preset.menu_info.display_name, preset.menu_info.category),
    node,
  );
}

function typeList(types: TypeSchema): NodosTypeList {
  const describe = (type: {
    base: BaseType;
    element: BaseType;
    object?: string;
    enum?: string;
    fixedLength: number;
  }) => ({
    ...type,
    base: BaseType[type.base],
    element: BaseType[type.element],
  });
  return {
    objects: [...types.objects.values()].map((object) => ({
      name: object.name,
      isStruct: object.isStruct,
      attributes: object.attributes,
      fields: object.fields.map((field) => ({
        name: field.name,
        type: describe(field.type),
        deprecated: field.deprecated,
        dynamic: field.dynamicTypeField !== undefined,
      })),
    })),
    enums: [...types.enums.values()]
      .filter((enumeration) => {
        const bounds = INTEGER_BOUNDS[enumeration.underlying];
        return (
          !!bounds &&
          enumeration.values.every(
            ({ value }) => Number.isSafeInteger(value) && value >= bounds[0] && value <= bounds[1],
          )
        );
      })
      .map((enumeration) => ({
        name: enumeration.name,
        isUnion: enumeration.isUnion,
        values: enumeration.values.map((value) => value.name),
      })),
  };
}

/** One Editor API stream to a Nodos engine, as an editor client named OGraf Studio. */
class NodosStream {
  readonly #client: grpc.Client;
  readonly #stream: Stream;
  readonly #waiting = new Map<string, (result: NodosResult) => void>();
  readonly connected: Promise<void>;
  #connectTimer: ReturnType<typeof setTimeout> | null = null;
  #rejectConnected: (error: Error) => void = () => undefined;
  closed = false;
  types = new TypeSchema();

  constructor(
    readonly address: string,
    readonly options: NodosConnectionOptions,
    readonly onTypes: (types: TypeSchema) => void,
  ) {
    // The engine state sent on connect holds every node class, so it is far larger than gRPC's default limit.
    this.#client = new grpc.Client(address, grpc.credentials.createInsecure(), {
      'grpc.max_receive_message_length': -1,
      'grpc.max_send_message_length': -1,
    });
    try {
      this.#stream = this.#client.makeBidiStreamRequest(
        EDITOR_SERVICE_METHOD,
        (message: Uint8Array) => Buffer.from(message),
        (message: Buffer) => new Uint8Array(message),
      );
    } catch (error) {
      this.#client.close();
      throw error;
    }
    this.connected = new Promise<void>((resolve, reject) => {
      this.#rejectConnected = reject;
      const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
      this.#connectTimer = setTimeout(
        () => this.close(`Nodos at ${address} did not answer within ${connectTimeoutMs / 1000} s.`),
        connectTimeoutMs,
      );
      this.#stream.on('data', (bytes: Uint8Array) => {
        if (this.closed) return;
        try {
          const message = nos.editor.FromEngine.getRootAsFromEngine(
            new flatbuffers.ByteBuffer(bytes),
          );
          this.#takeTypes(message);
          if (message.eventType() === nos.editor.FromEngineUnion.ClientConnected) {
            if (this.#connectTimer) clearTimeout(this.#connectTimer);
            this.#connectTimer = null;
            resolve();
            return;
          }
          if (message.eventType() !== nos.editor.FromEngineUnion.Response) return;
          const id = message.instigatorId();
          const response = message.event(new nos.editor.Response()) as nos.editor.Response | null;
          if (!id || !response || response.status() === nos.editor.RequestStatus.STARTED) return;
          const requestId = formatUuid(id);
          const answer = this.#waiting.get(requestId);
          if (!answer) return;
          const rejected = response.status() === nos.editor.RequestStatus.FAILED;
          if (
            !rejected &&
            ![nos.editor.RequestStatus.SUCCESS, nos.editor.RequestStatus.WARNING].includes(
              response.status(),
            )
          )
            return;
          this.#waiting.delete(requestId);
          answer({
            ok: !rejected,
            message:
              response.message()?.message()?.text() ||
              (rejected ? 'Nodos rejected the preset update.' : ''),
            ...(rejected ? { outcome: 'rejected' as const } : {}),
          });
        } catch {
          this.close('Nodos returned an unreadable Editor API message.');
        }
      });
      this.#stream.on('error', (error: Error) =>
        this.close(`The connection to Nodos at ${address} failed: ${error.message}`),
      );
      this.#stream.on('end', () => this.close(`Nodos at ${address} closed the connection.`));
    });
    // A failed connection is reported to the request that waits for it.
    this.connected.catch(() => undefined);
    try {
      this.#stream.write(
        encode(
          nos.editor.FromEditorUnion.ConnectionRequest,
          new nos.editor.ConnectionRequestT('OGraf Studio'),
          randomUUID(),
        ),
      );
    } catch (error) {
      this.close(error instanceof Error ? error.message : 'Could not connect to Nodos.');
    }
  }

  #takeTypes(message: nos.editor.FromEngine): void {
    const state =
      message.eventType() === nos.editor.FromEngineUnion.ClientConnected
        ? (
            message.event(new nos.editor.ClientConnected()) as nos.editor.ClientConnected | null
          )?.state()
        : message.eventType() === nos.editor.FromEngineUnion.EngineState
          ? (message.event(new nos.editor.EngineState()) as nos.editor.EngineState | null)
          : null;
    const schema = state?.typeSchemaArray();
    if (!schema?.length) return;
    this.types = new TypeSchema(
      new Uint8Array(schema.buffer, schema.byteOffset, schema.byteLength),
    );
    try {
      this.onTypes(this.types);
    } catch {
      /* A UI listener cannot terminate the engine connection. */
    }
  }

  request(encode: (requestId: string) => Uint8Array): Promise<NodosResult> {
    if (this.closed)
      return Promise.resolve({
        ok: false,
        message: 'The Nodos connection is closed.',
        outcome: 'not-sent',
      });
    const requestId = randomUUID();
    let bytes: Uint8Array;
    try {
      bytes = encode(requestId);
    } catch (error) {
      return Promise.resolve({
        ok: false,
        message: error instanceof Error ? error.message : 'Could not encode the Nodos request.',
        outcome: 'not-sent',
      });
    }
    return new Promise<NodosResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.#waiting.delete(requestId);
        resolve({
          ok: false,
          message: 'Nodos did not answer the request; its result is unknown.',
          outcome: 'unknown',
        });
      }, this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
      this.#waiting.set(requestId, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      try {
        this.#stream.write(bytes);
      } catch (error) {
        this.close(error instanceof Error ? error.message : 'Could not send the Nodos request.');
      }
    });
  }

  close(reason = 'The Nodos connection was closed.'): void {
    if (this.closed) return;
    this.closed = true;
    if (this.#connectTimer) clearTimeout(this.#connectTimer);
    this.#connectTimer = null;
    this.#rejectConnected(new Error(reason));
    for (const answer of this.#waiting.values())
      answer({ ok: false, message: reason, outcome: 'unknown' });
    this.#waiting.clear();
    this.#stream.cancel();
    this.#client.close();
  }
}

/** Keeps one bounded connection and exposes only the current engine's type catalog. */
export class NodosConnection {
  #stream: NodosStream | null = null;
  onTypes: ((address: string, types: NodosTypeList) => void) | null = null;
  constructor(readonly options: NodosConnectionOptions = {}) {}
  get address(): string | null {
    return this.#stream && !this.#stream.closed ? this.#stream.address : null;
  }
  async #connect(address: string): Promise<NodosStream | NodosResult> {
    try {
      if (this.#stream?.closed || this.#stream?.address !== address) {
        this.#stream?.close('The Nodos engine address changed.');
        const stream = new NodosStream(address, this.options, (types) => {
          if (this.#stream === stream && !stream.closed) this.onTypes?.(address, typeList(types));
        });
        this.#stream = stream;
      }
      const stream = this.#stream;
      await stream.connected;
      if (stream !== this.#stream || stream.closed)
        return {
          ok: false,
          message: 'The Nodos connection changed before the request was sent.',
          outcome: 'not-sent',
        };
      return stream;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        outcome: 'not-sent',
      };
    }
  }
  async setPresets(address: string, presets: NodosPresetDefinition[]): Promise<NodosResult> {
    const stream = await this.#connect(address);
    if (!(stream instanceof NodosStream)) return stream;
    try {
      const objects = presets.map((preset) => nodosPresetObject(preset, stream.types));
      return stream.request((requestId) =>
        encode(
          nos.editor.FromEditorUnion.SetNodePresetsRequest,
          new nos.editor.SetNodePresetsRequestT(objects),
          requestId,
        ),
      );
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        outcome: 'not-sent',
      };
    }
  }
  async types(address: string): Promise<({ ok: true } & NodosTypeList) | NodosResult> {
    const stream = await this.#connect(address);
    return stream instanceof NodosStream ? { ok: true, ...typeList(stream.types) } : stream;
  }
  close(): void {
    this.#stream?.close();
    this.#stream = null;
  }
}
