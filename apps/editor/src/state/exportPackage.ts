import JSZip from 'jszip';
import type { Composition, Project } from '@ograf-editor/scene-model';
import { withExportThumbnail, type ExportProfile } from '@ograf-editor/codegen';
import { saveBlobToFile } from './fileIO';
import { addOfflinePreviewFile } from './offlinePreviewPackage';
import {
  buildNodosPresetDefinition,
  buildNodosRendererPage,
  NODOS_RENDERER_PAGE,
  type NodosPackageFile,
  type NodosPresetOptions,
} from './nodosPreset';
import { bytesToBase64 } from './projectSet';
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

export interface CertifiedProjectPackage {
  artifacts: ExportArtifacts;
  compatibility: OGrafCompatibilityResult;
  blob: Blob;
}

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
  addOfflinePreviewFile(zip, artifacts);
}

/** Builds a standalone certified OGraf ZIP without opening a save dialog. */
export async function createCertifiedProjectPackage(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
): Promise<CertifiedProjectPackage> {
  const { artifacts, compatibility } = await buildCertifiedArtifacts(project, composition, profile);
  const zip = new JSZip();
  addPackageFiles(zip, artifacts);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { artifacts, compatibility, blob };
}

/** Packages only an OGraf-certified project; no save/download starts before all checks pass. */
export async function exportProjectAsZip(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
  options: { downloadOnly?: boolean; ownerWindow?: Window } = {},
): Promise<ExportZipResult> {
  const { artifacts, compatibility, blob } = await createCertifiedProjectPackage(
    project,
    composition,
    profile,
  );
  const saveResult = await saveBlobToFile(
    blob,
    `${project.name || 'untitled'}${profile?.fileNameSuffix ?? ''}.ograf.zip`,
    ZIP_FILE_TYPES,
    ...(Object.keys(options).length ? [options] : []),
  );
  return { ...artifacts, compatibility, saveResult };
}

const textToBase64 = (text: string) => bytesToBase64(new TextEncoder().encode(text));

/**
 * Builds an OGraf-certified project as a Nodos preset with the files its page needs: the OGraf package and a page that
 * plays it. Studio's server serves the files and sends the preset to Nodos.
 */
export async function buildNodosPreset(
  project: Project,
  composition: Composition,
  options: NodosPresetOptions,
  profile?: ExportProfile,
): Promise<{
  preset: ReturnType<typeof buildNodosPresetDefinition>;
  files: NodosPackageFile[];
  compatibility: OGrafCompatibilityResult;
}> {
  if (profile?.mode === 'non-realtime' || (!profile && !project.supportsRealTime))
    throw new Error('A Nodos preset requires a Real-time or Dual-mode output profile.');
  const { snapshotComposition, artifacts, compatibility } = await buildCertifiedArtifacts(
    project,
    composition,
    profile,
  );
  const files: NodosPackageFile[] = [
    {
      path: artifacts.manifestFileName,
      base64: textToBase64(JSON.stringify(artifacts.manifest, null, 2)),
    },
    { path: 'main.js', base64: textToBase64(artifacts.mainJs) },
    ...artifacts.resources.map((resource) => ({
      path: resource.path,
      base64: resource.base64 ? resource.data : textToBase64(resource.data),
    })),
    {
      path: NODOS_RENDERER_PAGE,
      base64: textToBase64(buildNodosRendererPage(artifacts.manifest.name, snapshotComposition)),
    },
  ];
  return { preset: buildNodosPresetDefinition(snapshotComposition, options), files, compatibility };
}
