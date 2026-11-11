import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageAuthoringSkill } from './packageAuthoringSkill.mjs';
import { verifyBundledStudioPluginDistribution } from './buildBundledStudioPlugins.mjs';

await packageAuthoringSkill();

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const standaloneEntrypoint = resolve(repositoryRoot, 'apps/mcp-server/src/standalone.ts');
const editorRoot = resolve(repositoryRoot, 'apps/editor/dist');
await verifyBundledStudioPluginDistribution(editorRoot);
const runtimeFile = resolve(repositoryRoot, 'packages/ograf-runtime/dist/graphic-runtime.js');
const playoutSources = {
  'shared-playout.html': 'packages/ograf-web-player/shared-playout.html',
  'shared-playout.js': 'packages/ograf-web-player/shared-playout.js',
  'shared-input.js': 'packages/ograf-web-player/shared-input.js',
  'ograf-player.js': 'packages/ograf-web-player/ograf-player.js',
  'preview-controls.css': 'apps/editor/src/panels/PreviewExportPanel.css',
  'preview-font.ttf': 'apps/editor/src/assets/font-library/nunito.ttf',
};
const authoringSkillFile = resolve(repositoryRoot, 'skills/ograf-authoring/ograf-authoring.zip');
const windowsIcon = resolve(repositoryRoot, 'assets/ograf-studio.ico');
const target = process.env.OGRAF_STANDALONE_TARGET ?? 'bun-windows-x64-baseline';
const windowsTarget = target.includes('windows');
const requestedOutfile = process.env.OGRAF_STANDALONE_OUTFILE?.trim();
const outfile = resolve(
  repositoryRoot,
  requestedOutfile || `release/OGrafStudioServer${windowsTarget ? '.exe' : ''}`,
);
if (windowsTarget && extname(outfile).toLowerCase() !== '.exe') {
  throw new Error(`Windows standalone output must use the .exe extension: ${outfile}`);
}
const outputParts = parse(outfile);
const stagedOutfile = resolve(outputParts.dir, `${outputParts.name}.next${outputParts.ext}`);
const previousOutfile = resolve(outputParts.dir, `${outputParts.name}.previous${outputParts.ext}`);
const generatedEntrypoint = resolve(repositoryRoot, 'release/standalone-entry.ts');
const packageVersion = JSON.parse(
  await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
).version;
const versionParts = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(packageVersion);
if (!versionParts) throw new Error(`Unsupported standalone version: ${packageVersion}`);
const version =
  process.env.OGRAF_STUDIO_BUILD_VERSION ??
  `${versionParts[1]}.${versionParts[2]}.${versionParts[3]}.${versionParts[4] ?? '0'}`;

await mkdir(dirname(outfile), { recursive: true });
await mkdir(dirname(generatedEntrypoint), { recursive: true });
await rm(stagedOutfile, { force: true });

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

const editorFiles = (await listFiles(editorRoot)).sort();
const imports = editorFiles.map(
  (file, index) =>
    `import asset${index} from ${JSON.stringify(file.replaceAll('\\', '/'))} with { type: 'file' };`,
);
const assetEntries = editorFiles.map((file, index) => {
  const logicalPath = `/${relative(editorRoot, file).replaceAll('\\', '/')}`;
  return `${JSON.stringify(logicalPath)}: asset${index}`;
});
const playoutImports = Object.values(playoutSources).map((path, index) => {
  const file = resolve(repositoryRoot, path);
  return `import playoutAsset${index} from ${JSON.stringify(file.replaceAll('\\', '/'))} with { type: 'file' };`;
});
const playoutEntries = Object.keys(playoutSources).map(
  (name, index) => `${JSON.stringify(name)}: playoutAsset${index}`,
);
await writeFile(
  generatedEntrypoint,
  `${imports.join('\n')}\n` +
    `${playoutImports.join('\n')}\n` +
    `import runtimeAsset from ${JSON.stringify(runtimeFile.replaceAll('\\', '/'))} with { type: 'file' };\n` +
    `import authoringSkillAsset from ${JSON.stringify(authoringSkillFile.replaceAll('\\', '/'))} with { type: 'file' };\n` +
    `globalThis.__OGRAF_STANDALONE_RUNTIME__ = runtimeAsset;\n` +
    `globalThis.__OGRAF_STANDALONE_SKILL__ = authoringSkillAsset;\n` +
    `globalThis.__OGRAF_STANDALONE_ASSETS__ = { ${assetEntries.join(', ')} };\n` +
    `globalThis.__OGRAF_STANDALONE_PLAYOUT_ASSETS__ = { ${playoutEntries.join(', ')} };\n` +
    `await import(${JSON.stringify(standaloneEntrypoint.replaceAll('\\', '/'))});\n`,
);

let result;
try {
  result = await Bun.build({
    entrypoints: [generatedEntrypoint],
    target: 'bun',
    minify: true,
    compile: {
      target,
      outfile: stagedOutfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadPackageJson: false,
      autoloadTsconfig: false,
      ...(windowsTarget
        ? {
            windows: {
              icon: windowsIcon,
              title: 'OGraf Studio Server',
              publisher: 'Zero Density',
              version,
              description: 'OGraf Studio editor and MCP authoring server',
              copyright: 'Copyright Zero Density',
              hideConsole: false,
            },
          }
        : {}),
    },
  });
} finally {
  await rm(generatedEntrypoint, { force: true });
}

if (!result.success) {
  await rm(stagedOutfile, { force: true });
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
} else {
  await rm(previousOutfile, { force: true });
  let movedPrevious = false;
  try {
    await rename(outfile, previousOutfile);
    movedPrevious = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await rename(stagedOutfile, outfile);
  } catch (error) {
    if (movedPrevious) await rename(previousOutfile, outfile);
    throw error;
  }
  if (movedPrevious) await rm(previousOutfile, { force: true });
  console.log(`Created ${outfile}`);
}
