import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createRendererPluginSnapshot } from '../packages/scene-model/src/rendererPlugins.ts';
import { assertRendererPluginModule } from '../packages/scene-model/src/rendererPluginModule.ts';
import { createShaderPackPluginSnapshot } from '../packages/scene-model/src/shaderPackPlugins.ts';
import { createAnimationPresetPluginSnapshot } from '../packages/scene-model/src/animationPresetPlugins.ts';
import { numberedShaderPackPreset } from './shaderPackSourcePresets.ts';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const fromRoot = (path) => resolve(repositoryRoot, path);
const archiveDate = new Date('1980-01-01T00:00:00.000Z');

export async function buildChartPluginSnapshot(versionOverride) {
  const providerPackage = JSON.parse(
    await readFile(fromRoot('plugins/chartjs/package.json'), 'utf8'),
  );
  const library = JSON.parse(
    await readFile(fromRoot('node_modules/chart.js/package.json'), 'utf8'),
  );
  const built = await Bun.build({
    entrypoints: [fromRoot('plugins/chartjs/src/entry.ts')],
    target: 'browser',
    format: 'esm',
    // Bun's identifier allocator can choose different short names in fresh build processes.
    // Exact source bytes are the plugin trust identity, so retain names while still compacting
    // whitespace and syntax. Archive ordering/dates alone cannot make renamed code reproducible.
    minify: { whitespace: true, syntax: true, identifiers: false },
  });
  if (!built.success) throw new Error(built.logs.join('\n'));
  const source = await built.outputs[0].text();
  await assertRendererPluginModule(source);
  const licenseText = [
    'OGraf Studio renderer adapter:\n' + (await readFile(fromRoot('LICENSE'), 'utf8')),
    'Chart.js:\n' + (await readFile(fromRoot('node_modules/chart.js/LICENSE.md'), 'utf8')),
    '@kurkle/color:\n' +
      (await readFile(fromRoot('node_modules/@kurkle/color/LICENSE.md'), 'utf8')),
  ].join('\n\n');
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'ograf.chartjs',
      version: versionOverride ?? providerPackage.version,
      name: 'Chart.js renderer',
      author: 'Zero Density',
      description: 'Chart.js adapter sampled from the OGraf frame clock.',
      library: {
        name: 'Chart.js',
        version: library.version,
        license: library.license,
        author: 'Chart.js contributors',
        homepage: 'https://www.chartjs.org',
      },
      license: 'AGPL-3.0-only',
      presets: [
        'bar',
        'horizontal-bar',
        'stacked-bar',
        'line',
        'area',
        'pie',
        'doughnut',
        'radar',
        'polar-area',
      ],
      chartFeatures: [
        'presentation-v1',
        'canonical-data-v1',
        'morph-update-v1',
        'mark-paint-v1',
        'mark-animation-v1',
      ],
    },
    source,
    licenseText,
  });
}

export async function buildShaderPluginSnapshot(sourceDirectory = 'plugins/zd-news-shaders') {
  const directory = fromRoot(sourceDirectory);
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  const licenseText = await readFile(resolve(directory, 'LICENSE.txt'), 'utf8');
  let shaders;
  try {
    shaders = JSON.parse(await readFile(resolve(directory, 'shaders.json'), 'utf8'));
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw cause;
    const files = (await readdir(resolve(directory, 'src')))
      .filter((name) => /^\d{2}-.*\.glsl$/.test(name))
      .sort();
    if (!files.length) throw new Error('Provide shaders.json or numbered GLSL files in src/.');
    shaders = await Promise.all(
      files.map(async (file) => {
        const fragmentSource = await readFile(resolve(directory, 'src', file), 'utf8');
        return numberedShaderPackPreset(file, fragmentSource, manifest.license);
      }),
    );
  }
  return createShaderPackPluginSnapshot({ manifest, shaders, licenseText });
}

export async function buildAnimationPluginSnapshot(sourceDirectory = 'plugins/broadcast-motion') {
  const directory = fromRoot(sourceDirectory);
  return createAnimationPresetPluginSnapshot({
    manifest: JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
    presets: JSON.parse(await readFile(resolve(directory, 'presets.json'), 'utf8')),
    licenseText: await readFile(resolve(directory, 'LICENSE.txt'), 'utf8'),
  });
}

/** Fixed entry dates and ordering make packages reproducible and safe to pin by their bytes. */
export async function encodePluginSnapshot(snapshot) {
  const zip = new JSZip();
  const file = (name, data) => zip.file(name, data, { date: archiveDate });
  file('manifest.json', JSON.stringify(snapshot.manifest, null, 2));
  if (snapshot.manifest.kind === 'chart') file('renderer.js', snapshot.source);
  else if (snapshot.manifest.kind === 'shader-pack')
    file('shaders.json', JSON.stringify(snapshot.shaders, null, 2));
  else if (snapshot.manifest.kind === 'animation-presets')
    file('presets.json', JSON.stringify(snapshot.presets, null, 2));
  else throw new Error(`Unsupported plugin package kind: ${snapshot.manifest.kind}`);
  file('LICENSE.txt', snapshot.licenseText);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function writePluginSnapshot(path, snapshot) {
  if (!path.toLowerCase().endsWith('.ogsplugin.zip'))
    throw new Error('Plugin bundle output must use the .ogsplugin.zip suffix.');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await encodePluginSnapshot(snapshot));
}
