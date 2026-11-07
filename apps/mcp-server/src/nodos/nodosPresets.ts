import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  NodosConnection,
  type NodosPresetDefinition,
  type NodosResult,
  type NodosTypeList,
} from './nodosConnection';

/** The page in a template's files that the preset's ElectroNode loads. Its URL pin names it relative to the files. */
const URL_PIN = 'URL';

const pinSchema = z.object({
  name: z.string().min(1),
  type_name: z.string().min(1),
  display_name: z.string().optional(),
  description: z.string().optional(),
  show_as: z.enum(['PROPERTY', 'OUTPUT_PIN', 'INPUT_PIN']).optional(),
  can_show_as: z
    .enum([
      'PROPERTY_ONLY',
      'OUTPUT_PIN_ONLY',
      'OUTPUT_PIN_OR_PROPERTY',
      'INPUT_PIN_ONLY',
      'INPUT_PIN_OR_PROPERTY',
      'INPUT_OUTPUT',
      'INPUT_OUTPUT_PROPERTY',
    ])
    .optional(),
  data: z.unknown().optional(),
});

const presetSchema = z.object({
  name: z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9_.]+$/, 'A preset name holds only letters, digits, dots and underscores.'),
  menu_info: z.object({ display_name: z.string(), category: z.string() }),
  node: z.object({
    class_name: z.string().min(1),
    display_name: z.string().optional(),
    pins: z.array(pinSchema),
  }),
});

const fileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      (path) => !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'),
      'A file path must stay inside the template.',
    ),
  base64: z.string(),
});

/** The editor asks to set a template as a Nodos preset, with the files its page needs. */
export const nodosSendMessageSchema = z.object({
  type: z.literal('nodos.send'),
  requestId: z.string(),
  address: z.string().trim().min(1).max(2048),
  preset: presetSchema,
  files: z.array(fileSchema),
});
export type NodosSendMessage = z.infer<typeof nodosSendMessageSchema>;

export interface NodosPresetHostOptions {
  /** Keep superseded and uncertain registrations fetchable briefly while nodes finish switching. */
  retentionMs?: number;
  maxBytes?: number;
  maxPackageBytes?: number;
  maxVersions?: number;
  maxPending?: number;
  now?: () => number;
}

interface HostedVersion {
  presetName: string;
  version: string;
  files: Map<string, Buffer>;
  bytes: number;
  expiresAt: number | null;
}

/**
 * Sets templates as Nodos presets and serves their files, which ElectroNodes load over HTTP from this server at
 * immutable version URLs. The current and previous accepted versions stay available; older and uncertain updates
 * retain a bounded grace period. Admission fails rather than evicting accepted or still-needed staged resources.
 */
export class NodosPresetHost {
  readonly #packages = new Map<string, Map<string, HostedVersion>>();
  readonly #accepted = new Map<string, string[]>();
  readonly #latest = new Map<string, string>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #limits: Required<NodosPresetHostOptions>;
  #bytes = 0;
  #versions = 0;
  #pending = 0;
  #closed = false;

