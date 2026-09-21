import type { Asset } from '@ograf-editor/scene-model';

export function projectFontFamily(asset: Asset): string {
  return asset.fontFamily || asset.name.replace(/\.[^.]+$/, '');
}

function cssString(value: string): string {
  return `"${value.replace(/[\\"\u0000-\u001f\u007f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}"`;
}

/** JS-registered FontFace objects are invisible to html-to-image's stylesheet discovery. */
export function projectFontFaceCss(assets: readonly Asset[]): string {
  const descriptor = (value: string) =>
    value.replace(/[\\;{}\r\n\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
  return assets
    .filter((asset) => asset.kind === 'font')
    .map(
      (asset) =>
        `@font-face{font-family:${cssString(projectFontFamily(asset))};src:url(${cssString(asset.dataUri)});font-weight:${descriptor(asset.fontWeight || '100 900')};font-style:${descriptor(asset.fontStyle || 'normal')};}`,
    )
    .join('\n');
}

type FontOwner = Document & { defaultView: (Window & { FontFace: typeof FontFace }) | null };
interface RegisteredFace {
  family: string;
  face: FontFace;
  ready: Promise<void>;
  users: number;
}
const registered = new WeakMap<Document, Map<string, RegisteredFace>>();

export function hasLoadedProjectFont(target: Document, family: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .toLowerCase();
  return [...(registered.get(target)?.values() ?? [])].some(
    (entry) => entry.face.status === 'loaded' && normalize(entry.family) === normalize(family),
  );
}

/** Main canvas, detached panes and temporary captures share faces only within the same document. */
export function acquireProjectFonts(target: Document, assets: readonly Asset[]) {
  const entries: Array<[string, RegisteredFace]> = [];
  const FontFaceCtor = (target as FontOwner).defaultView?.FontFace;
  let faces = registered.get(target);
  if (!faces) {
    faces = new Map();
    registered.set(target, faces);
  }
  if (target.fonts && FontFaceCtor) {
    for (const asset of assets.filter((asset) => asset.kind === 'font')) {
      const family = projectFontFamily(asset),
        weight = asset.fontWeight || '100 900',
        style = asset.fontStyle || 'normal';
      const key = JSON.stringify([family, weight, style, asset.dataUri]);
      let entry = faces.get(key);
      if (!entry) {
        try {
          const face = new FontFaceCtor(family, `url(${cssString(asset.dataUri)})`, {
            weight,
            style,
          });
          // Register before loading so document.fonts.ready also observes pending project faces.
          target.fonts.add(face);
          entry = {
            family,
            face,
            users: 0,
            ready: face.load().then(
              () => undefined,
              () => undefined,
            ),
          };
          faces.set(key, entry);
        } catch {
          continue;
        } // Invalid faces retain the authored fallback stack.
      }
      entry.users++;
      entries.push([key, entry]);
    }
  }
  let disposed = false;
  return {
    ready: Promise.all(entries.map(([, entry]) => entry.ready)).then(() => undefined),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [key, entry] of entries)
        if (--entry.users === 0) {
          target.fonts.delete(entry.face);
          faces.delete(key);
        }
    },
  };
}

export async function withProjectFonts<T>(
  target: Document,
  assets: readonly Asset[],
  render: () => Promise<T>,
): Promise<T> {
  const lease = acquireProjectFonts(target, assets);
  try {
    await lease.ready;
    return await render();
  } finally {
    lease.dispose();
  }
}
