import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import * as z from 'zod/v4';
import {
  MAX_PLAYOUT_DATA_BYTES,
  MAX_PLAYOUT_REQUEST_BYTES,
} from '@ograf-editor/agent-tools/playout';
import { validateManifest } from '@ograf-editor/validation';

export const SHARED_PLAYOUT_ASSET_FILES = [
  'shared-playout.html',
  'shared-playout.js',
  'ograf-player.js',
] as const;

type AssetName = (typeof SHARED_PLAYOUT_ASSET_FILES)[number];
export type SharedPlayoutAssetPaths = Readonly<Record<AssetName, string>>;
type Assets = ReadonlyMap<AssetName, Buffer>;

export async function loadSharedPlayoutAssets(embedded?: SharedPlayoutAssetPaths): Promise<Assets> {
  return new Map(
    await Promise.all(
      SHARED_PLAYOUT_ASSET_FILES.map(async (name) => {
        const path =
          embedded?.[name] ??
          new URL(`../../../packages/ograf-web-player/${name}`, import.meta.url);
        return [name, await readFile(path)] as const;
      }),
    ),
  );
}

const MAX_PUBLISH_BODY_BYTES = 48 * 1024 * 1024;
const ID = z.string().min(1).max(256);
const commandData = z.record(z.string(), z.unknown()).refine((data) => {
  let count = 0;
  const visit = (value: unknown, depth: number): boolean => {
    if (++count > 4096 || depth > 16) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    return (
      typeof value === 'object' &&
      Object.entries(value).every(
        ([key, child]) =>
          key !== '__proto__' &&
          key !== 'constructor' &&
          key !== 'prototype' &&
          visit(child, depth + 1),
      )
    );
  };
  return visit(data, 0) && Buffer.byteLength(JSON.stringify(data)) <= MAX_PLAYOUT_DATA_BYTES;
});

const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('play'), delta: z.int().optional() }),
  z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('update'), data: commandData }),
  z.strictObject({ kind: z.literal('action'), actionId: ID, payload: commandData.optional() }),
]);

const requestSchema = z.strictObject({
  requestId: ID,
  expectedRevision: z.int().nonnegative(),
  command: commandSchema,
});

const publishSchema = z.strictObject({
  manifestFileName: z.string().min(1).max(512),
  manifest: z.looseObject({
    main: z.literal('main.js'),
    supportsRealTime: z.literal(true),
    schema: z.looseObject({ properties: z.record(z.string(), z.unknown()).optional() }).optional(),
    customActions: z.array(z.looseObject({ id: z.string() })).optional(),
  }),
  mainJs: z.string().min(1),
  resources: z
    .array(
      z.strictObject({ path: z.string().min(1).max(512), data: z.string(), base64: z.boolean() }),
    )
    .max(1024),
});

type Command = z.infer<typeof commandSchema>;
type JournalEntry = { revision: number; command: Command };
type Publication = {
  id: string;
  manifestFileName: string;
  dataKeys: Set<string>;
  actionIds: Set<string>;
  files: Map<string, Buffer>;
  commands: JournalEntry[];
  receipts: Map<string, JournalEntry>;
  journalBytes: number;
  subscribers: Set<Response>;
};
type Session = { publication: Publication; token: string; canControl: boolean };

const defaults = {
  maxPublications: 8,
  maxPackageBytes: 32 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxSubscribers: 32,
  maxCommands: 512,
  maxJournalBytes: 512 * 1024,
};

class PlayoutError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly revision?: number,
  ) {
    super(message);
  }
}

function sendErrors(error: unknown, _request: Request, response: Response, next: NextFunction) {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof PlayoutError) {
    response.status(error.status).json({ error: error.message, revision: error.revision });
    return;
  }
  const status = (error as { status?: number } | null)?.status;
  const allowed = status === 413 || status === 415 || status === 400;
  response.status(allowed ? status : 500).json({
    error: allowed ? 'Invalid playout request body or path.' : 'Playout request failed.',
  });
}

