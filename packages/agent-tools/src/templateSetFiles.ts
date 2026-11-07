import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES,
  type TemplateSetArchiveMode,
  type TemplateSetArchiveResult,
} from './templateSetStorage';

/** Validate the bounded archive transfer before publishing any bytes to disk. */
export async function decodeTemplateSetArchive(
  value: Record<string, unknown>,
  expectedRevision: string,
  archiveMode: TemplateSetArchiveMode,
): Promise<{ data: Buffer; metadata: Omit<TemplateSetArchiveResult, 'archiveBase64'> }> {
  const schemaVersion = archiveMode === 'compact' ? 6 : 5;
  if (value.revision !== expectedRevision)
    throw new Error(
      'Template-set revision changed while saving. Re-read the set and retry intentionally.',
    );
  if (
    value.archiveMode !== archiveMode ||
    value.schemaVersion !== schemaVersion ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    !Number.isSafeInteger(value.templateCount) ||
    (value.templateCount as number) < 0 ||
    (value.templateCount as number) > 256
  )
    throw new Error('Studio returned invalid template-set archive metadata.');
  if (
    !Number.isSafeInteger(value.archiveBytes) ||
    (value.archiveBytes as number) <= 0 ||
    (value.archiveBytes as number) > MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES ||
    typeof value.archiveBase64 !== 'string' ||
    value.archiveBase64.length > Math.ceil(MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES / 3) * 4
  )
    throw new Error(
      'MCP template-set saves support archives up to 64 MiB; use Studio Save Template Set for larger files.',
    );
  const data = Buffer.from(value.archiveBase64, 'base64');
  if (data.byteLength !== value.archiveBytes || data.toString('base64') !== value.archiveBase64)
    throw new Error('Studio returned an incomplete or malformed template-set archive.');
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (typeof value.sha256 !== 'string' || value.sha256 !== sha256)
    throw new Error('Template-set archive checksum does not match. Nothing was saved.');
  const zip = await JSZip.loadAsync(data);
  const entry = zip.file('manifest.json');
  if (!entry) throw new Error('Template-set archive is missing its manifest.');
  // The browser archive builder enforces this same limit; bound the transfer verifier as well.
  const advertised = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: unknown } })._data
    ?.uncompressedSize;
  if (!Number.isSafeInteger(advertised) || (advertised as number) > 4 * 1024 * 1024)
    throw new Error('Template-set archive manifest exceeds 4 MiB.');
  const manifestBytes = await entry.async('uint8array');
  if (manifestBytes.byteLength > 4 * 1024 * 1024)
    throw new Error('Template-set archive manifest exceeds 4 MiB.');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Record<string, unknown>;
  if (
    manifest.format !== 'ograf-template-set' ||
    manifest.schemaVersion !== schemaVersion ||
    manifest.name !== value.name ||
    !Array.isArray(manifest.templates) ||
    manifest.templates.length !== value.templateCount
  )
    throw new Error('Template-set archive manifest does not match the requested snapshot.');
  return {
    data,
    metadata: {
      revision: expectedRevision,
      name: value.name,
      archiveMode,
      schemaVersion,
      archiveBytes: data.byteLength,
      templateCount: value.templateCount as number,
      sha256,
    },
  };
}
