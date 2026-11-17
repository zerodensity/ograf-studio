import JSZip from 'jszip';
import { exportFailure } from './certifiedArtifactSave';
import {
  withExportThumbnail,
  type ExportArtifacts,
  type ExportProfile,
} from '@ograf-editor/codegen';
import { certifyExportArtifacts, type OGrafCompatibilityResult } from './ografCompatibility';
import type { ProjectSetDocument } from './projectSet';
export { buildCoordinatedProjectSetArtifacts } from './coordinatedCompile';
import { buildCoordinatedProjectSetArtifactsTask } from './coordinatedCompileTask';
import { createCoordinatedThumbnail } from './coordinatedThumbnail';
import { awaitExportOperation } from './exportAbort';
import { generateExportZip } from './exportZip';
import { createStandaloneHtmlFile } from './offlinePreviewPackage';

export interface CertifiedCoordinatedPackage {
  artifacts: ExportArtifacts;
  compatibility: OGrafCompatibilityResult;
  blob: Blob;
}

interface CoordinatedExportOptions {
  onProgress?: (stage: string) => void;
  signal?: AbortSignal;
}

/** Certifies the exact coordinated files before packaging or publication. */
export async function certifyCoordinatedArtifacts(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  { onProgress, signal }: CoordinatedExportOptions = {},
): Promise<Omit<CertifiedCoordinatedPackage, 'blob'>> {
  signal?.throwIfAborted();
  onProgress?.('compilation');
  let artifacts: ExportArtifacts;
  try {
    artifacts = await buildCoordinatedProjectSetArtifactsTask(set, profile, signal);
    signal?.throwIfAborted();
    if (!artifacts.valid || artifacts.errors.length) throw new Error(artifacts.errors.join(' '));
  } catch (error) {
    signal?.throwIfAborted();
    throw exportFailure(error, 'compilation');
  }
  onProgress?.('thumbnail');
  try {
    signal?.throwIfAborted();
    const thumbnail = await createCoordinatedThumbnail(artifacts, signal);
    const bytes = new Uint8Array(await awaitExportOperation(thumbnail.arrayBuffer(), signal));
    signal?.throwIfAborted();
    const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    artifacts = withExportThumbnail(artifacts, { id: artifacts.manifest.id }, base64);
  } catch (error) {
    signal?.throwIfAborted();
    throw exportFailure(error, 'thumbnail');
  }
  onProgress?.('certification');
  let compatibility: OGrafCompatibilityResult;
  try {
    signal?.throwIfAborted();
    compatibility = await certifyExportArtifacts(artifacts, signal);
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    throw exportFailure(error, 'certification');
  }
  if (!compatibility.valid) {
    throw exportFailure(
      new Error(
        `Coordinated export blocked by OGraf compatibility gate: ${compatibility.errors.join(' ')}`,
      ),
      'certification',
    );
  }
  return { artifacts, compatibility };
}

/** Certifies the exact files before packaging; does not open a file writer. */
export async function createCertifiedCoordinatedPackage(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  options: CoordinatedExportOptions = {},
): Promise<CertifiedCoordinatedPackage> {
  const { artifacts, compatibility } = await certifyCoordinatedArtifacts(set, profile, options);
  options.signal?.throwIfAborted();
  options.onProgress?.('packaging');
  options.signal?.throwIfAborted();
  const zip = new JSZip();
  zip.file(artifacts.manifestFileName, JSON.stringify(artifacts.manifest, null, 2));
  zip.file('main.js', artifacts.mainJs);
  for (const resource of artifacts.resources)
    zip.file(resource.path, resource.data, { base64: resource.base64 });
  const blob = await generateExportZip(zip, options.signal);
  options.signal?.throwIfAborted();
  return { artifacts, compatibility, blob };
}

/** Builds the coordinated standalone player without packaging a ZIP. */
export async function createCertifiedCoordinatedHtml(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  options: CoordinatedExportOptions = {},
): Promise<CertifiedCoordinatedPackage & { fileName: string }> {
  const { artifacts, compatibility } = await certifyCoordinatedArtifacts(set, profile, options);
  options.signal?.throwIfAborted();
  options.onProgress?.('packaging');
  options.signal?.throwIfAborted();
  const { fileName, blob } = createStandaloneHtmlFile(artifacts, profile?.fileNameSuffix);
  options.signal?.throwIfAborted();
  return { artifacts, compatibility, blob, fileName };
}
