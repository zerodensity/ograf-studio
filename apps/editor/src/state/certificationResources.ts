import type { ExportArtifacts } from '@ograf-editor/codegen';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  css: 'text/css',
  txt: 'text/plain',
};

/** Serve exactly the bytes the ZIP writer receives, with no access to editable source assets. */
export function createCertificationResourceUrls(
  resources: ExportArtifacts['resources'],
  objectUrls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
): { urls: Record<string, string>; dispose: () => void } {
  const created: string[] = [];
  const dispose = () => {
    for (const url of created.splice(0)) objectUrls.revokeObjectURL(url);
  };
  try {
    const urls = Object.fromEntries(
      resources.map((resource) => {
        const bytes = resource.base64
          ? Uint8Array.from(atob(resource.data), (character) => character.charCodeAt(0))
          : new TextEncoder().encode(resource.data);
        const extension = resource.path.split('.').at(-1)?.toLowerCase() ?? '';
        const type =
          resource.mimeType ?? MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
        const url = objectUrls.createObjectURL(new Blob([bytes], { type }));
        created.push(url);
        return [resource.path, url];
      }),
    );
    return { urls, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
