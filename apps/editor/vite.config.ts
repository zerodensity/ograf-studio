import { build, defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveBuildRevision } from './buildRevision.ts';

const rootPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };
const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH);
const buildDate = new Date(
  Number.isFinite(sourceDateEpoch) && sourceDateEpoch > 0 ? sourceDateEpoch * 1000 : Date.now(),
)
  .toISOString()
  .slice(0, 10);
const buildRevision = resolveBuildRevision(process.env.OGRAF_BUILD_REVISION, () =>
  execFileSync('git', ['rev-parse', '--short=8', '--verify', 'HEAD'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2_000,
    windowsHide: true,
  }),
);

function keepExportRuntimeFresh(): Plugin {
  const runtimeRoot = fileURLToPath(new URL('../../packages/ograf-runtime', import.meta.url));
  const runtimeSource = normalizePath(
    fileURLToPath(new URL('../../packages/ograf-runtime/src', import.meta.url)),
  );
  const modelSource = normalizePath(
    fileURLToPath(new URL('../../packages/scene-model/src', import.meta.url)),
  );
  let rebuilding = false;
  let pending = false;
  let reportError = (message: string) => console.error(message);
  const rebuild = async () => {
    if (rebuilding) {
      pending = true;
      return;
    }
    rebuilding = true;
    try {
      // The editor imports this bundle as raw source. Publishing only the completed chunk keeps
      // HMR from resolving a missing/partial file while the library build replaces its output.
      const result = await build({
        root: runtimeRoot,
        logLevel: 'warn',
        build: { write: false, emptyOutDir: false },
      });
      const bundles = Array.isArray(result) ? result : [result];
      let source: string | undefined;
      for (const bundle of bundles)
        if ('output' in bundle)
          for (const output of bundle.output)
            if (output.type === 'chunk' && output.fileName === 'graphic-runtime.js')
              source = output.code;
      if (source === undefined)
        throw new Error('The runtime build did not produce its entry module.');
      const directory = join(runtimeRoot, 'dist');
      const temporary = join(directory, `.graphic-runtime-${process.pid}.tmp`);
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(temporary, source);
        await rename(temporary, join(directory, 'graphic-runtime.js'));
      } finally {
        await rm(temporary, { force: true });
      }
    } catch (error) {
      // An incomplete edit must not terminate the editor's long-running dev server.
      reportError(
        `Export runtime rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      rebuilding = false;
      if (pending) {
        pending = false;
        void rebuild();
      }
    }
  };

  return {
    name: 'keep-export-runtime-fresh',
    configureServer(server) {
      reportError = (message) => server.config.logger.error(message);
      server.watcher.add([runtimeSource, modelSource]);
      server.watcher.on('change', (file) => {
        const path = normalizePath(file);
        if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return;
        if (path.startsWith(`${runtimeSource}/`) || path.startsWith(`${modelSource}/`))
          void rebuild();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        transitionLogicNews: fileURLToPath(
          new URL('./transition-logic-news.html', import.meta.url),
        ),
      },
    },
  },
  define: {
    __OGRAF_STUDIO_VERSION__: JSON.stringify(rootPackage.version),
    __OGRAF_STUDIO_BUILD_DATE__: JSON.stringify(buildDate),
    __OGRAF_STUDIO_BUILD_REVISION__: JSON.stringify(buildRevision),
  },
  // Export embeds the runtime distribution as raw source. Rebuild it whenever its source changes
  // so a long-running editor dev session cannot preview newer code than it packages.
  plugins: [react(), keepExportRuntimeFresh()],
});
