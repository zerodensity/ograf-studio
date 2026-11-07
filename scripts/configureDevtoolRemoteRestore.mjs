import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const original = JSON.parse(
  await readFile(
    new URL('./integrations/ograf-devtool/remoteRestore.upstream.json', import.meta.url),
    'utf8',
  ),
);
const patched = {
  query: original.query
    .replace(
      'RemoteUrlQuerySync({ graphicsSource })',
      'RemoteUrlQuerySync({ graphicsSource, graphicsList })',
    )
    .replace(
      'remoteHandler.baseUrl ?? remoteHandler.url',
      'shareableRemoteGraphicUrl(remoteHandler, graphicsList, location.pathname)',
    )
    .replace(
      "// Prefer baseUrl (a normalized, shareable form), but fall back to the originally entered url\n\t\t// (e.g. an OGraf server, which doesn't have a single shared resource base):",
      '// Preserve the manifest; its resource folder may not support discovery.',
    )
    .replace(
      'search: `?${params.toString()}`',
      'search: `?${params.toString()}`, hash: location.hash',
    )
    .replace(
      '[graphicsSource, location.pathname, location.search, navigate]',
      '[graphicsSource, graphicsList, location.pathname, location.search, location.hash, navigate]',
    ),
  discovery: original.discovery.replace(
    '\t\treturn this.discoverGenericFileServer(url)',
    '\t\tconst linkedManifest = remoteManifestFromGraphicRoute(url, window.location.pathname)\n\t\tif (linkedManifest) return this.discover(linkedManifest, onProgress, options)\n\t\treturn this.discoverGenericFileServer(url)',
  ),
};
function patch(source, key, importLine) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let result = source.replaceAll('\r\n', '\n');
  if (!result.includes(patched[key])) {
    if (result.split(original[key]).length !== 2)
      throw new Error('Devtool remote restore source changed; review before applying.');
    result = result.replace(original[key], patched[key]);
  }
  if (!result.includes(importLine)) result = importLine + '\n' + result;
  return result.replaceAll('\n', newline);
}
export function patchDevtoolRemoteQuery(source) {
  let result = patch(
    source,
    'query',
    "import { shareableRemoteGraphicUrl } from './lib/remoteGraphicLocation.js'",
  );
  const before = '<RemoteUrlQuerySync graphicsSource={graphicsSource} />';
  const after =
    '<RemoteUrlQuerySync graphicsSource={graphicsSource} graphicsList={graphicsList} />';
  if (result.includes(after)) return result;
  if (result.split(before).length !== 2)
    throw new Error('Devtool remote query component changed; review before applying.');
  return result.replace(before, after);
}
export const patchDevtoolRemoteDiscovery = (source) =>
  patch(
    source,
    'discovery',
    "import { remoteManifestFromGraphicRoute } from './lib/remoteGraphicLocation.js'",
  );

async function main() {
  const args = process.argv.slice(2),
    index = args.indexOf('--devtool');
  if (index < 0 || !args[index + 1])
    throw new Error('Usage: node scripts/configureDevtoolRemoteRestore.mjs --devtool <checkout>');
  const root = resolve(args[index + 1]);
  if (JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name !== 'ograf-devtool')
    throw new Error('Target is not an OGraf Devtool checkout.');
  const helper = await readFile(
    new URL('./integrations/ograf-devtool/remoteGraphicLocation.js', import.meta.url),
    'utf8',
  );
  const helperPath = join(root, 'client/src/lib/remoteGraphicLocation.js');
  const updates = [];
  for (const [file, transform] of [
    ['client/src/App.jsx', patchDevtoolRemoteQuery],
    ['client/src/RemoteHandler.js', patchDevtoolRemoteDiscovery],
  ]) {
    const path = join(root, file),
      before = await readFile(path, 'utf8');
    updates.push({ path, before, after: transform(before) });
  }
  try {
    if ((await readFile(helperPath, 'utf8')) !== helper)
      throw new Error('Existing Devtool remote restore helper differs; review before updating.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const backups = join(root, '.ograf-studio-integration-backups');
  const changedPaths = [];
  for (const { path, before, after } of updates) {
    if (before === after) continue;
    await mkdir(backups, { recursive: true });
    const hash = createHash('sha256').update(before).digest('hex').slice(0, 16);
    const backup = join(backups, `remote-restore-${path.split(/[\\/]/).at(-1)}-${hash}`);
    try {
      await access(backup);
    } catch {
      await writeFile(backup, before, { flag: 'wx' });
    }
    await writeFile(path, after);
    changedPaths.push(path);
  }
  await writeFile(helperPath, helper);
  console.log(
    JSON.stringify({ checkout: root, changedPaths, helperPath, rebuildClient: true }, null, 2),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
