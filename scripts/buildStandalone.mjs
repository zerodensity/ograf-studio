import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const standaloneEntrypoint = resolve(repositoryRoot, 'apps/mcp-server/src/standalone.ts');
const editorRoot = resolve(repositoryRoot, 'apps/editor/dist');
const windowsIcon = resolve(repositoryRoot, 'assets/ograf-studio.ico');
const outfile = resolve(repositoryRoot, 'release/OGrafStudioServer.exe');
const stagedOutfile = resolve(repositoryRoot, 'release/OGrafStudioServer.next.exe');
const previousOutfile = resolve(repositoryRoot, 'release/OGrafStudioServer.previous.exe');
const generatedEntrypoint = resolve(repositoryRoot, 'release/standalone-entry.ts');
const target = process.env.OGRAF_STANDALONE_TARGET ?? 'bun-windows-x64-baseline';
const version = process.env.OGRAF_STUDIO_BUILD_VERSION ?? '0.10.0.0';

await mkdir(dirname(outfile), { recursive: true });
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
await writeFile(
  generatedEntrypoint,
  `${imports.join('\n')}\n` +
    `globalThis.__OGRAF_STANDALONE_ASSETS__ = { ${assetEntries.join(', ')} };\n` +
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
      windows: {
        icon: windowsIcon,
        title: 'OGraf Studio Server',
        publisher: 'Zero Density',
        version,
        description: 'OGraf Studio editor and MCP authoring server',
        copyright: 'Copyright Zero Density',
        hideConsole: false,
      },
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
