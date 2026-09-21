import { describe, expect, it } from 'vitest';
import type { Asset } from '@ograf-editor/scene-model';
import { acquireProjectFonts, projectFontFaceCss, withProjectFonts } from './projectFonts';

const asset: Asset = {
  id: 'font',
  name: 'Custom.woff2',
  kind: 'font',
  mimeType: 'font/woff2',
  dataUri: 'data:font/woff2;base64,eA==',
};
function target() {
  const created: Face[] = [];
  class Face {
    finish!: () => void;
    promise = new Promise<Face>((resolve) => {
      this.finish = () => resolve(this);
    });
    readonly family: string;
    readonly source: string;
    readonly descriptors: FontFaceDescriptors;
    constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
      created.push(this);
    }
    load() {
      return this.promise;
    }
  }
  const fonts = new Set<Face>();
  return {
    document: { fonts, defaultView: { FontFace: Face } } as unknown as Document,
    fonts,
    created,
  };
}
describe('project font lifetime', () => {
  it('registers immediately, shares faces between canvas/capture, and removes only the final owner', async () => {
    const owner = target();
    const canvas = acquireProjectFonts(owner.document, [asset]);
    const capture = acquireProjectFonts(owner.document, [asset]);
    expect(owner.created).toHaveLength(1);
    expect(owner.fonts.size).toBe(1);
    expect(owner.created[0]).toMatchObject({
      family: 'Custom',
      descriptors: { weight: '100 900', style: 'normal' },
    });
    canvas.dispose();
    expect(owner.fonts.size).toBe(1);
    owner.created[0]!.finish();
    await capture.ready;
    capture.dispose();
    capture.dispose();
    expect(owner.fonts.size).toBe(0);
  });
  it('cleans up pending loads without re-adding stale project fonts and isolates detached windows', async () => {
    const main = target(),
      detached = target();
    const old = acquireProjectFonts(main.document, [asset]);
    const other = acquireProjectFonts(detached.document, [asset]);
    old.dispose();
    main.created[0]!.finish();
    await old.ready;
    expect(main.fonts.size).toBe(0);
    expect(detached.fonts.size).toBe(1);
    detached.created[0]!.finish();
    await other.ready;
    other.dispose();
    expect(detached.fonts.size).toBe(0);
  });
  it('waits for non-active composition fonts before capture and releases on rendering failure', async () => {
    const owner = target();
    let rendered = false;
    const capture = withProjectFonts(owner.document, [asset], async () => {
      rendered = true;
      throw Error('capture failed');
    });
    expect(rendered).toBe(false);
    owner.created[0]!.finish();
    await expect(capture).rejects.toThrow('capture failed');
    expect(rendered).toBe(true);
    expect(owner.fonts.size).toBe(0);
  });
  it('escapes quoted/backslash font names and excludes non-font assets', () => {
    const css = projectFontFaceCss([
      { ...asset, fontFamily: 'A"B\\C' },
      { ...asset, kind: 'image', name: 'ignored' },
    ]);
    expect(css).toContain('font-family:"A\\22 B\\5c C"');
    expect(css.match(/@font-face/g)).toHaveLength(1);
  });
});
