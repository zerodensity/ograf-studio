/**
 * Builds the catalog the project explorer reads, and each example's pictures.
 *
 *   tsx scripts/buildExampleCatalog.ts <folder>             every example; render what changed
 *   tsx scripts/buildExampleCatalog.ts <folder> rain snow   render these again, whatever changed
 *
 * The folder holds one sub-folder per example, named by the example's ID:
 *
 *   <folder>/featured.json         optional: example IDs to show first, in order
 *   <folder>/<id>/example.json     written by hand: title, summary, category, level, tags, ...
 *   <folder>/<id>/<name>.ogs       the Studio document, exactly one
 *
 * and the script adds, per example, `thumbnail.webp`, `preview.mp4` (played in the explorer while
 * the pointer rests on the card), `preview.gif` (for a README) and `.preview.json` (what those were
 * rendered from), plus `<folder>/catalog.json`.
 *
 * The recipe cards get their pictures from a running Studio dev server, which builds each recipe:
 *
 *   tsx scripts/buildExampleCatalog.ts --recipes http://localhost:5173 apps/editor/public/explorer/recipes
 *
 * Rendering plays the exported graphic in headless Chrome and encodes with ffmpeg. Set CHROME_PATH
 * or FFMPEG_PATH when they are not in their usual place.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { format, resolveConfig } from 'prettier';
import { buildExportArtifactsWithRuntime, compileDataSchema } from '@ograf-editor/codegen';
import type { Project } from '@ograf-editor/scene-model';
import {
  EXAMPLE_LEVELS,
  parseExampleCatalog,
  type ExampleLicense,
} from '../apps/editor/src/explorer/exampleCatalog';
import { RECIPES } from '../apps/editor/src/explorer/explorerItems';
import {
  openProjectSetArchive,
  resolveProjectSetTemplate,
} from '../apps/editor/src/state/projectSet';
import { parseProjectSource } from '../apps/editor/src/state/studioDocument';

const run = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Bump when the pictures would come out differently, so every example renders again. */
const RENDERER_VERSION = 1;
const FRAME = { width: 960, height: 540 };
const MAX_PREVIEW_SECONDS = 12;

type PreviewAction = { at: number } & (
  | { do: 'play' }
  | { do: 'stop' }
  | { do: 'update'; data: Record<string, unknown> }
  | { do: 'action'; id: string; payload?: unknown }
);
interface PreviewSpec {
  seconds: number;
  actions: PreviewAction[];
  /** The moment the still picture shows, in seconds. */
  thumbnailAt: number;
}

interface ExampleMetadata {
  title: string;
  summary: string;
  category: string;
  level: string;
  tags: string[];
  author: string;
  license?: ExampleLicense;
  credits?: string;
  page?: string;
  unlisted?: boolean;
  released?: string;
  updated?: string;
  preview?: Partial<PreviewSpec>;
}

