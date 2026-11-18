import type { Composition, Project } from '@ograf-editor/scene-model';

export type ExportProfileMode = 'realtime' | 'non-realtime' | 'dual';

export interface ExportProfile {
  id: ExportProfileMode;
  name: string;
  mode: ExportProfileMode;
  /** Keeps simultaneously exported variants addressable as distinct OGraf graphics. */
  graphicIdSuffix: string;
  fileNameSuffix: string;
  transparentCompositionBackground?: boolean;
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

export const NLE_EXPORT_PROFILE: ExportProfile = {
  ...getExportProfile('non-realtime'),
  transparentCompositionBackground: true,
};

export function compositionForExportProfile(
  composition: Composition,
  profile?: ExportProfile,
): Composition {
  if (
    !profile?.transparentCompositionBackground ||
    (composition.backgroundColor === 'transparent' && composition.backgroundPaint === undefined)
  )
    return composition;
  const output = { ...composition, backgroundColor: 'transparent' };
  delete output.backgroundPaint;
  return output;
}

/** Derives output-only flags/identity without mutating the editable authoring document. */
export function projectForExportProfile(project: Project, profile: ExportProfile): Project {
  const output = structuredClone(project);
  output.id = `${project.id}${profile.graphicIdSuffix}`;
  output.supportsRealTime = profile.mode !== 'non-realtime';
  output.supportsNonRealTime = profile.mode !== 'realtime';
  if (profile.transparentCompositionBackground)
    output.compositions = output.compositions.map((composition) =>
      compositionForExportProfile(composition, profile),
    );
  return output;
}
