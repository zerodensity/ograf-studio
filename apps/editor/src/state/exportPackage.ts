import JSZip from 'jszip';
import type { Composition, Project } from '@ograf-editor/scene-model';
import { withExportThumbnail, type ExportProfile } from '@ograf-editor/codegen';
import { saveBlobToFile } from './fileIO';
import { addNodosPresetFiles, type NodosPresetOptions } from './nodosPreset';
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

const NODOS_ZIP_FILE_TYPES = [
  { description: 'Nodos Preset Package', accept: { 'application/zip': ['.nodos.zip'] } },
];

export type ExportZipResult = ExportArtifacts & {
  compatibility: OGrafCompatibilityResult;
  saveResult: 'saved' | 'cancelled' | 'downloaded';
};

/** Builds the package of a snapshot of the project, with its thumbnail, and throws unless it is OGraf-certified. */
async function buildCertifiedArtifacts(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
) {
  const snapshot = structuredClone(project);
  const snapshotComposition = structuredClone(composition);
  let artifacts = buildExportArtifacts(snapshot, snapshotComposition, profile);
  if (artifacts.valid) {
    const { createTemplateThumbnail } = await import('./templateThumbnail');
    const thumbnail = await createTemplateThumbnail({
      ...snapshot,
      mainCompositionId: snapshotComposition.id,
      compositions: [snapshotComposition],
    });
    const bytes = new Uint8Array(await thumbnail.arrayBuffer());
    const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    artifacts = withExportThumbnail(artifacts, snapshot, base64);
  }
  const compatibility = await certifyExportArtifacts(artifacts);
  if (!compatibility.valid) {
    throw new Error(
      `Export blocked by OGraf compatibility gate: ${compatibility.errors.join(' ')}`,
    );
  }
  return { snapshot, snapshotComposition, artifacts, compatibility };
}

/** Adds the files of an OGraf package to `zip`, at the package root. */
export function addPackageFiles(zip: JSZip, artifacts: ExportArtifacts): void {
  zip.file(artifacts.manifestFileName, JSON.stringify(artifacts.manifest, null, 2));
  zip.file('main.js', artifacts.mainJs);
  for (const resource of artifacts.resources) {
    zip.file(resource.path, resource.data, { base64: resource.base64 });
  }
}

/** Packages only an OGraf-certified project; no save/download starts before all checks pass. */
export async function exportProjectAsZip(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
): Promise<ExportZipResult> {
  const { snapshot, artifacts, compatibility } = await buildCertifiedArtifacts(
    project,
    composition,
    profile,
  );
  const zip = new JSZip();
  addPackageFiles(zip, artifacts);
  const blob = await zip.generateAsync({ type: 'blob' });
  const saveResult = await saveBlobToFile(
    blob,
    `${snapshot.name || 'untitled'}${profile?.fileNameSuffix ?? ''}.ograf.zip`,
    ZIP_FILE_TYPES,
  );
  return { ...artifacts, compatibility, saveResult };
}

/**
 * Packages an OGraf-certified project for Nodos: the OGraf package, a page that plays it, and a node definition file
 * with a preset that creates an ElectroNode showing that page. RealityHub serves the package and sends the preset.
 */
export async function exportProjectAsNodosPreset(
  project: Project,
  composition: Composition,
  options: NodosPresetOptions,
  profile?: ExportProfile,
): Promise<ExportZipResult> {
  const { snapshot, snapshotComposition, artifacts, compatibility } = await buildCertifiedArtifacts(
    project,
    composition,
    profile,
  );
  const zip = new JSZip();
  addPackageFiles(zip, artifacts);
  addNodosPresetFiles(zip, artifacts.manifest.name, snapshotComposition, options);
  const blob = await zip.generateAsync({ type: 'blob' });
  const saveResult = await saveBlobToFile(
    blob,
    `${snapshot.name || 'untitled'}${profile?.fileNameSuffix ?? ''}.nodos.zip`,
    NODOS_ZIP_FILE_TYPES,
  );
  return { ...artifacts, compatibility, saveResult };
}
