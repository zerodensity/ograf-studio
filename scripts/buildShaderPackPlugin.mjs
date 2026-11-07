import { resolve } from 'node:path';
import {
  buildShaderPluginSnapshot,
  repositoryRoot,
  writePluginSnapshot,
} from './pluginPackageSources.mjs';

const snapshot = await buildShaderPluginSnapshot(process.argv[2]);
const path = resolve(
  repositoryRoot,
  'release/plugins',
  `${snapshot.manifest.id}-${snapshot.manifest.version}.ogsplugin.zip`,
);
await writePluginSnapshot(path, snapshot);
console.log(
  JSON.stringify({
    path,
    version: snapshot.manifest.version,
    shaders: snapshot.shaders.length,
    sha256: snapshot.sha256,
  }),
);