  constructor(
    readonly httpServer: HttpServer,
    readonly connection: Pick<
      NodosConnection,
      'setPresets' | 'types' | 'onTypes' | 'close'
    > = new NodosConnection(),
    options: NodosPresetHostOptions = {},
  ) {
    this.#limits = {
      retentionMs: 60_000,
      maxBytes: 256 * 1024 * 1024,
      maxPackageBytes: 64 * 1024 * 1024,
      maxVersions: 128,
      maxPending: 8,
      now: Date.now,
      ...options,
    };
  }

  install(app: Express): void {
    app.get('/nodos/:preset/*path', (request: Request, response: Response) => {
      this.#prune();
      const presetName = String(request.params.preset);
      const segments = request.params.path;
      const parts = Array.isArray(segments) ? segments : String(segments ?? '').split('/');
      const version = parts[0] === '_versions' ? parts[1] : this.#latest.get(presetName);
      const path = (parts[0] === '_versions' ? parts.slice(2) : parts).join('/');
      const data = version
        ? this.#packages.get(presetName)?.get(version)?.files.get(path)
        : undefined;
      if (!data) return response.status(404).send('Not found.');
      response.type(extname(path) || 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      return response.send(data);
    });
  }

  async send(message: NodosSendMessage): Promise<NodosResult> {
    if (this.#closed)
      return { ok: false, message: 'The Nodos preset host is closed.', outcome: 'not-sent' };
    this.#prune();
    if (message.files.length > 4096)
      return {
        ok: false,
        message: 'A Nodos package may contain at most 4096 files.',
        outcome: 'not-sent',
      };
    if (this.#pending >= this.#limits.maxPending)
      return {
        ok: false,
        message: 'Too many Nodos preset updates are pending. Try again after they finish.',
        outcome: 'not-sent',
      };
    const preset: NodosPresetDefinition = structuredClone(message.preset);
    const urlPin = preset.node.pins.find((pin) => pin.name === URL_PIN);
    if (!urlPin || typeof urlPin.data !== 'string')
      return { ok: false, message: `The preset has no ${URL_PIN} pin naming its page.` };
    const estimatedBytes = message.files.reduce(
      (sum, file) => sum + Buffer.byteLength(file.base64, 'base64') + Buffer.byteLength(file.path),
      0,
    );
    if (
      estimatedBytes > this.#limits.maxPackageBytes ||
      this.#bytes + estimatedBytes > this.#limits.maxBytes ||
      this.#versions >= this.#limits.maxVersions
    )
      return {
        ok: false,
        message:
          'Nodos preset storage limit reached. Current and previous accepted graphics are retained; wait for older staged versions to expire or reduce the package size.',
        outcome: 'not-sent',
      };
    const files = new Map(
      message.files.map((file) => [file.path, Buffer.from(file.base64, 'base64')]),
    );
    if (files.size !== message.files.length)
      return {
        ok: false,
        message: 'The template contains duplicate file paths.',
        outcome: 'not-sent',
      };
    if (!files.has(urlPin.data))
      return { ok: false, message: `The template's files do not include ${urlPin.data}.` };
    const baseUrl = this.#baseUrl();
    if (!baseUrl)
      return {
        ok: false,
        message: 'The Studio file server is not listening.',
        outcome: 'not-sent',
      };
    let path: string;
    try {
      path = urlPin.data.split('/').map(encodeURIComponent).join('/');
    } catch {
      return {
        ok: false,
        message: 'The template page path is not valid Unicode.',
        outcome: 'not-sent',
      };
    }
    const entry: HostedVersion = {
      presetName: preset.name,
      version: randomUUID(),
      files,
      bytes: [...files].reduce(
        (sum, [path, file]) => sum + file.length + Buffer.byteLength(path),
        0,
      ),
      expiresAt: null,
    };
    let versions = this.#packages.get(preset.name);
    if (!versions) this.#packages.set(preset.name, (versions = new Map()));
    versions.set(entry.version, entry);
    this.#bytes += entry.bytes;
    this.#versions++;
    this.#pending++;
    urlPin.data = `${baseUrl}/nodos/${encodeURIComponent(preset.name)}/_versions/${entry.version}/${path}`;
    // One preset's registrations are ordered even when multiple editor requests arrive together.
    // Other presets remain independent. Queued packages count against the same memory/request limits.
    const operation = (this.#tails.get(preset.name) ?? Promise.resolve()).then(async () => {
      if (this.#closed)
        return {
          ok: false,
          message: 'The Nodos preset host is closed.',
          outcome: 'not-sent' as const,
        };
      let result: NodosResult;
      try {
        result = await this.connection.setPresets(message.address, [preset]);
      } catch (error) {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          outcome: 'unknown',
        };
      }
      if (this.#closed)
        return {
          ok: false,
          message: 'The Nodos preset host closed during registration.',
          outcome: 'unknown' as const,
        };
      if (result.ok) {
        // An old engine may still use its accepted preset after the editor changes address.
        const key = JSON.stringify([message.address, preset.name]);
        const accepted = this.#accepted.get(key) ?? [];
        accepted.unshift(entry.version);
        this.#accepted.set(key, accepted.slice(0, 2));
        this.#latest.set(preset.name, entry.version);
        for (const retired of accepted.slice(2)) {
          const previous = this.#packages.get(preset.name)?.get(retired);
          if (previous) previous.expiresAt = this.#limits.now() + this.#limits.retentionMs;
        }
      } else if (result.outcome === 'rejected' || result.outcome === 'not-sent') {
        this.#remove(entry);
      } else {
        // A timeout does not prove Nodos rejected the update. Its nodes may still fetch this URL.
        entry.expiresAt = this.#limits.now() + this.#limits.retentionMs;
      }
      return result;
    });
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(preset.name, tail);
    try {
      return await operation;
    } finally {
      this.#pending--;
      if (this.#tails.get(preset.name) === tail) this.#tails.delete(preset.name);
    }
  }

  /** Calls `listener` with the engine's types each time the engine sends them. */
  onTypes(listener: (address: string, types: NodosTypeList) => void): void {
    this.connection.onTypes = (address, types) => {
      if (!this.#closed) listener(address, types);
    };
  }

  /** The structs, tables and enums of the Nodos engine at this address, for fields to take as their types. */
  types(address: string): Promise<({ ok: true } & NodosTypeList) | NodosResult> {
    if (this.#closed)
      return Promise.resolve({
        ok: false,
        message: 'The Nodos preset host is closed.',
        outcome: 'not-sent',
      });
    return this.connection.types(address);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.connection.onTypes = null;
    this.connection.close();
    this.#packages.clear();
    this.#accepted.clear();
    this.#latest.clear();
    this.#tails.clear();
    this.#bytes = 0;
    this.#versions = 0;
  }

  #remove(entry: HostedVersion): void {
    const versions = this.#packages.get(entry.presetName);
    if (!versions?.delete(entry.version)) return;
    this.#bytes -= entry.bytes;
    this.#versions--;
    if (!versions.size) this.#packages.delete(entry.presetName);
  }

  #prune(): void {
    const now = this.#limits.now();
    for (const versions of this.#packages.values())
      for (const entry of versions.values())
        if (entry.expiresAt !== null && entry.expiresAt <= now) this.#remove(entry);
  }

  #baseUrl(): string | null {
    const address = this.httpServer.address();
    return address && typeof address !== 'string'
      ? `http://127.0.0.1:${(address as AddressInfo).port}`
      : null;
  }
}
