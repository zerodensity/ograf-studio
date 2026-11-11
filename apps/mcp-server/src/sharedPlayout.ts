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
  'preview-controls.css',
  'preview-font.ttf',
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
          new URL(
            name === 'preview-controls.css'
              ? '../../editor/src/panels/PreviewExportPanel.css'
              : name === 'preview-font.ttf'
                ? '../../editor/src/assets/font-library/nunito.ttf'
                : `../../../packages/ograf-web-player/${name}`,
            import.meta.url,
          );
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
  z
    .strictObject({ kind: z.literal('play'), delta: z.int().optional(), goto: z.int().optional() })
    .refine(({ delta, goto }) => delta === undefined || goto === undefined),
  z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('update'), data: commandData }),
  z.strictObject({ kind: z.literal('action'), actionId: ID, payload: commandData.optional() }),
]);

const requestSchema = z.strictObject({
  publicationId: ID,
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
type Audience = 'viewer' | 'operator' | 'studio';
type Publication = {
  id: string;
  assetToken: string;
  manifestUrl: string;
  studioManifestUrl: string;
  bytes: number;
  dataKeys: Set<string>;
  actionIds: Set<string>;
  files: Map<string, Buffer>;
  commands: JournalEntry[];
  receipts: Map<string, JournalEntry>;
  journalBytes: number;
};

const defaults = {
  maxPublications: 8,
  maxPackageBytes: 32 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxSubscribers: 32,
  maxCommands: 512,
  maxJournalBytes: 512 * 1024,
};

const studioApiPath = '/api/shared-playout';

class PlayoutError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly revision?: number,
    readonly publicationId?: string | null,
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
    response.status(error.status).json({
      error: error.message,
      revision: error.revision,
      publicationId: error.publicationId,
    });
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
    !/[\\%?#\p{Cc}\p{Cs}]/u.test(path) &&
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

/** The listener serves one live preview and the immutable packages it references. */
export function createSharedPlayoutHost(
  host: string,
  assets: Assets,
  limits: Partial<typeof defaults> = {},
) {
  const cap = { ...defaults, ...limits };
  const packages = new Map<string, Publication>();
  const subscribers = new Map<Response, Audience>();
  const operatorToken = randomBytes(24).toString('base64url');
  const operatorPath = `/control/${operatorToken}/`;
  let current: Publication | null = null;
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

  const viewerEntryUrl = (): URL => new URL('/preview/', origin());
  const operatorEntryUrl = (): URL => new URL(operatorPath, origin());
  const snapshot = (audience: Audience) => ({
    publicationId: current?.id ?? null,
    manifestUrl:
      (audience === 'studio' ? current?.studioManifestUrl : current?.manifestUrl) ?? null,
    canControl: audience !== 'viewer',
    revision: current?.commands.length ?? 0,
    commands: current?.commands ?? [],
  });

  function requireOperator(request: Request, _response: Response, next: NextFunction) {
    if (request.params.token !== operatorToken)
      throw new PlayoutError(404, 'Unknown playout link.');
    next();
  }

  function writeToSubscriber(response: Response, message: string) {
    if (response.writableLength > cap.maxJournalBytes) response.destroy();
    else response.write(message);
  }

  function sendSnapshot(response: Response, audience: Audience) {
    writeToSubscriber(response, `event: snapshot\ndata: ${JSON.stringify(snapshot(audience))}\n\n`);
  }

  function subscribe(response: Response, audience: Audience) {
    if (subscribers.size >= cap.maxSubscribers)
      throw new PlayoutError(503, 'Too many connected previews.');
    response.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
    const keepAlive = setInterval(() => writeToSubscriber(response, ': keepalive\n\n'), 15_000);
    keepAlive.unref();
    response.on('close', () => {
      clearInterval(keepAlive);
      subscribers.delete(response);
    });
    subscribers.set(response, audience);
    sendSnapshot(response, audience);
  }

  app.use(playoutHeaders);
  app.use((request, _response, next) => {
    if (request.get('host')?.toLowerCase() !== origin().host)
      throw new PlayoutError(400, 'Use the address in the playout link.');
    next();
  });

  function mountView(path: string, audience: 'viewer' | 'operator') {
    const canControl = audience === 'operator';
    const authorize = canControl
      ? requireOperator
      : (_request: Request, _response: Response, next: NextFunction) => next();
    app.get(path, authorize, (_request, response) => {
      response.redirect(307, canControl ? operatorPath : '/preview/');
    });
    app.get(`${path}/`, authorize, (_request, response) => {
      response.type('html').send(assets.get('shared-playout.html'));
    });
    for (const name of SHARED_PLAYOUT_ASSET_FILES) {
      if (name === 'shared-playout.html') continue;
      app.get(`${path}/${name}`, authorize, (_request, response) => {
        response.type(extname(name)).send(assets.get(name));
      });
    }
    app.get(`${path}/state`, authorize, (_request, response) => {
      response.json(snapshot(audience));
    });
    app.get(`${path}/events`, authorize, (_request, response) => {
      subscribe(response, audience);
    });
  }
  mountView('/preview', 'viewer');
  mountView('/control/:token', 'operator');

  function servePackage(request: Request, response: Response) {
    const token = request.params.token;
    const publication = typeof token === 'string' && packages.get(token);
    const path = Array.isArray(request.params.path)
      ? request.params.path.join('/')
      : request.params.path;
    if (!publication || typeof path !== 'string' || !isPackagePath(path))
      throw new PlayoutError(404, 'Package file not found.');
    const file = publication.files.get(path);
    if (!file) throw new PlayoutError(404, 'Package file not found.');
    response.type(extname(path) || 'application/octet-stream').send(file);
  }
  app.get('/s/:token/package/*path', servePackage);
  app.post('/preview/command', () => {
    throw new PlayoutError(403, 'This link is view-only.');
  });

  app.post(
    '/control/:token/command',
    requireOperator,
    (request, _response, next) => {
      const source = request.get('origin');
      if (source && source !== origin().origin)
        throw new PlayoutError(403, 'Invalid playout origin.');
      next();
    },
    express.json({ limit: MAX_PLAYOUT_REQUEST_BYTES }),
    handleCommand,
  );
  app.use(sendErrors);

  function handleCommand(request: Request, response: Response) {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) throw new PlayoutError(400, 'Invalid playout command.');
    const { publicationId, command, expectedRevision, requestId } = parsed.data;
    const publication = current;
    if (!publication || publication.id !== publicationId)
      throw new PlayoutError(
        409,
        'The published graphic changed.',
        publication?.commands.length ?? 0,
        publication?.id ?? null,
      );
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
    const event = JSON.stringify({ publicationId, ...entry });
    for (const subscriber of subscribers.keys())
      writeToSubscriber(subscriber, `event: command\ndata: ${event}\n\n`);
    response.json({ revision: entry.revision });
  }

  function publish(input: unknown) {
    const base = origin();
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
      if (bytes + count > cap.maxPackageBytes || bytes + count > cap.maxTotalBytes)
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

    const links = { viewerUrl: viewerEntryUrl().href, operatorUrl: operatorEntryUrl().href };
    const previous = current;
    if (
      previous &&
      previous.bytes === bytes &&
      previous.files.size === files.size &&
      [...files].every(([path, data]) => previous.files.get(path)?.equals(data))
    )
      return { publicationId: previous.id, ...links };

    const assetToken = randomBytes(24).toString('base64url');
    const manifestPath = encodePackagePath(manifestFileName);
    const initial: JournalEntry = { revision: 1, command: { kind: 'play', delta: 1 } };
    const journalBytes = Buffer.byteLength(JSON.stringify(initial));
    if (cap.maxPublications < 1 || cap.maxCommands < 1 || journalBytes > cap.maxJournalBytes)
      throw new PlayoutError(409, 'Shared playout publication limit reached.');
    const publication: Publication = {
      id: randomUUID(),
      assetToken,
      manifestUrl: new URL(`/s/${assetToken}/package/${manifestPath}`, base).href,
      studioManifestUrl: `${studioApiPath}/packages/${assetToken}/${manifestPath}`,
      bytes,
      dataKeys: new Set(Object.keys(manifest.schema?.properties ?? {})),
      actionIds: new Set(manifest.customActions?.map(({ id }) => id)),
      files,
      commands: [initial],
      receipts: new Map(),
      journalBytes,
    };

    // Validate the replacement first. Retain as many recent packages as the cap allows
    // so clients switching snapshots can finish reading the previous assets.
    while (packages.size >= cap.maxPublications || totalBytes + bytes > cap.maxTotalBytes) {
      const oldest = packages.values().next().value!;
      packages.delete(oldest.assetToken);
      totalBytes -= oldest.bytes;
    }
    packages.set(assetToken, publication);
    totalBytes += bytes;
    current = publication;
    for (const [subscriber, audience] of subscribers) sendSnapshot(subscriber, audience);
    return { publicationId: publication.id, ...links };
  }

  function disconnectClients() {
    for (const response of subscribers.keys()) response.destroy();
  }

  return {
    httpServer,
    publish,
    disconnectClients,
    origin,
    viewerEntryUrl,
    operatorEntryUrl,
    readStudioState: () => snapshot('studio'),
    subscribeStudio: (response: Response) => subscribe(response, 'studio'),
    servePackage,
    handleCommand,
  };
}

export type SharedPlayoutHost = ReturnType<typeof createSharedPlayoutHost>;

/** Install on the loopback authoring host only. */
export function installSharedPlayoutPublishing(app: Express, host?: SharedPlayoutHost): void {
  const router = express.Router();
  router.use(playoutHeaders);
  router.use((request, _response, next) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? ''))
      throw new PlayoutError(403, 'Studio playout control requires a loopback connection.');
    next();
  });
  function activeHost(): SharedPlayoutHost {
    if (!host?.httpServer.listening) throw new PlayoutError(503, 'Shared playout is disabled.');
    return host;
  }
  function requireAuthoringOrigin(request: Request, _response: Response, next: NextFunction) {
    activeHost();
    const origin = request.get('origin');
    if (origin && origin !== `http://${request.get('host')}`)
      throw new PlayoutError(403, 'Invalid authoring origin.');
    next();
  }
  router.get('/status', (_request, response) => {
    if (!host?.httpServer.listening) return response.json({ enabled: false });
    response.json({
      enabled: true,
      viewerUrl: host.viewerEntryUrl().href,
      operatorUrl: host.operatorEntryUrl().href,
    });
  });
  router.get('/state', (_request, response) => {
    response.json(activeHost().readStudioState());
  });
  router.get('/events', (_request, response) => {
    activeHost().subscribeStudio(response);
  });
  router.get('/packages/:token/*path', (request, response) => {
    activeHost().servePackage(request, response);
  });
  router.post(
    '/command',
    requireAuthoringOrigin,
    express.json({ limit: MAX_PLAYOUT_REQUEST_BYTES }),
    (request, response) => {
      activeHost().handleCommand(request, response);
    },
  );
  router.post(
    '/publish',
    requireAuthoringOrigin,
    express.json({ limit: MAX_PUBLISH_BODY_BYTES }),
    (request, response) => {
      response.status(201).json(activeHost().publish(request.body));
    },
  );
  router.use(sendErrors);
  app.use(studioApiPath, router);
}
