import { getExportProfile, type ExportArtifacts } from '@ograf-editor/codegen';
import type { Composition, Project } from '@ograf-editor/scene-model';
import { buildCoordinatedProjectSetArtifactsTask } from './coordinatedCompileTask';
import { buildExportArtifacts } from './ografCompatibility';
import {
  assertStudioRendererPluginsAllowed,
  useRendererPluginSettingsStore,
} from './pluginSettingsStore';
import type { ProjectSetDocument } from './projectSet';

export type SharedPlayoutSource =
  { project: Project; composition: Composition } | { set: ProjectSetDocument };

export interface SharedPlayoutLinks {
  viewerUrl: string;
  operatorUrl: string;
}

const sharedPlayoutApi = '/api/shared-playout';

export async function getSharedPlayoutLinks(
  signal: AbortSignal,
): Promise<SharedPlayoutLinks | null> {
  const response = await fetch(`${sharedPlayoutApi}/status`, { signal, cache: 'no-store' });
  if (!response.ok) return null;
  const status = (await response.json()) as Partial<SharedPlayoutLinks & { enabled: boolean }>;
  return status?.enabled === true ? browserLinks(status) : null;
}

function browserLink(value: string): string {
  const url = new URL(value, window.location.href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('The shared playout server returned an invalid link.');
  return url.href;
}

function browserLinks(value: Partial<SharedPlayoutLinks>): SharedPlayoutLinks {
  if (
    typeof value.viewerUrl !== 'string' ||
    !value.viewerUrl ||
    typeof value.operatorUrl !== 'string' ||
    !value.operatorUrl
  )
    throw new Error('The shared playout server did not return both preview links.');
  return { viewerUrl: browserLink(value.viewerUrl), operatorUrl: browserLink(value.operatorUrl) };
}

/** Build the existing real-time preview module and its playback resources in memory. */
export async function buildSharedPlayoutPreview(
  source: SharedPlayoutSource,
  signal: AbortSignal,
): Promise<ExportArtifacts> {
  const profile = getExportProfile('realtime');
  let artifacts: ExportArtifacts;
  if ('set' in source) {
    const snapshot = {
      ...source.set,
      templates: source.set.templates.map((template) => ({
        ...template,
        project: { ...template.project, authoringPrompts: undefined },
      })),
    };
    artifacts = await buildCoordinatedProjectSetArtifactsTask(snapshot, profile, signal);
    if (!artifacts.valid || !artifacts.transitionDescriptor)
      throw new Error(
        artifacts.errors.join('\n') || 'The coordinated source could not be compiled.',
      );
    const { templates, sharedInstances } = artifacts.transitionDescriptor;
    const plugins = [...templates, ...sharedInstances].flatMap(
      ({ descriptor }) => descriptor.rendererPlugins ?? [],
    );
    if (plugins.length) await useRendererPluginSettingsStore.getState().initialize();
    signal.throwIfAborted();
    assertStudioRendererPluginsAllowed(plugins);
  } else {
    const project = {
      ...source.project,
      mainCompositionId: source.composition.id,
      authoringPrompts: undefined,
    };
    artifacts = buildExportArtifacts(project, source.composition, profile);
  }
  signal.throwIfAborted();
  if (!artifacts.valid)
    throw new Error(artifacts.errors.join('\n') || 'The loaded template could not be prepared.');
  return artifacts;
}

/** Send the preview bytes directly to the shared Live session. */
export async function publishSharedPlayout(
  artifacts: ExportArtifacts,
  signal: AbortSignal,
): Promise<SharedPlayoutLinks> {
  const { manifestFileName, manifest, mainJs, resources } = artifacts;
  const response = await fetch(`${sharedPlayoutApi}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      manifestFileName,
      manifest,
      mainJs,
      resources: resources.map(({ path, data, base64 }) => ({ path, data, base64 })),
    }),
    signal,
  });
  const result = (await response.json().catch(() => null)) as Partial<
    SharedPlayoutLinks & { publicationId: string; error: string }
  > | null;
  if (!response.ok)
    throw new Error(
      typeof result?.error === 'string'
        ? result.error
        : `Shared playout publication failed (HTTP ${response.status}).`,
    );
  if (!result?.publicationId) throw new Error('The server did not confirm the shared preview.');
  return browserLinks(result);
}
