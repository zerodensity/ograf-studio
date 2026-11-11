import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , binaryPath, archivePath] = process.argv;
if (!binaryPath)
  throw new Error('Usage: node scripts/verifyStandaloneSkill.mjs <binary> [archive]');
const binary = resolve(binaryPath);
const canonicalArchive =
  archivePath ??
  fileURLToPath(new URL('../skills/ograf-authoring/ograf-authoring.zip', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'ograf-standalone-skill-'));
const exportedArchive = join(directory, 'ograf-authoring.zip');
const run = (args) =>
  execFileSync(binary, args, {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });

try {
  run(['--export-skill', exportedArchive]);
  if (!(await readFile(exportedArchive)).equals(await readFile(canonicalArchive))) {
    throw new Error('The executable exported a skill ZIP that differs from the release archive.');
  }
  const prompt = run(['--print-setup-prompt', '--port', '4498']);
  for (const value of ['http://127.0.0.1:4498/mcp', '--export-skill', 'ograf_get_capabilities']) {
    if (!prompt.includes(value)) throw new Error(`The setup prompt is missing ${value}.`);
  }
  console.log('Standalone skill export and setup prompt verified.');
} finally {
  await rm(exportedArchive, { force: true });
  await rmdir(directory);
}
