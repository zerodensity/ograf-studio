import { readFile, writeFile, mkdir, access, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = '// OGraf Studio per-client remote source recovery';
const workerReplacements = [
  [
    "const SW_VERSION = '__BUILD_VERSION__' // Generated at build time",
    marker +
      "\nimport { requestRemoteClientConfig } from './lib/remoteClientConfig.js'\n\n" +
      "const SW_VERSION = '__BUILD_VERSION__' // Generated at build time",
  ],
  [
    "\t\t\tif (!remoteBaseUrl) {\n\t\t\t\tevent.respondWith(new Response(null, { status: 500, statusText: 'No remote base url has been set' }))\n\t\t\t\treturn\n\t\t\t}\n\t\t\tconst targetUrl = joinRemoteUrl(remoteBaseUrl, decodeURIComponent(m[2]))\n\t\t\tevent.respondWith(\n\t\t\t\tfetchAndFixup(targetUrl, {\n\t\t\t\t\tcache: 'no-store',\n\t\t\t\t\tmethod: event.request.method,\n\t\t\t\t\theaders: event.request.headers,\n\t\t\t\t})\n\t\t\t)",
    '\t\t\tevent.respondWith((async () => {\n' +
      '\t\t\t\tconst configuration = await requestRemoteClientConfig(self.clients, event.clientId)\n' +
      '\t\t\t\tconst baseUrl = configuration ? configuration.baseUrl : event.clientId ? null : remoteBaseUrl\n' +
      "\t\t\t\tif (!baseUrl) return new Response(null, { status: 500, statusText: 'No remote base url has been set' })\n" +
      '\t\t\t\tconst targetUrl = joinRemoteUrl(baseUrl, decodeURIComponent(m[2]))\n' +
      "\t\t\t\treturn fetchAndFixup(targetUrl, { cache: 'no-store', method: event.request.method, headers: event.request.headers })\n" +
      '\t\t\t})())',
  ],
  [
    '\t\tconst allowedOrigins = [',
    '\t\tevent.waitUntil(requestRemoteClientConfig(self.clients, event.clientId).then((configuration) => {\n\t\tconst allowedOrigins = [',
  ],
  [
    '\t\t\t...extraAllowedOrigins,',
    '\t\t\t...(configuration ? configuration.allowedOrigins : event.clientId ? [] : extraAllowedOrigins),',
  ],
  [
    "\t\t\t\ttype: 'fetch-from-outside',\n\t\t\t\turl: newUrl,\n\t\t\t})\n\t\t}\n\t}\n})",
    "\t\t\t\ttype: 'fetch-from-outside',\n\t\t\t\turl: newUrl,\n\t\t\t})\n\t\t}\n\t\t}))\n\t}\n})",
  ],
];

const pageReplacements = [
  [
    "import { SW_VERSION } from './lib/sw-version.js'",
    "import { SW_VERSION } from './lib/sw-version.js'\n" +
      marker +
      "\nimport { installRemoteClientConfigResponder } from './lib/remoteClientConfig.js'",
  ],
  [
    '\t\tthis.previousMessageReplyId = -1',
    '\t\tthis.previousMessageReplyId = -1\n' +
      '\t\tthis.remoteClientConfiguration = { baseUrl: null, allowedOrigins: new Set() }\n' +
      '\t\tinstallRemoteClientConfigResponder(navigator.serviceWorker, () => ({\n' +
      '\t\t\tbaseUrl: this.remoteClientConfiguration.baseUrl,\n' +
      '\t\t\tallowedOrigins: [...this.remoteClientConfiguration.allowedOrigins],\n' +
      '\t\t}))',
  ],
  [
    '\taddAllowedOrigin(origin) {',
    '\taddAllowedOrigin(origin) {\n\t\tthis.remoteClientConfiguration.allowedOrigins.add(origin)',
  ],
  [
    '\tsetRemoteBaseUrl(baseUrl) {',
    '\tsetRemoteBaseUrl(baseUrl) {\n\t\tthis.remoteClientConfiguration.baseUrl = baseUrl',
  ],
];

function patch(source, replacements) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let updated = source.replaceAll('\r\n', '\n');
  if (updated.includes(marker)) {
    if (!replacements.every(([, to]) => updated.split(to).length === 2))
      throw new Error(
        'Existing Devtool remote configuration integration differs; review before updating.',
      );
    return source;
  }
  for (const [from, to] of replacements) {
    if (updated.split(from).length !== 2)
      throw new Error('Devtool remote configuration source changed; review before applying.');
    updated = updated.replace(from, to);
  }
  return updated.replaceAll('\n', newline);
}

export function patchDevtoolWorkerConfig(source) {
  return patch(source, workerReplacements);
}

export function patchDevtoolPageConfig(source) {
  return patch(source, pageReplacements);
}

async function main() {
  const args = process.argv.slice(2);
  const targetIndex = args.indexOf('--devtool');
  if (targetIndex < 0 || !args[targetIndex + 1])
    throw new Error('Usage: node scripts/configureDevtoolRemoteConfig.mjs --devtool <checkout>');
  const root = resolve(args[targetIndex + 1]);
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageJson.name !== 'ograf-devtool')
    throw new Error('Target is not an OGraf Devtool checkout.');
  const targets = [
    ['client/src/service-worker.js', patchDevtoolWorkerConfig],
    ['client/src/ServiceWorkerHandler.js', patchDevtoolPageConfig],
  ];
  // Validate all upstream anchors before changing any tracked file.
  const updates = await Promise.all(
    targets.map(async ([file, apply]) => {
      const path = join(root, file);
      const original = await readFile(path, 'utf8');
      return { path, original, updated: apply(original) };
    }),
  );
  const backups = join(root, '.ograf-studio-integration-backups');
  await mkdir(backups, { recursive: true });
  for (const { path, original, updated } of updates) {
    if (updated === original) continue;
    const hash = createHash('sha256').update(original).digest('hex').slice(0, 16);
    const backup = join(
      backups,
      `${path.endsWith('service-worker.js') ? 'service-worker' : 'ServiceWorkerHandler'}-remote-config-${hash}.js`,
    );
    try {
      await access(backup);
    } catch {
      await writeFile(backup, original, { flag: 'wx' });
    }
    await writeFile(path, updated);
  }
  const helperPath = join(root, 'client/src/lib/remoteClientConfig.js');
  await copyFile(
    fileURLToPath(new URL('./integrations/ograf-devtool/remoteClientConfig.js', import.meta.url)),
    helperPath,
  );
  console.log(
    JSON.stringify(
      {
        checkout: root,
        changed: updates.filter((item) => item.updated !== item.original).map((item) => item.path),
        helperPath,
        rebuildClient: true,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