function fail(message: string): never {
  throw new Error(message);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    fail(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function readMetadata(value: unknown, path: string): ExampleMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${path} must be an object.`);
  const data = value as Record<string, unknown>;
  for (const key of ['title', 'summary', 'category', 'level', 'author'])
    if (typeof data[key] !== 'string' || !data[key]) fail(`${path}: "${key}" is required text.`);
  if (!EXAMPLE_LEVELS.includes(data.level as (typeof EXAMPLE_LEVELS)[number]))
    fail(`${path}: "level" must be one of ${EXAMPLE_LEVELS.join(', ')}.`);
  if (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string'))
    fail(`${path}: "tags" must be a list of text.`);
  const known = new Set([
    'title',
    'summary',
    'category',
    'level',
    'tags',
    'author',
    'license',
    'credits',
    'page',
    'unlisted',
    'released',
    'updated',
    'preview',
  ]);
  for (const key of Object.keys(data)) if (!known.has(key)) fail(`${path}: unknown key "${key}".`);
  return data as unknown as ExampleMetadata;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

interface ExampleDocument {
  /** The template the pictures show: the only one, or the set's active one. */
  project: Project;
  templates: number;
  fields: number;
  documentVersion: number;
}

function fieldCount(project: Project): number {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId)!;
  return Object.keys(compileDataSchema(composition).properties ?? {}).length;
}

function storedDocumentVersion(text: string, path: string): number {
  const version = (JSON.parse(text) as { documentVersion?: unknown }).documentVersion;
  if (!Number.isSafeInteger(version)) fail(`${path} has no document version.`);
  return version as number;
}

/** Read the document as Studio does, and the version it was saved with, which Studio migrates away. */
async function readDocument(bytes: Uint8Array, path: string): Promise<ExampleDocument> {
  if (!isZip(bytes)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const project = parseProjectSource(text);
    return {
      project,
      templates: 1,
      fields: fieldCount(project),
      documentVersion: storedDocumentVersion(text, path),
    };
  }
  const set = await openProjectSetArchive(bytes);
  if (!set.templates.length) fail(`${path} is a template set without templates.`);
  const shown = set.templates.find((item) => item.id === set.activeTemplateId) ?? set.templates[0]!;
  const zip = await JSZip.loadAsync(bytes);
  const versions = await Promise.all(
    Object.values(zip.files)
      .filter((file) => !file.dir && file.name.startsWith('templates/'))
      .map(async (file) =>
        storedDocumentVersion(await file.async('string'), `${path}:${file.name}`),
      ),
  );
  return {
    project: resolveProjectSetTemplate(set, shown.id),
    templates: set.templates.length,
    fields: set.templates.reduce(
      (sum, template) => sum + fieldCount(resolveProjectSetTemplate(set, template.id)),
      0,
    ),
    documentVersion: Math.max(...versions),
  };
}

/** First and last commit dates of the document; a file not yet committed counts as changed today. */
async function gitDates(
  folder: string,
  file: string,
): Promise<{ released: string; updated: string }> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { stdout } = await run('git', ['log', '--follow', '--format=%cs', '--', file], {
      cwd: folder,
    });
    const dates = stdout.split('\n').filter(Boolean);
    const { stdout: dirty } = await run('git', ['status', '--porcelain', '--', file], {
      cwd: folder,
    });
    if (dates.length) return { released: dates.at(-1)!, updated: dirty.trim() ? today : dates[0]! };
  } catch {
    // Not a git checkout: fall through to today's date.
  }
  return { released: today, updated: today };
}

function defaultPreview(stepCount: number): PreviewSpec {
  const actions: PreviewAction[] = [];
  let at = 0.4;
  for (let step = 0; step < Math.max(1, stepCount); step++) {
    actions.push({ at, do: 'play' });
    at += step === 0 ? 2.4 : 1.6;
  }
  actions.push({ at, do: 'stop' });
  return { seconds: Math.min(MAX_PREVIEW_SECONDS, at + 1.6), actions, thumbnailAt: at - 0.1 };
}

// --- Rendering -------------------------------------------------------------------------------

function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return (
    candidates.find((path) => path && existsSync(path)) ??
    fail('Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable.')
  );
}

const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

function hostPage(manifestFile: string, stageWidth: number): string {
  return `<!doctype html><meta charset="utf-8"><title>Example preview</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden;
    background: repeating-conic-gradient(#1b1e24 0% 25%, #22262d 0% 50%) 0 0 / 40px 40px; }
  #stage { position: absolute; left: 50%; top: 50%; width: ${stageWidth}px;
    transform: translate(-50%, -50%); }
</style>
<div id="stage"></div>
<script type="module">
  import { mountOGrafGraphic } from '/ograf-player.js';
  window.previewErrors = [];
  window.previewReady = mountOGrafGraphic({
    container: document.querySelector('#stage'),
    manifestUrl: '/graphic/${encodeURIComponent(manifestFile)}',
    onEvent: (event) => {
      if (event.type === 'error') window.previewErrors.push(String(event.error?.message ?? event.error));
    },
  }).then((player) => {
    window.previewPlayer = player;
    return player.manifest.stepCount ?? 1;
  });
</script>`;
}

async function serve(root: string, page: string): Promise<{ server: Server; origin: string }> {
  const player = await readFile(join(repoRoot, 'packages/ograf-web-player/ograf-player.js'));
  const server = createServer((request, response) => {
    void (async () => {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (path === '/') return response.writeHead(200, { 'content-type': MIME['.html'] }).end(page);
      if (path === '/ograf-player.js')
        return response.writeHead(200, { 'content-type': MIME['.js'] }).end(player);
      const file = resolve(root, `.${path.replace(/^\/graphic/, '')}`);
      if (!path.startsWith('/graphic/') || !file.startsWith(root + sep))
        return response.writeHead(404).end();
      try {
        const body = await readFile(file);
        response
          .writeHead(200, {
            'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          })
          .end(body);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') fail('The preview server did not start.');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** The few Chrome DevTools Protocol calls the renderer needs, over Node's own WebSocket. */
class Chrome {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void }
  >();
  private readonly listeners = new Map<string, (params: any) => void>();
  private constructor(
    private readonly socket: WebSocket,
    private readonly process: ChildProcess,
    private readonly profile: string,
  ) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const waiting = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiting?.reject(new Error(message.error.message));
        else waiting?.resolve(message.result);
      } else this.listeners.get(message.method)?.(message.params);
    });
  }

  static async launch(): Promise<Chrome> {
    const profile = await mkdtemp(join(tmpdir(), 'ograf-preview-chrome-'));
    const child = spawn(
      chromePath(),
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--ignore-gpu-blocklist',
        `--window-size=${FRAME.width},${FRAME.height}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const portFile = join(profile, 'DevToolsActivePort');
    let endpoint: string | undefined;
    for (let attempt = 0; attempt < 100 && !endpoint; attempt++) {
      await new Promise((done) => setTimeout(done, 100));
      const lines = existsSync(portFile) ? (await readFile(portFile, 'utf8')).split('\n') : [];
      if (lines.length >= 2 && lines[1]) endpoint = `ws://127.0.0.1:${lines[0]}${lines[1]}`;
    }
    if (!endpoint) {
      child.kill();
      fail('Chrome did not start its debugging port within 10 seconds.');
    }
    const socket = new WebSocket(endpoint);
    await new Promise<void>((done, failed) => {
      socket.addEventListener('open', () => done());
      socket.addEventListener('error', () => failed(new Error('Could not connect to Chrome.')));
    });
    return new Chrome(socket, child, profile);
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method: string, listener: (params: any) => void): void {
    this.listeners.set(method, listener);
  }

  async close(): Promise<void> {
    await this.send('Browser.close').catch(() => undefined);
    this.socket.close();
    await new Promise<void>((done) => {
      if (this.process.exitCode !== null) done();
      else this.process.once('exit', () => done());
      setTimeout(() => {
        this.process.kill();
        done();
      }, 3000);
    });
    await rm(this.profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}

async function encode(folder: string, args: string[]): Promise<void> {
  try {
    await run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd: folder });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    fail(
      reason.includes('ENOENT')
        ? 'ffmpeg was not found. Install it, or set FFMPEG_PATH to its executable.'
        : `ffmpeg failed: ${reason}`,
    );
  }
}

