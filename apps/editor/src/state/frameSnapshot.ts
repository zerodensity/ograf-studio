export type SnapshotKind = 'alpha' | 'checker' | 'black';

const MATTE_BY_KIND: Record<SnapshotKind, string> = {
  alpha: 'transparent',
  checker: 'checker',
  black: '#000000',
};

export function snapshotMatte(kind: SnapshotKind): string {
  return MATTE_BY_KIND[kind];
}

/** `previsao-do-tempo_f045_key.png`: ASCII slug of the project name, padded frame, suffix. */
export function snapshotFileName(projectName: string, frame: number, suffix?: string): string {
  const slug =
    projectName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'ograf-frame';
  const padded = String(Math.max(0, Math.round(frame))).padStart(3, '0');
  return `${slug}_f${padded}${suffix ? `_${suffix}` : ''}.png`;
}

/** Key signal: each pixel's alpha copied into RGB, fully opaque. Returns a new buffer. */
export function alphaToKeyPixels(rgba: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const key = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3]!;
    key[i] = alpha;
    key[i + 1] = alpha;
    key[i + 2] = alpha;
    key[i + 3] = 255;
  }
  return key;
}
