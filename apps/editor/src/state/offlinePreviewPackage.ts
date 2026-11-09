import {
  buildOfflinePreviewHtml,
  getOfflinePreviewFileName,
  type ExportArtifacts,
} from '@ograf-editor/codegen';

export type ExportFileFormat = 'zip' | 'html' | 'both';
export type ExportFileSaveStatus = 'saved' | 'cancelled' | 'downloaded' | 'prepared';

export interface ExportFile {
  format: Exclude<ExportFileFormat, 'both'>;
  fileName: string;
  blob: Blob;
}

export interface ExportFileSaveResult extends Pick<ExportFile, 'format' | 'fileName'> {
  saveResult: ExportFileSaveStatus;
}

export const HTML_FILE_TYPES = [
  { description: 'Standalone HTML preview', accept: { 'text/html': ['.html'] } },
];

/** The HTML player uses the exact certified manifest, code and assets. */
export function createStandaloneHtmlFile(
  artifacts: ExportArtifacts,
  fileNameSuffix = '',
): ExportFile {
  return {
    format: 'html',
    fileName: getOfflinePreviewFileName({
      manifest: {
        ...artifacts.manifest,
        name: `${artifacts.manifest.name}${fileNameSuffix}`,
      },
    }),
    blob: new Blob([buildOfflinePreviewHtml(artifacts)], { type: 'text/html;charset=utf-8' }),
  };
}
