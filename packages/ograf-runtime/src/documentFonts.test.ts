import { describe, expect, it } from 'vitest';
import type { CompiledFontResource } from '@ograf-editor/ograf-types';
import { registerDocumentFonts, type DocumentFontTarget } from './documentFonts';

class FakeFontFace {
  static created: FakeFontFace[] = [];
  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: FontFaceDescriptors,
  ) {
    FakeFontFace.created.push(this);
  }
  load(): Promise<this> {
    return this.source.includes('broken')
      ? Promise.reject(new Error('404'))
      : Promise.resolve(this);
  }
}

function fakeDocument() {
  const added: unknown[] = [];
  const target = {
    fonts: { add: (face: FontFace) => (added.push(face), undefined) },
    defaultView: { FontFace: FakeFontFace },
  } as unknown as DocumentFontTarget;
  return { target, added };
}

const font = (overrides: Partial<CompiledFontResource> = {}): CompiledFontResource => ({
  family: 'Barlow Condensed',
  source: 'https://cdn.example/pkg/fonts/BarlowCondensed-ExtraBold.ttf',
  mimeType: 'font/ttf',
  weight: '800',
  style: 'normal',
  ...overrides,
});

describe('registerDocumentFonts', () => {
  it('registers packaged faces on the document with their descriptors', async () => {
    FakeFontFace.created = [];
    const { target, added } = fakeDocument();
    await registerDocumentFonts(target, [font(), font({ weight: '600', source: 'fonts/a.ttf' })]);

    expect(added).toHaveLength(2);
    expect(FakeFontFace.created[0]).toMatchObject({
      family: 'Barlow Condensed',
      source: 'url("https://cdn.example/pkg/fonts/BarlowCondensed-ExtraBold.ttf")',
      descriptors: { weight: '800', style: 'normal', display: 'block' },
    });
  });

  it('does not register the same face twice for one document', async () => {
    const { target, added } = fakeDocument();
    await registerDocumentFonts(target, [font()]);
    await registerDocumentFonts(target, [font()]);
    expect(added).toHaveLength(1);
  });

  it('settles when a face fails so load() can fall back to the authored stack', async () => {
    const { target } = fakeDocument();
    await expect(
      registerDocumentFonts(target, [font({ source: 'fonts/broken.ttf' })]),
    ).resolves.toBeUndefined();
  });

  it('is a no-op without a FontFace-capable document', async () => {
    await expect(registerDocumentFonts(undefined, [font()])).resolves.toBeUndefined();
    await expect(registerDocumentFonts({}, [font()])).resolves.toBeUndefined();
  });
});