function isPackagePath(path: string) {
  return (
    !/[\\%?#\p{Cc}]/u.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function encodePackagePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function playoutHeaders(_request: Request, response: Response, next: NextFunction) {
  response.set({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  next();
}

/** The listener exposes only published package bytes and token-scoped playout state. */
export function createSharedPlayoutHost(
  host: string,
  assets: Assets,
  limits: Partial<typeof defaults> = {},
) {
  const cap = { ...defaults, ...limits };
  const sessions = new Map<string, Session>();
  let totalBytes = 0;
  const app = express();
  app.disable('x-powered-by');
  app.enable('strict routing');
  const httpServer = createServer(app);

  const origin = () => {
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new PlayoutError(503, 'The shared playout listener is disabled.');
    return new URL(`http://${host.includes(':') ? `[${host}]` : host}:${address.port}`);
  };

  const session = (request: Request) => {
    const token = request.params.token;
    const result = typeof token === 'string' && sessions.get(token);
    if (!result) throw new PlayoutError(404, 'Unknown playout link.');
    return result;
  };

  const snapshot = ({ publication, token, canControl }: Session) => ({
    publicationId: publication.id,
    manifestUrl: new URL(
      `/s/${token}/package/${encodePackagePath(publication.manifestFileName)}`,
      origin(),
    ).href,
    canControl,
    revision: publication.commands.length,
    commands: publication.commands,
  });

  app.use(playoutHeaders);
  app.use((request, _response, next) => {
    if (request.get('host')?.toLowerCase() !== origin().host)
      throw new PlayoutError(400, 'Use the address in the playout link.');
    next();
  });

  app.get('/s/:token', (request, response) => {
    response.redirect(307, `/s/${session(request).token}/`);
  });
  app.get('/s/:token/', (request, response) => {
    session(request);
    response.type('html').send(assets.get('shared-playout.html'));
  });
  for (const name of ['shared-playout.js', 'ograf-player.js'] as const) {
    app.get(`/s/:token/${name}`, (request, response) => {
      session(request);
      response.type('js').send(assets.get(name));
    });
  }
  app.get('/s/:token/package/*path', (request, response) => {
    const { publication } = session(request);
    const path = Array.isArray(request.params.path)
      ? request.params.path.join('/')
      : request.params.path;
    if (typeof path !== 'string' || !isPackagePath(path))
      throw new PlayoutError(404, 'Package file not found.');
    const file = publication.files.get(path);
    if (!file) throw new PlayoutError(404, 'Package file not found.');
    response.type(extname(path) || 'application/octet-stream').send(file);
  });
  app.get('/s/:token/state', (request, response) => {
    response.json(snapshot(session(request)));
  });
  app.get('/s/:token/events', (request, response) => {
    const current = session(request);
    const subscribers = current.publication.subscribers;
    if (subscribers.size >= cap.maxSubscribers)
      throw new PlayoutError(503, 'Too many connected previews.');
    response.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
    const keepAlive = setInterval(() => {
      if (response.writableLength <= cap.maxJournalBytes) response.write(': keepalive\n\n');
      else response.destroy();
    }, 15_000);
    keepAlive.unref();
    response.on('close', () => {
      clearInterval(keepAlive);
      subscribers.delete(response);
    });
    subscribers.add(response);
    response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(current))}\n\n`);
  });

  app.post(
    '/s/:token/command',
    (request, _response, next) => {
      if (!session(request).canControl) throw new PlayoutError(403, 'This link is view-only.');
      const source = request.get('origin');
      if (source && source !== origin().origin)
        throw new PlayoutError(403, 'Invalid playout origin.');
      next();
    },
    express.json({ limit: MAX_PLAYOUT_REQUEST_BYTES }),
    (request, response) => {
      const { publication } = session(request);
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) throw new PlayoutError(400, 'Invalid playout command.');
      const { command, expectedRevision, requestId } = parsed.data;
      const revision = publication.commands.length;
      const previous = publication.receipts.get(requestId);
      if (previous) {
        if (JSON.stringify(previous.command) !== JSON.stringify(command))
          throw new PlayoutError(
            409,
            'This request ID was already used for a different command.',
            revision,
          );
        response.json({ revision: previous.revision });
        return;
      }
      if (expectedRevision !== revision)
        throw new PlayoutError(409, 'Playout revision changed.', revision);
      if (
        (command.kind === 'update' &&
          Object.keys(command.data).some((key) => !publication.dataKeys.has(key))) ||
        (command.kind === 'action' && !publication.actionIds.has(command.actionId))
      )
        throw new PlayoutError(400, 'The published graphic does not expose that field or action.');

      const entry = { revision: revision + 1, command };
      const serialized = JSON.stringify(entry);
      const bytes = Buffer.byteLength(serialized);
      if (revision >= cap.maxCommands || publication.journalBytes + bytes > cap.maxJournalBytes)
        throw new PlayoutError(
          409,
          'Playout journal is full. Publish a new session to continue.',
          revision,
        );

      publication.commands.push(entry);
      publication.receipts.set(requestId, entry);
      publication.journalBytes += bytes;
      for (const subscriber of publication.subscribers) {
        if (subscriber.writableLength > cap.maxJournalBytes) subscriber.destroy();
        else subscriber.write(`event: command\ndata: ${serialized}\n\n`);
      }
      response.json({ revision: entry.revision });
    },
  );
  app.use(sendErrors);

  function publish(input: unknown) {
    const base = origin();
    if (sessions.size / 2 >= cap.maxPublications)
      throw new PlayoutError(409, 'Shared playout publication limit reached.');
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success)
      throw new PlayoutError(400, 'Expected a published real-time OGraf package.');
    const { manifestFileName, manifest, mainJs, resources } = parsed.data;
    const originalManifest = (input as { manifest: unknown }).manifest;
    if (
      !manifestFileName.endsWith('.ograf.json') ||
      manifestFileName.includes('/') ||
      !mainJs.trim() ||
      !validateManifest(originalManifest).valid
    )
      throw new PlayoutError(400, 'Invalid OGraf manifest or entry point.');

    const files = new Map<string, Buffer>();
    let bytes = 0;
    const addFile = (path: string, data: string, base64 = false) => {
      if (!isPackagePath(path) || files.has(path))
        throw new PlayoutError(400, 'Package contains an unsafe or duplicate path.');
      const count = Buffer.byteLength(path) + Buffer.byteLength(data, base64 ? 'base64' : 'utf8');
      if (bytes + count > cap.maxPackageBytes || totalBytes + bytes + count > cap.maxTotalBytes)
        throw new PlayoutError(413, 'Shared playout package storage limit reached.');
      const buffer = Buffer.from(data, base64 ? 'base64' : 'utf8');
      if (base64 && buffer.toString('base64') !== data)
        throw new PlayoutError(400, 'Package contains invalid base64 data.');
      bytes += count;
      files.set(path, buffer);
    };
    // Match the existing ZIP export's manifest serialization and keep the published files intact.
    addFile(manifestFileName, JSON.stringify(originalManifest, null, 2));
    addFile('main.js', mainJs);
    for (const resource of resources) addFile(resource.path, resource.data, resource.base64);

    const publication: Publication = {
      id: randomUUID(),
      manifestFileName,
      dataKeys: new Set(Object.keys(manifest.schema?.properties ?? {})),
      actionIds: new Set(manifest.customActions?.map(({ id }) => id)),
      files,
      commands: [],
      receipts: new Map(),
      journalBytes: 0,
      subscribers: new Set(),
    };
    const viewer = randomBytes(24).toString('base64url');
    const operator = randomBytes(24).toString('base64url');
    sessions.set(viewer, { publication, token: viewer, canControl: false });
    sessions.set(operator, { publication, token: operator, canControl: true });
    totalBytes += bytes;
    return {
      publicationId: publication.id,
      viewerUrl: new URL(`/s/${viewer}/`, base).href,
      operatorUrl: new URL(`/s/${operator}/`, base).href,
    };
  }

  function disconnectClients() {
    for (const { publication } of sessions.values())
      for (const response of publication.subscribers) response.destroy();
  }

  return { httpServer, publish, disconnectClients, origin };
}

export type SharedPlayoutHost = ReturnType<typeof createSharedPlayoutHost>;

/** Install on the loopback authoring host only. */
export function installSharedPlayoutPublishing(app: Express, host?: SharedPlayoutHost): void {
  const router = express.Router();
  router.use(playoutHeaders);
  router.get('/status', (_request, response) =>
    response.json({ enabled: Boolean(host?.httpServer.listening) }),
  );
  router.post(
    '/publish',
    (request, _response, next) => {
      if (!host?.httpServer.listening) throw new PlayoutError(503, 'Shared playout is disabled.');
      const origin = request.get('origin');
      if (origin && origin !== `http://${request.get('host')}`)
        throw new PlayoutError(403, 'Invalid authoring origin.');
      next();
    },
    express.json({ limit: MAX_PUBLISH_BODY_BYTES }),
    (request, response) => {
      response.status(201).json(host!.publish(request.body));
    },
  );
  router.use(sendErrors);
  app.use('/api/shared-playout', router);
}
