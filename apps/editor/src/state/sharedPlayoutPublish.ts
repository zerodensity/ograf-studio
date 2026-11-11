import { getExportProfile } from '@ograf-editor/codegen';
import type { Composition, Project } from '@ograf-editor/scene-model';
import { certifyCoordinatedArtifacts } from './coordinatedExport';
import { buildCertifiedProjectArtifacts } from './exportPackage';
import type { ProjectSetDocument } from './projectSet';
import { snapshotProjectSetForExport } from './projectSetExport';

export type SharedPlayoutSource =
  { project: Project; composition: Composition } | { set: ProjectSetDocument };

export interface SharedPlayoutPublication {
  publicationId: string;
  viewerUrl: string;
  operatorUrl: string;
}

const sharedPlayoutApi = '/api/shared-playout';

export async function isSharedPlayoutEnabled(signal: AbortSignal): Promise<boolean> {
  const response = await fetch(`${sharedPlayoutApi}/status`, { signal, cache: 'no-store' });
  return response.ok && (await response.json())?.enabled === true;
}

function browserLink(value: string): string {
  const url = new URL(value, window.location.href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('The shared playout server returned an invalid link.');
  return url.href;
}

/** Certify the files once and upload them directly without opening a save dialog. */
export async function publishSharedPlayout(
  source: SharedPlayoutSource,
  signal: AbortSignal,
): Promise<SharedPlayoutPublication> {
  const profile = getExportProfile('realtime');
  const { artifacts } =
    'set' in source
      ? await certifyCoordinatedArtifacts(snapshotProjectSetForExport(source.set), profile, {
          signal,
        })
      : await buildCertifiedProjectArtifacts(
          { ...source.project, mainCompositionId: source.composition.id },
          source.composition,
          profile,
          signal,
        );
  signal.throwIfAborted();
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
    SharedPlayoutPublication & { error: string }
  > | null;
  if (!response.ok)
    throw new Error(
      typeof result?.error === 'string'
        ? result.error
        : `Shared playout publication failed (HTTP ${response.status}).`,
    );
  if (
    typeof result?.publicationId !== 'string' ||
    !result.publicationId ||
    typeof result.viewerUrl !== 'string' ||
    !result.viewerUrl ||
    typeof result.operatorUrl !== 'string' ||
    !result.operatorUrl
  )
    throw new Error('The shared playout server did not return both publication links.');
  return {
    publicationId: result.publicationId,
    viewerUrl: browserLink(result.viewerUrl),
    operatorUrl: browserLink(result.operatorUrl),
  };
}
