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
import { addOfflinePreviewFile } from './offlinePreviewPackage';

export interface CertifiedCoordinatedPackage {
  artifacts: ExportArtifacts;
  compatibility: OGrafCompatibilityResult;
  blob: Blob;
}

/** Certifies the exact files before packaging; does not open a file writer. */
export async function createCertifiedCoordinatedPackage(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  options: { onProgress?: (stage: string) => void } = {},
): Promise<CertifiedCoordinatedPackage> {
  options.onProgress?.('compilation');
  let artifacts: ExportArtifacts;
  try {
    artifacts = await buildCoordinatedProjectSetArtifactsTask(set, profile);
    if (!artifacts.valid || artifacts.errors.length) throw new Error(artifacts.errors.join(' '));
  } catch (error) {
    throw exportFailure(error, 'compilation');
  }
  options.onProgress?.('thumbnail');
  try {
    const thumbnail = await createCoordinatedThumbnail(artifacts);
    const bytes = new Uint8Array(await thumbnail.arrayBuffer());
    const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    artifacts = withExportThumbnail(artifacts, { id: artifacts.manifest.id }, base64);
  } catch (error) {
    throw exportFailure(error, 'thumbnail');
  }
  options.onProgress?.('certification');
  let compatibility: OGrafCompatibilityResult;
  try {
    compatibility = await certifyExportArtifacts(artifacts);
  } catch (error) {
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
  options.onProgress?.('packaging');
  const zip = new JSZip();
  zip.file(artifacts.manifestFileName, JSON.stringify(artifacts.manifest, null, 2));
  zip.file('main.js', artifacts.mainJs);
  for (const resource of artifacts.resources)
    zip.file(resource.path, resource.data, { base64: resource.base64 });
  addOfflinePreviewFile(zip, artifacts);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { artifacts, compatibility, blob };
}
