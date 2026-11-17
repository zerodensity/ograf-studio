import JSZip from 'jszip';
import type { Composition, Project } from '@ograf-editor/scene-model';
import { withExportThumbnail, type ExportProfile } from '@ograf-editor/codegen';
import { saveBlobToFile } from './fileIO';
import {
  createStandaloneHtmlFile,
  HTML_FILE_TYPES,
  type ExportFile,
  type ExportFileFormat,
  type ExportFileSaveResult,
  type ExportFileSaveStatus,
} from './offlinePreviewPackage';
import { stageCertifiedArtifacts } from './certifiedArtifactSave';
import { generateExportZip } from './exportZip';
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
export type { ExportFileFormat } from './offlinePreviewPackage';

const ZIP_FILE_TYPES = [
  { description: 'OGraf Package', accept: { 'application/zip': ['.ograf.zip'] } },
];

export type ExportZipResult = ExportArtifacts & {
  compatibility: OGrafCompatibilityResult;
  saveResult: ExportFileSaveStatus;
  files: ExportFileSaveResult[];
};

export interface CertifiedProjectPackage {
  artifacts: ExportArtifacts;
  compatibility: OGrafCompatibilityResult;
  blob: Blob;
}

export class OGrafExportCertificationError extends Error {
  readonly nonRealtimeReplayFailed: boolean;

  constructor(compatibility: OGrafCompatibilityResult) {
    super(`Export blocked by OGraf compatibility gate: ${compatibility.errors.join(' ')}`);
    this.name = 'OGrafExportCertificationError';
    const failedChecks = compatibility.checks.filter((check) => !check.valid);
    const firstFailure = failedChecks[0];
    this.nonRealtimeReplayFailed =
      failedChecks.length === 1 &&
      firstFailure?.id === 'lifecycle' &&
      firstFailure.errors.length > 0 &&
      firstFailure.errors.every((error) =>
        error.startsWith(
          'Canvas pixels changed after backward and repeated non-realtime goToTime seeking',
        ),
      );
  }
}

/** Builds the package of a snapshot of the project, with its thumbnail, and throws unless it is OGraf-certified. */
export async function buildCertifiedProjectArtifacts(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const snapshot = structuredClone(project);
  const snapshotComposition = structuredClone(composition);
  let artifacts = buildExportArtifacts(snapshot, snapshotComposition, profile);
  if (artifacts.valid) {
    const { createTemplateThumbnail } = await import('./templateThumbnail');
    signal?.throwIfAborted();
    const thumbnailProject = {
      ...snapshot,
      mainCompositionId: snapshotComposition.id,
      compositions: [snapshotComposition],
    };
    const thumbnail = signal
      ? await createTemplateThumbnail(thumbnailProject, signal)
      : await createTemplateThumbnail(thumbnailProject);
    const bytes = new Uint8Array(await thumbnail.arrayBuffer());
    signal?.throwIfAborted();
    const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    artifacts = withExportThumbnail(artifacts, snapshot, base64);
  }
  const compatibility = signal
    ? await certifyExportArtifacts(artifacts, signal)
    : await certifyExportArtifacts(artifacts);
  signal?.throwIfAborted();
  if (!compatibility.valid) throw new OGrafExportCertificationError(compatibility);
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

function packageBlob(artifacts: ExportArtifacts, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const zip = new JSZip();
  addPackageFiles(zip, artifacts);
  return generateExportZip(zip, signal);
}

/** Builds a standalone certified OGraf ZIP without opening a save dialog. */
export async function createCertifiedProjectPackage(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
  { signal }: { signal?: AbortSignal } = {},
): Promise<CertifiedProjectPackage> {
  const { artifacts, compatibility } = await buildCertifiedProjectArtifacts(
    project,
    composition,
    profile,
    signal,
  );
  const blob = await packageBlob(artifacts, signal);
  signal?.throwIfAborted();
  return { artifacts, compatibility, blob };
}

/** Builds a certified standalone HTML player without creating a ZIP or starting a save. */
export async function createCertifiedProjectHtml(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
): Promise<CertifiedProjectPackage> {
  const { artifacts, compatibility } = await buildCertifiedProjectArtifacts(
    project,
    composition,
    profile,
  );
  return { artifacts, compatibility, blob: createStandaloneHtmlFile(artifacts).blob };
}

/** Exports certified package files or an independent HTML player. */
export async function exportProjectAsZip(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
  options: { downloadOnly?: boolean; ownerWindow?: Window; format?: ExportFileFormat } = {},
): Promise<ExportZipResult> {
  const { format = 'zip', ...saveOptions } = options;
  const { artifacts, compatibility } = await buildCertifiedProjectArtifacts(
    project,
    composition,
    profile,
  );
  const suffix = profile?.fileNameSuffix ?? '';
  const files: ExportFile[] = [];
  if (format !== 'html') {
    files.push({
      format: 'zip',
      blob: await packageBlob(artifacts),
      fileName: `${project.name || 'untitled'}${suffix}.ograf.zip`,
    });
  }
  if (format !== 'zip') files.push(createStandaloneHtmlFile(artifacts, suffix));
  if (files.length > 1) {
    // Each file gets a fresh user gesture. Certification and preparation happen only once.
    stageCertifiedArtifacts(files, 1, saveOptions.ownerWindow, true);
    return {
      ...artifacts,
      compatibility,
      saveResult: 'prepared',
      files: files.map(({ format, fileName }) => ({ format, fileName, saveResult: 'prepared' })),
    };
  }
  const file = files[0]!;
  const saveResult = await saveBlobToFile(
    file.blob,
    file.fileName,
    file.format === 'html' ? HTML_FILE_TYPES : ZIP_FILE_TYPES,
    ...(Object.keys(saveOptions).length ? [saveOptions] : []),
  );
  return {
    ...artifacts,
    compatibility,
    saveResult,
    files: [{ format: file.format, fileName: file.fileName, saveResult }],
  };
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
  const { snapshotComposition, artifacts, compatibility } = await buildCertifiedProjectArtifacts(
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
