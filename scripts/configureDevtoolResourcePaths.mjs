import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPLACEMENTS = [
  [
    "\tconst prefix = window.location.href.includes('https') ? 'https://' : 'http://'",
    "\tconst prefix = window.location.protocol + '//'",
  ],
  [
    "\tconst basePath = `${window.location.href}`.replace(/^https?:\\/\\//, '').replace(/\\?.*/, '')",
    '\tconst basePath = window.location.host',
  ],
];

/** Change only the origin used for service-worker resource routes. */
export function patchDevtoolResourcePaths(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let updated = source.replaceAll('\r\n', '\n');
  for (const anchor of [
    'export function graphicResourcePath(...paths) {',
    'if (isAbsoluteUrl(raw)) return raw',
    'if (isAbsoluteUrl(decoded)) return decoded',
    "const marker = resourceSource === 'remote' ? 'REMOTE' : 'LOCAL'",
    'return prefix + pathJoin(basePath, marker, ...paths)',
  ]) {
    if (updated.split(anchor).length !== 2)
      throw new Error('Devtool graphicResourcePath has changed. Review before applying.');
  }
  const original = REPLACEMENTS.every(
    ([from, to]) => updated.split(from).length === 2 && !updated.includes(to),
  );
  const alreadyApplied = REPLACEMENTS.every(
    ([from, to]) => !updated.includes(from) && updated.split(to).length === 2,
  );
  if (!original && !alreadyApplied)
    throw new Error(
      'Devtool resource origin differs or is partially patched. Review before applying.',
    );
  if (original) for (const [from, to] of REPLACEMENTS) updated = updated.replace(from, to);
  return updated.replaceAll('\n', newline);
}

async function main() {
  const args = process.argv.slice(2);
  const targetIndex = args.indexOf('--devtool');
  if (targetIndex < 0 || !args[targetIndex + 1])
    throw new Error('Usage: node scripts/configureDevtoolResourcePaths.mjs --devtool <checkout>');
  const root = resolve(args[targetIndex + 1]);
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageJson.name !== 'ograf-devtool')
    throw new Error('Target is not an OGraf Devtool checkout.');
  const resourcePath = join(root, 'client/src/lib/lib.js');
  const original = await readFile(resourcePath, 'utf8');
  const updated = patchDevtoolResourcePaths(original);
  let backupPath = null;
  if (updated !== original) {
    const backupDirectory = join(root, '.ograf-studio-integration-backups');
    await mkdir(backupDirectory, { recursive: true });
    const hash = createHash('sha256').update(original).digest('hex').slice(0, 16);
    backupPath = join(backupDirectory, `lib-resource-paths-${hash}.js`);
    try {
      await access(backupPath);
    } catch {
      await writeFile(backupPath, original, { flag: 'wx' });
    }
    await writeFile(resourcePath, updated);
  }
  console.log(
    JSON.stringify(
      {
        checkout: root,
        resourcePath,
        backupPath,
        changed: updated !== original,
        rebuildClient: true,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
