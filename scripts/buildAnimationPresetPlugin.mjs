import { resolve } from 'node:path';
import {
  buildAnimationPluginSnapshot,
  repositoryRoot,
  writePluginSnapshot,
} from './pluginPackageSources.mjs';

const snapshot = await buildAnimationPluginSnapshot(process.argv[2]);
const path = resolve(
  repositoryRoot,
  'release/plugins',
  `${snapshot.manifest.id}-${snapshot.manifest.version}.ogsplugin.zip`,
);
await writePluginSnapshot(path, snapshot);
console.log(
  JSON.stringify({
    path,
    kind: snapshot.manifest.kind,
    version: snapshot.manifest.version,
    presets: snapshot.presets.map((preset) => preset.id),
    sha256: snapshot.sha256,
  }),
);
