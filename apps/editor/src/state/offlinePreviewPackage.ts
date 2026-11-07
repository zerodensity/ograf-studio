import type JSZip from 'jszip';
import {
  assertOfflinePreviewFileAvailable,
  buildOfflinePreviewHtml,
  getOfflinePreviewFileName,
  type ExportArtifacts,
} from '@ograf-editor/codegen';

/** Include a self-contained preview without changing any certified OGraf files. */
export function addOfflinePreviewFile(zip: JSZip, artifacts: ExportArtifacts): string {
  const fileName = getOfflinePreviewFileName(artifacts);
  assertOfflinePreviewFileAvailable(Object.keys(zip.files), fileName);
  zip.file(fileName, buildOfflinePreviewHtml(artifacts));
  return fileName;
}
