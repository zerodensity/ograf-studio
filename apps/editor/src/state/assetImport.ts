import { createAsset, dataUriByteSize, type Asset } from '@ograf-editor/scene-model';

export async function readMediaMetadata(
  file: File,
  kind: 'audio' | 'media',
): Promise<{ durationMs?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind === 'audio' ? 'audio' : 'video');
    let settled = false;
    const finish = (result: { durationMs?: number; width?: number; height?: number } = {}) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timeout = window.setTimeout(() => finish(), 8_000);
    media.preload = 'metadata';
    media.onloadedmetadata = () =>
      finish({
        ...(Number.isFinite(media.duration) && media.duration > 0
          ? { durationMs: media.duration * 1000 }
          : {}),
        ...('videoWidth' in media && media.videoWidth > 0 && media.videoHeight > 0
          ? { width: media.videoWidth, height: media.videoHeight }
          : {}),
      });
    media.onerror = () => finish();
    media.src = url;
  });
}

/** Decode the exact resource representation used by the Resources import action. */
export async function prepareAssetImport(
  file: File,
): Promise<{ asset: Asset; width?: number; height?: number }> {
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const fontMime = (
    { woff2: 'font/woff2', woff: 'font/woff', otf: 'font/otf', ttf: 'font/ttf' } as Record<
      string,
      string
    >
  )[extension];
  const audioMime = (
    { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' } as Record<string, string>
  )[extension];
  const videoMime = ({ mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[extension];
  const mimeType = (fontMime ?? audioMime ?? videoMime ?? file.type) || 'application/octet-stream';
  const kind = fontMime
    ? 'font'
    : mimeType.startsWith('image/')
      ? 'image'
      : mimeType.startsWith('video/')
        ? 'media'
        : mimeType.startsWith('audio/')
          ? 'audio'
          : 'source';
  const metadata = kind === 'audio' || kind === 'media' ? await readMediaMetadata(file, kind) : {};
  return {
    asset: createAsset({
      name: file.name,
      kind,
      dataUri: dataUri.replace(/^data:[^;]*;/, `data:${mimeType};`),
      mimeType,
      originalFileName: file.name,
      byteSize: file.size || dataUriByteSize(dataUri),
      ...(metadata.durationMs ? { durationMs: metadata.durationMs } : {}),
      ...(fontMime
        ? {
            fontFamily: file.name.replace(/\.[^.]+$/, ''),
            fontWeight: '100 900',
            fontStyle: 'normal' as const,
          }
        : {}),
    }),
    width: metadata.width,
    height: metadata.height,
  };
}
