import type { ExportArtifacts } from './buildExportArtifacts';

/** A portable root-level HTML name derived from the template or coordinated set name. */
export function getOfflinePreviewFileName(artifacts: Pick<ExportArtifacts, 'manifest'>): string {
  let name = (artifacts.manifest.name || '').normalize('NFC');
  name = name
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .replace(/\.html?$/i, '')
    .replace(/[. ]+$/g, '');
  // Leave room for the extension on Windows and UTF-8 filesystems without splitting Unicode.
  let bounded = '';
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of name) {
    const nextBytes = encoder.encode(character).byteLength;
    if (bounded.length + character.length > 160 || bytes + nextBytes > 200) break;
    bounded += character;
    bytes += nextBytes;
  }
  name = bounded.replace(/[. ]+$/g, '') || 'OGraf Preview';
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(name))
    name = `_${name}`;
  return `${name}.html`;
}

/** Refuse file/directory aliases that would collide when extracted on Windows. */
export function assertOfflinePreviewFileAvailable(paths: Iterable<string>, fileName: string): void {
  const windowsName = (value: string) =>
    value
      .normalize('NFC')
      .replace(/[. ]+$/g, '')
      .toLowerCase();
  const expected = windowsName(fileName);
  for (const path of paths) {
    const root = path.replaceAll('\\', '/').split('/')[0]!;
    if (windowsName(root) === expected)
      throw new Error(`Cannot add the offline preview: the package already contains ${fileName}.`);
  }
}
