import { readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { installSkillHook } from './installGitHooks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const skillPath = 'skills/ograf-authoring';
const archivePath = `${skillPath}/ograf-authoring.zip`;
const compatibilityArchivePath = `${skillPath}/ograf-authoring-skill.zip`;
const archivePaths = new Set([archivePath, compatibilityArchivePath]);
const prefix = 'ograf-authoring/';
const textExtensions = new Set([
  '.md',
  '.yaml',
  '.yml',
  '.json',
  '.js',
  '.mjs',
  '.ts',
  '.py',
  '.sh',
  '.txt',
]);
const normalize = (path, data) =>
  textExtensions.has(extname(path))
    ? Buffer.from(data.toString('utf8').replace(/\r\n?/g, '\n'))
    : data;
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });

async function workingSources(directory = resolve(root, skillPath)) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error('Skill resources must be regular files, not symlinks.');
    if (entry.isDirectory()) files.push(...(await workingSources(path)));
    else if (entry.isFile() && !archivePaths.has(relative(root, path).replaceAll('\\', '/'))) {
      const name = relative(resolve(root, skillPath), path).replaceAll('\\', '/');
      files.push({ name, data: normalize(name, await readFile(path)) });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function committedSources(revision) {
  const files = git('ls-tree', '-r', '--name-only', revision, '--', skillPath)
    .toString('utf8')
    .trim()
    .split('\n');
  return files
    .filter((path) => path && !archivePaths.has(path))
    .map((path) => ({
      name: path.slice(skillPath.length + 1),
      data: normalize(path, git('show', `${revision}:${path}`)),
    }));
}

async function assertMatches(files, bytes, label) {
  if (!files.some((file) => file.name === 'SKILL.md'))
    throw new Error(`${label}: SKILL.md is missing.`);
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  const expected = files.map((file) => prefix + file.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error(`${label}: skill ZIP file list is stale.`);
  for (const file of files) {
    const actual = await zip.file(prefix + file.name).async('nodebuffer');
    if (!actual.equals(file.data))
      throw new Error(`${label}: skill ZIP has stale content for ${file.name}.`);
  }
}

export async function packageAuthoringSkill() {
  installSkillHook();
  const files = await workingSources();
  const zip = new JSZip();
  for (const file of files)
    zip.file(prefix + file.name, file.data, {
      date: new Date('1980-01-01T00:00:00Z'),
      createFolders: false,
      unixPermissions: 0o100644,
    });
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  const previous = await readFile(resolve(root, archivePath)).catch(() => null);
  if (!previous?.equals(bytes)) await writeFile(resolve(root, archivePath), bytes);
  // Keep an existing distribution alias current without embedding an old ZIP inside the skill.
  const alias = await readFile(resolve(root, compatibilityArchivePath)).catch(() => null);
  if (alias && !alias.equals(bytes))
    await writeFile(resolve(root, compatibilityArchivePath), bytes);
  await assertMatches(files, bytes, 'Built archive');
  console.log(
    `Authoring skill ZIP current: ${files.length} files, SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}

async function main() {
  if (process.argv.includes('--check-push')) {
    const updates = readFileSync(0, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    for (const line of updates) {
      const sha = line.split(/\s+/)[1];
      if (!sha || /^0+$/.test(sha)) continue;
      const revision = git('rev-parse', `${sha}^{commit}`).toString('utf8').trim();
      await assertMatches(
        committedSources(revision),
        git('show', `${revision}:${archivePath}`),
        `Push ${revision.slice(0, 12)}`,
      );
      if (
        git('ls-tree', '-r', '--name-only', revision, '--', compatibilityArchivePath)
          .toString('utf8')
          .trim()
      )
        await assertMatches(
          committedSources(revision),
          git('show', `${revision}:${compatibilityArchivePath}`),
          `Push compatibility archive ${revision.slice(0, 12)}`,
        );
    }
    console.log('Authoring skill ZIP matches the committed sources being pushed.');
  } else if (process.argv.includes('--check')) {
    const canonical = await readFile(resolve(root, archivePath));
    await assertMatches(await workingSources(), canonical, 'Working tree');
    const alias = await readFile(resolve(root, compatibilityArchivePath)).catch(() => null);
    if (alias && !alias.equals(canonical)) throw new Error('Compatibility skill ZIP is stale.');
    console.log('Authoring skill ZIP matches every current skill source file.');
  } else await packageAuthoringSkill();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(
      `${error.message}\nRun npm run skill:package, then commit the updated skill ZIP before building or pushing.`,
    );
    process.exitCode = 1;
  });