/** Play the example once in Chrome and write its thumbnail, hover video and GIF into `out`. */
async function renderPreview(
  chrome: Chrome,
  project: Project,
  requested: Partial<PreviewSpec> | undefined,
  out: string,
): Promise<PreviewSpec> {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId)!;
  const runtime = await readFile(
    join(repoRoot, 'packages/ograf-runtime/dist/graphic-runtime.js'),
    'utf8',
  ).catch(() =>
    fail('Build the runtime first: npm run build --workspace @ograf-editor/ograf-runtime'),
  );
  const artifacts = buildExportArtifactsWithRuntime(project, composition, runtime);
  if (!artifacts.valid) fail(`The example does not export: ${artifacts.errors.join('; ')}`);

  const work = await mkdtemp(join(tmpdir(), 'ograf-preview-'));
  const graphic = join(work, 'graphic');
  const write = async (path: string, data: string | Uint8Array) => {
    const target = resolve(graphic, path);
    if (!target.startsWith(graphic + sep))
      fail(`The export names a file outside its package: ${path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  };
  await write(artifacts.manifestFileName, JSON.stringify(artifacts.manifest));
  await write(artifacts.manifest.main, artifacts.mainJs);
  for (const resource of artifacts.resources)
    await write(
      resource.path,
      resource.base64 ? Buffer.from(resource.data, 'base64') : resource.data,
    );

  const stageWidth = Math.round(
    Math.min(FRAME.width, (FRAME.height * composition.width) / composition.height),
  );
  const { server, origin } = await serve(graphic, hostPage(artifacts.manifestFileName, stageWidth));
  let sessionId: string | undefined;
  let targetId: string | undefined;
  try {
    ({ targetId } = await chrome.send('Target.createTarget', {
      url: 'about:blank',
      newWindow: true,
    }));
    ({ sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true }));
    const page = (method: string, params: object = {}) => chrome.send(method, params, sessionId);
    const evaluate = async (expression: string) => {
      const { result, exceptionDetails } = await page('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails)
        fail(
          exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'The page failed.',
        );
      return result.value;
    };
    await page('Page.enable');
    // Chrome only sends frames of a page that is in front.
    await page('Page.bringToFront');
    await page('Emulation.setDeviceMetricsOverride', {
      ...FRAME,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page('Page.navigate', { url: `${origin}/` });
    let stepCount = 1;
    for (let attempt = 0; ; attempt++) {
      // The page's module has not run until `previewReady` exists.
      const ready = await evaluate('typeof window.previewReady');
      if (ready === 'object') {
        stepCount = await evaluate('window.previewReady');
        break;
      }
      if (attempt > 100) fail('The preview page did not load within 10 seconds.');
      await new Promise((done) => setTimeout(done, 100));
    }
    const base = defaultPreview(stepCount);
    const spec: PreviewSpec = {
      seconds: Math.min(MAX_PREVIEW_SECONDS, requested?.seconds ?? base.seconds),
      actions: requested?.actions ?? base.actions,
      thumbnailAt: requested?.thumbnailAt ?? (requested?.actions ? 0 : base.thumbnailAt),
    };
    if (requested?.actions && requested.thumbnailAt === undefined) {
      const stop = spec.actions.find((action) => action.do === 'stop');
      spec.thumbnailAt = (stop?.at ?? spec.seconds) - 0.1;
    }

    const frames: { at: number; file: string }[] = [];
    const writes: Promise<void>[] = [];
    chrome.on('Page.screencastFrame', (frame) => {
      const file = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
      frames.push({ at: frame.metadata.timestamp, file });
      writes.push(writeFile(join(work, file), Buffer.from(frame.data, 'base64')));
      void page('Page.screencastFrameAck', { sessionId: frame.sessionId });
    });
    await new Promise((done) => setTimeout(done, 300));
    await page('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    const started = Date.now();
    for (const action of spec.actions.toSorted((a, b) => a.at - b.at)) {
      await new Promise((done) =>
        setTimeout(done, Math.max(0, action.at * 1000 - (Date.now() - started))),
      );
      const call =
        action.do === 'play'
          ? 'play()'
          : action.do === 'stop'
            ? 'stop()'
            : action.do === 'update'
              ? `update(${JSON.stringify(action.data)})`
              : `action(${JSON.stringify(action.id)}, ${JSON.stringify(action.payload ?? {})})`;
      await evaluate(
        `void window.previewPlayer.${call}.catch((error) => window.previewErrors.push(String(error?.message ?? error)))`,
      );
    }
    await new Promise((done) =>
      setTimeout(done, Math.max(0, spec.seconds * 1000 - (Date.now() - started))),
    );
    await page('Page.stopScreencast');
    await Promise.all(writes);
    const errors: string[] = await evaluate('window.previewErrors');
    if (errors.length) fail(`The graphic reported: ${errors.join('; ')}`);
    // One frame is a graphic that stands still, which is a valid picture of it.
    if (!frames.length) fail('Chrome sent no frames; the page never drew.');

    // Chrome sends a frame only when the picture changes, so each one is held until the next.
    const first = frames[0]!.at;
    const list = frames
      .map((frame, index) => {
        const until = frames[index + 1]?.at ?? first + spec.seconds;
        return `file '${frame.file}'\nduration ${Math.max(0.001, until - frame.at).toFixed(4)}`;
      })
      .join('\n');
    await writeFile(join(work, 'frames.txt'), `${list}\nfile '${frames.at(-1)!.file}'\n`);
    const still =
      frames.findLast((frame) => frame.at - first <= spec.thumbnailAt) ?? frames.at(-1)!;
    const input = ['-f', 'concat', '-safe', '0', '-i', 'frames.txt'];
    await encode(work, [
      ...input,
      '-vf',
      'fps=25,scale=640:360:flags=lanczos',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '27',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      join(out, 'preview.mp4'),
    ]);
    await encode(work, [
      ...input,
      '-vf',
      'fps=12,scale=480:270:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
      '-loop',
      '0',
      join(out, 'preview.gif'),
    ]);
    await encode(work, [
      '-i',
      still.file,
      '-vf',
      'scale=640:360:flags=lanczos',
      '-c:v',
      'libwebp',
      '-quality',
      '84',
      join(out, 'thumbnail.webp'),
    ]);
    return spec;
  } finally {
    if (targetId) await chrome.send('Target.closeTarget', { targetId }).catch(() => undefined);
    server.close();
    await rm(work, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}

// --- Catalog ---------------------------------------------------------------------------------

/**
 * Ask a running Studio dev server to build each recipe in a fresh document, exactly as the
 * explorer does, then render it like an example. Writes `<recipe-id>.webp` and `<recipe-id>.mp4`.
 */
async function renderRecipes(studioUrl: string | undefined, outArgument: string | undefined) {
  if (!studioUrl || !outArgument)
    fail('Usage: tsx scripts/buildExampleCatalog.ts --recipes <studio-dev-url> <output-folder>');
  const out = resolve(outArgument);
  await mkdir(out, { recursive: true });
  const origin = new URL(studioUrl).origin;
  const chrome = await Chrome.launch();
  try {
    for (const recipe of RECIPES) {
      process.stdout.write(`Rendering ${recipe.id}… `);
      const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
      const page = (method: string, params: object = {}) => chrome.send(method, params, sessionId);
      // A saved document would be restored instead of the fresh one a recipe is built in.
      await page('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
      await page('Page.enable');
      await page('Page.navigate', { url: studioUrl });
      let source: string | undefined;
      for (let attempt = 0; attempt < 150 && source === undefined; attempt++) {
        await new Promise((done) => setTimeout(done, 200));
        const { result, exceptionDetails } = await page('Runtime.evaluate', {
          awaitPromise: true,
          returnByValue: true,
          expression: `(async () => {
            if (!document.querySelector('.project-explorer')) return null;
            const { useProjectStore } = await import('/src/state/projectStore.ts');
            useProjectStore.getState().${recipe.method}();
            return JSON.stringify(useProjectStore.getState().project);
          })()`,
        });
        if (exceptionDetails)
          fail(
            `${studioUrl} is not a Studio dev server: ${
              exceptionDetails.exception?.description ?? exceptionDetails.text
            }`,
          );
        if (typeof result.value === 'string') source = result.value;
      }
      await chrome.send('Target.closeTarget', { targetId });
      if (source === undefined) fail(`Studio at ${studioUrl} did not open its start window.`);
      const work = await mkdtemp(join(tmpdir(), 'ograf-recipe-'));
      try {
        await renderPreview(chrome, parseProjectSource(source), undefined, work);
        await copyFile(join(work, 'thumbnail.webp'), join(out, `${recipe.id}.webp`));
        await copyFile(join(work, 'preview.mp4'), join(out, `${recipe.id}.mp4`));
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      console.log('done');
    }
  } finally {
    await chrome.close();
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === '--recipes') return renderRecipes(process.argv[3], process.argv[4]);
  const [folderArgument, ...again] = process.argv.slice(2);
  if (!folderArgument) fail('Usage: tsx scripts/buildExampleCatalog.ts <folder> [example-id ...]');
  const folder = resolve(folderArgument);
  const ids = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, 'example.json')))
    .map((entry) => entry.name)
    .toSorted();
  for (const id of again) if (!ids.includes(id)) fail(`No example "${id}" in ${folder}.`);

  let chrome: Chrome | undefined;
  const examples: Record<string, unknown>[] = [];
  try {
    for (const id of ids) {
      const home = join(folder, id);
      const metadata = readMetadata(
        await readJson(join(home, 'example.json')),
        `${id}/example.json`,
      );
      const documents = (await readdir(home)).filter((name) => name.toLowerCase().endsWith('.ogs'));
      if (documents.length !== 1)
        fail(`${id} must hold exactly one .ogs document; it holds ${documents.length}.`);
      const file = documents[0]!;
      const bytes = new Uint8Array(await readFile(join(home, file)));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const document = await readDocument(bytes, `${id}/${file}`);
      const composition = document.project.compositions.find(
        (item) => item.id === document.project.mainCompositionId,
      )!;

      const stamp = join(home, '.preview.json');
      // Written the way the repo formats JSON, so the format check leaves it alone.
      const renderedFrom = `${JSON.stringify(
        { renderer: RENDERER_VERSION, sha256, preview: metadata.preview ?? null },
        null,
        2,
      )}
`;
      const outputs = ['thumbnail.webp', 'preview.mp4', 'preview.gif'].map((name) =>
        join(home, name),
      );
      const current =
        !again.includes(id) &&
        outputs.every(existsSync) &&
        existsSync(stamp) &&
        (await readFile(stamp, 'utf8')) === renderedFrom;
      if (!current) {
        process.stdout.write(`Rendering ${id}… `);
        chrome ??= await Chrome.launch();
        try {
          const spec = await renderPreview(chrome, document.project, metadata.preview, home);
          await writeFile(stamp, renderedFrom);
          const sizes = await Promise.all(outputs.map(async (path) => (await stat(path)).size));
          console.log(
            `${spec.seconds.toFixed(1)} s: thumbnail ${Math.round(sizes[0]! / 1000)} KB, ` +
              `video ${Math.round(sizes[1]! / 1000)} KB, GIF ${Math.round(sizes[2]! / 1000)} KB`,
          );
        } catch (cause) {
          console.log('failed');
          fail(`${id}: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }

      const dates = await gitDates(home, file);
      examples.push({
        id,
        title: metadata.title,
        summary: metadata.summary,
        category: metadata.category,
        level: metadata.level,
        tags: metadata.tags,
        author: metadata.author,
        ...(metadata.license === undefined ? {} : { license: metadata.license }),
        ...(metadata.credits === undefined ? {} : { credits: metadata.credits }),
        released: metadata.released ?? dates.released,
        updated: metadata.updated ?? dates.updated,
        ...(metadata.unlisted ? { unlisted: true } : {}),
        file: `${id}/${encodeURIComponent(file)}`,
        bytes: bytes.byteLength,
        sha256,
        thumbnail: `${id}/thumbnail.webp`,
        preview: `${id}/preview.mp4`,
        canvas: {
          width: composition.width,
          height: composition.height,
          frameRate: composition.frameRate,
        },
        templates: document.templates,
        fields: document.fields,
        documentVersion: document.documentVersion,
        ...(metadata.page ? { page: metadata.page } : {}),
      });
    }
  } finally {
    await chrome?.close();
  }

  const featuredPath = join(folder, 'featured.json');
  const featured = existsSync(featuredPath) ? await readJson(featuredPath) : [];
  const catalog = { version: 1, featured, examples };
  // Studio's own reader is the one definition of a valid catalog.
  parseExampleCatalog(catalog, 'https://catalog.invalid/catalog.json', 'online');
  // Formatted the way the repo formats JSON, so the format check leaves a rebuilt catalog alone.
  const catalogPath = join(folder, 'catalog.json');
  await writeFile(
    catalogPath,
    await format(JSON.stringify(catalog), {
      ...(await resolveConfig(catalogPath)),
      filepath: catalogPath,
    }),
  );
  const unlisted = examples.filter((example) => example.unlisted).length;
  console.log(
    `Wrote ${join(folder, 'catalog.json')}: ${examples.length} examples` +
      (unlisted ? `, ${unlisted} of them unlisted.` : '.'),
  );
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
