import type { CompiledFontResource as CompiledFont } from '@ograf-editor/ograf-types';

type FontFaceConstructor = new (
  family: string,
  source: string,
  descriptors?: FontFaceDescriptors,
) => FontFace;

export interface DocumentFontTarget {
  fonts?: Pick<FontFaceSet, 'add'>;
  defaultView?: { FontFace?: FontFaceConstructor } | null;
}

/** Faces already registered per document, keyed by family/weight/style/source. */
const registeredFaces = new WeakMap<object, Map<string, FontFace>>();

export function fontFaceKey(font: CompiledFont): string {
  return `${font.family}|${font.weight || '100 900'}|${font.style || 'normal'}|${font.source}`;
}

/**
 * Browsers ignore `@font-face` rules declared inside a shadow root, so packaged faces are also
 * registered on the owning document, where shadow-tree text resolves them. Resolves once every
 * face has settled; a face that fails to load falls back to the authored font stack.
 */
export function registerDocumentFonts(
  target: DocumentFontTarget | null | undefined,
  fonts: readonly CompiledFont[],
): Promise<void> {
  const fontSet = target?.fonts;
  const FontFaceCtor = target?.defaultView?.FontFace;
  if (!target || !fontSet || !FontFaceCtor || fonts.length === 0) return Promise.resolve();

  let faces = registeredFaces.get(target);
  if (!faces) {
    faces = new Map();
    registeredFaces.set(target, faces);
  }
  const pending = fonts.map((font) => {
    const key = fontFaceKey(font);
    let face = faces.get(key);
    if (!face) {
      face = new FontFaceCtor(font.family, `url(${JSON.stringify(font.source)})`, {
        weight: font.weight || '100 900',
        style: font.style || 'normal',
        display: 'block',
      });
      faces.set(key, face);
      fontSet.add(face);
    }
    return face.load().then(
      () => undefined,
      () => undefined,
    );
  });
  return Promise.all(pending).then(() => undefined);
}
