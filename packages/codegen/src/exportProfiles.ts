import type { Project } from '@ograf-editor/scene-model';

export type ExportProfileMode = 'realtime' | 'non-realtime' | 'dual';

export interface ExportProfile {
  id: ExportProfileMode;
  name: string;
  mode: ExportProfileMode;
  /** Keeps simultaneously exported variants addressable as distinct OGraf graphics. */
  graphicIdSuffix: string;
  fileNameSuffix: string;
}

export const BUILT_IN_EXPORT_PROFILES: readonly ExportProfile[] = [
  {
    id: 'realtime',
    name: 'Real-time playout',
    mode: 'realtime',
    graphicIdSuffix: '-rt',
    fileNameSuffix: '-realtime',
  },
  {
    id: 'non-realtime',
    name: 'Non-real-time render',
    mode: 'non-realtime',
    graphicIdSuffix: '-nrt',
    fileNameSuffix: '-non-realtime',
  },
  {
    id: 'dual',
    name: 'Dual-mode package',
    mode: 'dual',
    graphicIdSuffix: '',
    fileNameSuffix: '-dual',
  },
] as const;

export function getExportProfile(id: ExportProfileMode): ExportProfile {
  return BUILT_IN_EXPORT_PROFILES.find((profile) => profile.id === id)!;
}

/** Derives output-only flags/identity without mutating the editable authoring document. */
export function projectForExportProfile(project: Project, profile: ExportProfile): Project {
  const output = structuredClone(project);
  output.id = `${project.id}${profile.graphicIdSuffix}`;
  output.supportsRealTime = profile.mode !== 'non-realtime';
  output.supportsNonRealTime = profile.mode !== 'realtime';
  return output;
}
