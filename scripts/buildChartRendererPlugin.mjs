import { resolve } from 'node:path';
import {
  buildChartPluginSnapshot,
  repositoryRoot,
  writePluginSnapshot,
} from './pluginPackageSources.mjs';

const snapshot = await buildChartPluginSnapshot(process.env.OGRAF_CHART_PLUGIN_VERSION);
const version = snapshot.manifest.version;
const path = resolve(
  repositoryRoot,
  process.env.OGRAF_CHART_PLUGIN_OUTFILE ||
    `release/plugins/ograf-chartjs-${version}.ogsplugin.zip`,
);
await writePluginSnapshot(path, snapshot);
console.log(
  JSON.stringify({
    path,
    providerVersion: version,
    libraryVersion: snapshot.manifest.library.version,
    sha256: snapshot.sha256,
  }),
);
