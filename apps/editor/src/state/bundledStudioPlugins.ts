import type { StudioPluginSnapshot } from '@ograf-editor/scene-model';
import { BUNDLED_STUDIO_PLUGINS } from '../generated/bundledPlugins';
import { MAX_RENDERER_PLUGIN_BUNDLE_BYTES, parseStudioPluginBundle } from './rendererPluginBundles';

export interface BundledStudioPluginLoad {
  snapshots: StudioPluginSnapshot[];
  errors: string[];
}

const verified = new Map<string, Promise<StudioPluginSnapshot>>();

/** Only hashes compiled into this Studio build grant included-plugin trust. */
export async function loadBundledStudioPlugins(): Promise<BundledStudioPluginLoad> {
  const results = await Promise.allSettled(
    BUNDLED_STUDIO_PLUGINS.map((entry) => {
      const previous = verified.get(entry.bundleSha256);
      if (previous) return previous;
      const loading = (async () => {
        if (!/^[a-zA-Z0-9._-]+\.ogsplugin\.zip$/.test(entry.filename))
          throw new Error('Invalid included plugin filename.');
        const response = await fetch(
          `${import.meta.env.BASE_URL}bundled-plugins/${entry.filename}`,
          {
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok) throw new Error(`Included plugin ${entry.name} could not be loaded.`);
        const declaredSize = Number(response.headers.get('content-length'));
        if (declaredSize > MAX_RENDERER_PLUGIN_BUNDLE_BYTES)
          throw new Error(`Included plugin ${entry.name} exceeds its size limit.`);
        const data = await response.arrayBuffer();
        if (data.byteLength > MAX_RENDERER_PLUGIN_BUNDLE_BYTES)
          throw new Error(`Included plugin ${entry.name} exceeds its size limit.`);
        const digest = await crypto.subtle.digest('SHA-256', data);
        const sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        if (sha256 !== entry.bundleSha256)
          throw new Error(`Included plugin ${entry.name} does not match this Studio build.`);
        const snapshot = await parseStudioPluginBundle(data);
        if (
          snapshot.manifest.id !== entry.id ||
          snapshot.manifest.kind !== entry.kind ||
          snapshot.manifest.version !== entry.version ||
          snapshot.sha256 !== entry.snapshotSha256
        )
          throw new Error(`Included plugin ${entry.name} has an unexpected identity.`);
        return snapshot;
      })().catch((cause) => {
        verified.delete(entry.bundleSha256);
        throw cause;
      });
      verified.set(entry.bundleSha256, loading);
      return loading;
    }),
  );
  return {
    snapshots: results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    errors: results.flatMap((result) =>
      result.status === 'rejected'
        ? [
            result.reason instanceof Error
              ? result.reason.message
              : 'An included plugin could not be loaded.',
          ]
        : [],
    ),
  };
}
