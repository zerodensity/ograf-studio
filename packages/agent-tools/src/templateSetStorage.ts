/** Base64 transport stays below the editor WebSocket's message limit. Studio file saves support larger archives. */
export const MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES = 64 * 1024 * 1024;

export const LOCAL_BRANDING_TEMPLATE_SET_ARCHIVE_SCHEMA_VERSION = 7;

export type TemplateSetArchiveMode = 'compact' | 'compatible';

export interface TemplateSetArchiveRequest {
  action: 'archive';
  expectedRevision: string;
  archiveMode?: TemplateSetArchiveMode;
}

export interface TemplateSetArchiveResult {
  revision: string;
  name: string;
  archiveMode: TemplateSetArchiveMode;
  schemaVersion: 5 | 6 | typeof LOCAL_BRANDING_TEMPLATE_SET_ARCHIVE_SCHEMA_VERSION;
  archiveBase64: string;
  archiveBytes: number;
  templateCount: number;
  sha256: string;
}

export interface CoordinatedExportRequest {
  action: 'export-coordinated';
  expectedRevision: string;
  profile: 'realtime' | 'non-realtime' | 'dual';
  format?: 'zip' | 'html';
}
