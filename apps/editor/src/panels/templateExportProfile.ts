import type { ExportProfileMode } from '@ograf-editor/codegen';
import type { Composition, Project } from '@ograf-editor/scene-model';

export function hasEnabledExternalFeed(composition: Pick<Composition, 'dataConnections'>): boolean {
  return composition.dataConnections.some(
    (connection) =>
      connection.enabled &&
      (connection.source === 'public-markets' ||
        (connection.source === 'url' && Boolean(connection.url.trim()))),
  );
}

export function defaultTemplateExportProfile(
  project: Pick<Project, 'supportsRealTime' | 'supportsNonRealTime'>,
  hasExternalFeed: boolean,
): ExportProfileMode {
  if (project.supportsRealTime && (!project.supportsNonRealTime || hasExternalFeed))
    return 'realtime';
  if (project.supportsNonRealTime && !project.supportsRealTime) return 'non-realtime';
  return 'dual';
}
