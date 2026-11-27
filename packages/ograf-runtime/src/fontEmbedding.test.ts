import { describe, expect, it } from 'vitest';
import { declareFontFaces, unicodeRangeCovers, usedFontFaceCss } from './fontEmbedding';

interface FakeFace {
  family: string;
  src: string;
  unicodeRange?: string;
}

function fontFaceRule(face: FakeFace) {
  const descriptors: Record<string, string> = {
    'font-family': face.family,
    src: face.src,
    'font-weight': '100 900',
    ...(face.unicodeRange ? { 'unicode-range': face.unicodeRange } : {}),
  };
  const names = Object.keys(descriptors);
  return {
    type: 5,
    style: {
      length: names.length,
      item: (index: number) => names[index]!,
      getPropertyValue: (name: string) => descriptors[name] ?? '',
    },
  };
}

/** A layer in a document whose stylesheets hold `faces`, with the page's fonts served as bytes. */
function layerIn(options: {
  faces: FakeFace[];
  shadowFaces?: FakeFace[];
  text: string;
  inherited: string;
  inline?: string[];
  missing?: Set<string>;
}) {
  const asked: string[] = [];
  const view = {
    getComputedStyle: () => ({ fontFamily: options.inherited }),
    fetch: async (url: string) => {
      asked.push(url);
      return options.missing?.has(url)
        ? { ok: false, status: 404 }
        : { ok: true, status: 200, blob: async () => `bytes of ${url}` };
    },
    FileReader: class {
      result = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(blob: string) {
        this.result = `data:font/woff2;base64,${btoa(blob)}`;
        this.onload?.();
      }
    },
    CSSStyleSheet: class {
      cssRules: unknown[] = [];
      replaceSync(css: string) {
        this.cssRules = JSON.parse(css).map(fontFaceRule);
      }
    },
  };
  const owner = {
    baseURI: 'https://air.test/graphic/index.html',
    defaultView: view,
    styleSheets: [
      {
        href: 'https://air.test/graphic/fonts/faces.css',
        cssRules: options.faces.map(fontFaceRule),
      },
    ],
  };
  const shadow = options.shadowFaces
    ? { styleSheets: [{ href: null, cssRules: options.shadowFaces.map(fontFaceRule) }] }
    : owner;
  const root = {
    ownerDocument: owner,
    textContent: options.text,
    getRootNode: () => shadow,
    querySelectorAll: (selector: string) =>
      selector === '[font-family]'
        ? []
        : (options.inline ?? []).map((fontFamily) => ({ style: { fontFamily } })),
  } as unknown as HTMLElement;
  return { root, asked, owner: owner as unknown as Document };
}

const embedded = (url: string) => `data:font/woff2;base64,${btoa(`bytes of ${url}`)}`;

describe('unicodeRangeCovers', () => {
  it('finds whether a face has a glyph for any character of the text', () => {
    expect(unicodeRangeCovers('U+0000-00FF, U+0131', 'Alex')).toBe(true);
    expect(unicodeRangeCovers('U+0400-045F', 'Alex')).toBe(false);
    expect(unicodeRangeCovers('U+4??', 'Привет')).toBe(true);
    expect(unicodeRangeCovers('U+1F600-1F64F', 'ok 😀')).toBe(true);
  });

  it('takes a face without a range as covering every character', () => {
    expect(unicodeRangeCovers('', 'Alex')).toBe(true);
  });
});

