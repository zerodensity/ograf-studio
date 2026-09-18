import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectedStandaloneTargets } from './standaloneTargets.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildScript = resolve(repositoryRoot, 'scripts/buildStandalone.mjs');
const targets = selectedStandaloneTargets();

for (const build of targets) {
  console.log(`Building ${build.target}...`);
  const child = Bun.spawn([process.execPath, 'run', buildScript], {
    cwd: repositoryRoot,
    env: {
      ...Bun.env,
      OGRAF_STANDALONE_TARGET: build.target,
      OGRAF_STANDALONE_OUTFILE: `release/${build.file}`,
    },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${build.target} build failed with exit code ${exitCode}.`);
}
