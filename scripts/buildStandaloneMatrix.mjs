import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildScript = resolve(repositoryRoot, 'scripts/buildStandalone.mjs');
const targets = [
  { target: 'bun-windows-x64-baseline', outfile: 'release/OGrafStudioServer.exe' },
  { target: 'bun-darwin-x64', outfile: 'release/OGrafStudioServer-macos-x64' },
  { target: 'bun-darwin-arm64', outfile: 'release/OGrafStudioServer-macos-arm64' },
  { target: 'bun-linux-x64', outfile: 'release/OGrafStudioServer-linux-x64' },
  { target: 'bun-linux-arm64', outfile: 'release/OGrafStudioServer-linux-arm64' },
];

for (const build of targets) {
  console.log(`Building ${build.target}...`);
  const child = Bun.spawn([process.execPath, 'run', buildScript], {
    cwd: repositoryRoot,
    env: {
      ...Bun.env,
      OGRAF_STANDALONE_TARGET: build.target,
      OGRAF_STANDALONE_OUTFILE: build.outfile,
    },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${build.target} build failed with exit code ${exitCode}.`);
}
