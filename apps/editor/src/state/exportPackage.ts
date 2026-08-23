import JSZip from 'jszip';
import type { Composition, Project } from '@ograf-editor/scene-model';
import type { ExportProfile } from '@ograf-editor/codegen';
import { saveBlobToFile } from './fileIO';
import {
  buildExportArtifacts,
  certifyExportArtifacts,
  type ExportArtifacts,
  type OGrafCompatibilityResult,
} from './ografCompatibility';

export { buildExportArtifacts } from './ografCompatibility';

const ZIP_FILE_TYPES = [
  { description: 'OGraf Package', accept: { 'application/zip': ['.ograf.zip'] } },
];

export type ExportZipResult = ExportArtifacts & {
  compatibility: OGrafCompatibilityResult;
  saveResult: 'saved' | 'cancelled' | 'downloaded';
};

/** Packages only an OGraf-certified project; no save/download starts before all checks pass. */
export async function exportProjectAsZip(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
): Promise<ExportZipResult> {
  const artifacts = buildExportArtifacts(project, composition, profile);
  const compatibility = await certifyExportArtifacts(artifacts);
  if (!compatibility.valid) {
    throw new Error(
      `Export blocked by OGraf compatibility gate: ${compatibility.errors.join(' ')}`,
    );
  }
  const zip = new JSZip();
  zip.file(artifacts.manifestFileName, JSON.stringify(artifacts.manifest, null, 2));
  zip.file('main.js', artifacts.mainJs);
  for (const resource of artifacts.resources) {
    zip.file(resource.path, resource.data, { base64: resource.base64 });
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const saveResult = await saveBlobToFile(
    blob,
    `${project.name || 'untitled'}${profile?.fileNameSuffix ?? ''}.ograf.zip`,
    ZIP_FILE_TYPES,
  );
  return { ...artifacts, compatibility, saveResult };
}