describe('usedFontFaceCss', () => {
  it('embeds the faces of the families the layer inherits or sets, and no others', async () => {
    const { root, asked } = layerIn({
      faces: [
        { family: '"Roboto Condensed"', src: 'url("roboto.woff2") format("woff2")' },
        { family: 'Inter', src: 'url(inter.woff2)' },
        { family: 'Unused Display', src: 'url(unused.woff2)' },
      ],
      text: 'Alex Morgan',
      inherited: 'Roboto Condensed, Arial Narrow, sans-serif',
      inline: ["'Inter', sans-serif"],
    });

    const css = await usedFontFaceCss(root);

    expect(asked).toEqual([
      'https://air.test/graphic/fonts/roboto.woff2',
      'https://air.test/graphic/fonts/inter.woff2',
    ]);
    expect(css).toContain(`src: url("${embedded('https://air.test/graphic/fonts/roboto.woff2')}")`);
    expect(css).toContain('font-family: "Roboto Condensed";');
    expect(css).not.toContain('Unused Display');
  });

  it('reads the faces of the shadow tree a layer of an exported graphic is in', async () => {
    const { root, asked } = layerIn({
      faces: [],
      shadowFaces: [{ family: 'Roboto Condensed', src: 'url("resources/roboto.woff2")' }],
      text: 'Alex Morgan',
      inherited: 'Roboto Condensed',
    });

    await expect(usedFontFaceCss(root)).resolves.toContain('@font-face');
    expect(asked).toEqual(['https://air.test/graphic/resources/roboto.woff2']);
  });

  it('offers a face in the format a browser of today reads first', async () => {
    const { root, asked } = layerIn({
      faces: [
        {
          family: 'Inter',
          src: 'local("Inter"), url(inter.ttf) format("truetype"), url(inter.woff2) format("woff2")',
        },
      ],
      text: 'Alex',
      inherited: 'Inter',
    });

    await usedFontFaceCss(root);

    expect(asked).toEqual(['https://air.test/graphic/fonts/inter.woff2']);
  });

  it('leaves out a face that has no character of the text, and a face already embedded as it is', async () => {
    const data = 'url("data:font/woff2;base64,AAAA")';
    const { root, asked } = layerIn({
      faces: [
        { family: 'Inter', src: 'url(inter-cyrillic.woff2)', unicodeRange: 'U+0400-045F' },
        { family: 'Inter', src: data, unicodeRange: 'U+0000-00FF' },
      ],
      text: 'Alex',
      inherited: 'Inter',
    });

    const css = await usedFontFaceCss(root);

    expect(asked).toEqual([]);
    expect(css).toContain(`src: ${data};`);
    expect(css).not.toContain('cyrillic');
  });

  it('reads each font once, however many pictures ask for it', async () => {
    const { root, asked } = layerIn({
      faces: [{ family: 'Inter', src: 'url(inter.woff2)' }],
      text: 'Alex',
      inherited: 'Inter',
    });

    await usedFontFaceCss(root);
    await usedFontFaceCss(root);

    expect(asked).toHaveLength(1);
  });

  it('leaves out a font that cannot be read, as the page falls back, and asks again for the next picture', async () => {
    const missing = new Set(['https://air.test/graphic/fonts/inter.woff2']);
    const { root, asked } = layerIn({
      faces: [
        { family: 'Inter', src: 'url(inter.woff2)' },
        { family: 'Inter', src: 'url(inter-italic.woff2)' },
      ],
      text: 'Alex',
      inherited: 'Inter',
      missing,
    });

    const css = await usedFontFaceCss(root);
    expect(css).toContain(embedded('https://air.test/graphic/fonts/inter-italic.woff2'));
    expect(css.match(/@font-face/g)).toHaveLength(1);

    missing.clear();
    expect((await usedFontFaceCss(root)).match(/@font-face/g)).toHaveLength(2);
    expect(asked.filter((url) => url.endsWith('/inter.woff2'))).toHaveLength(2);
  });

  it('includes a face that script registered once it is declared, until it is withdrawn', async () => {
    const { root, owner } = layerIn({ faces: [], text: 'Alex', inherited: 'Project Sans' });
    const face = [{ family: 'Project Sans', src: 'url("data:font/woff2;base64,BBBB")' }];

    await expect(usedFontFaceCss(root)).resolves.toBe('');
    const withdraw = declareFontFaces(owner, 'project', JSON.stringify(face));
    await expect(usedFontFaceCss(root)).resolves.toContain('font-family: Project Sans;');
    withdraw();
    await expect(usedFontFaceCss(root)).resolves.toBe('');
  });
});
