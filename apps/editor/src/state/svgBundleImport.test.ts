import { describe, expect, it } from 'vitest';
import { buildSvgBundle } from './svgBundleImport';

function file(name: string, type: string, content: string) {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    type,
    text: async () => content,
    arrayBuffer: async () => bytes.buffer.slice(0),
  };
}

function decodeDataUri(uri: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (character) => character.charCodeAt(0)),
  );
}

describe('Photoshop SVG bundle import', () => {
  it('embeds companion CSS, linked images, and fonts into a portable SVG', async () => {
    const result = await buildSvgBundle([
      file(
        'Reality.svg',
        'image/svg+xml',
        '<?xml-stylesheet href="reality.css"?><svg xmlns="http://www.w3.org/2000/svg"><image href="plate.png"/><text class="title">News</text></svg>',
      ),
      file(
        'reality.css',
        'text/css',
        '@font-face { font-family: "Rubik Local"; src: url("Rubik.woff2"); } .title { font-family: "Rubik Local"; fill: white; }',
      ),
      file('plate.png', 'image/png', 'png-bytes'),
      file('Rubik.woff2', 'font/woff2', 'font-bytes'),
    ]);

    const svg = decodeDataUri(result.svgAsset.dataUri);
    expect(svg).not.toContain('xml-stylesheet');
    expect(svg).toContain('<style type="text/css">');
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).toContain('data:font/woff2;base64,');
    expect(result.fontAssets[0]).toMatchObject({
      name: 'Rubik.woff2',
      fontFamily: 'Rubik Local',
      mimeType: 'font/woff2',
    });
    expect(result.warnings).toEqual([]);
  });

  it('reports unresolved relative resources without blocking the usable SVG', async () => {
    const result = await buildSvgBundle([
      file(
        'graphic.svg',
        'image/svg+xml',
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="missing.png"/></svg>',
      ),
    ]);
    expect(result.warnings).toEqual(['Unresolved SVG/CSS companion resource: missing.png']);
  });
});
