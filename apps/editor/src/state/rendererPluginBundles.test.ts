import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  MAX_RENDERER_PLUGIN_BUNDLE_BYTES,
  parseRendererPluginBundle,
  parseRendererPluginFile,
  parseStudioPluginBundle,
  parseStudioPluginFile,
  studioPluginBundleBlob,
} from './rendererPluginBundles';
import {
  MAX_RENDERER_PLUGIN_SOURCE_BYTES,
  rendererPluginDigest,
  animationPresetPluginDigest,
  type RendererPluginManifest,
  createShaderPaint,
  shaderPackPluginDigest,
} from '@ograf-editor/scene-model';

const manifest: RendererPluginManifest = {
  schemaVersion: 1,
  apiVersion: 1,
  kind: 'chart',
  id: 'example.canvas',
  version: '1.0.0',
  name: 'Canvas demo',
  presets: ['bar'],
  license: 'MIT',
};
const source =
  'throw new Error("never evaluated while installing"); export default {apiVersion:1,create(){}};';
async function bundle(
  options: { prefix?: string; source?: string; extra?: string; manifest?: unknown } = {},
) {
  const zip = new JSZip();
  const prefix = options.prefix ?? '';
  zip.file(prefix + 'manifest.json', JSON.stringify(options.manifest ?? manifest));
  zip.file(prefix + 'renderer.js', options.source ?? source);
  zip.file(prefix + 'LICENSE.txt', 'MIT license text');
  if (options.extra) zip.file(options.extra, 'extra');
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
describe('renderer plugin package import', () => {
  it('rejects oversized files before reading their bytes', async () => {
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    await expect(
      parseRendererPluginFile({
        name: 'canvas.ogsplugin.zip',
        size: MAX_RENDERER_PLUGIN_BUNDLE_BYTES + 1,
        arrayBuffer,
      }),
    ).rejects.toThrow(/exceeds 8 MiB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it.each([
    'canvas.ografplugin.zip',
    'canvas.zip',
    'graphics.ograf.zip',
    'canvas.ogsplugin.zip.txt',
  ])('rejects %s before reading its bytes', async (name) => {
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    await expect(parseRendererPluginFile({ name, size: 0, arrayBuffer })).rejects.toThrow(
      /OGS plugin bundle.*\.ogsplugin\.zip/,
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it('accepts the canonical OGS plugin suffix without executing its source', async () => {
    const data = await bundle();
    const arrayBuffer = vi.fn(() => Promise.resolve(data));
    const snapshot = await parseRendererPluginFile({
      name: 'canvas.ogsplugin.zip',
      size: data.byteLength,
      arrayBuffer,
    });
    expect(snapshot.source).toBe(source);
    expect(arrayBuffer).toHaveBeenCalledExactlyOnceWith();
  });
  it('parses and content-pins all package bytes without executing code', async () => {
    const snapshot = await parseRendererPluginBundle(await bundle());
    expect(snapshot.source).toBe(source);
    expect(snapshot.licenseText).toBe('MIT license text');
    expect(snapshot.sha256).toBe(rendererPluginDigest(snapshot));
  });
  it('accepts one enclosing folder as well as a flat ZIP', async () => {
    expect(
      (await parseRendererPluginBundle(await bundle({ prefix: 'canvas-plugin/' }))).manifest.id,
    ).toBe(manifest.id);
  });
  it('rejects nested package directories', async () => {
    await expect(
      parseRendererPluginBundle(await bundle({ prefix: 'outer/inner/' })),
    ).rejects.toThrow(/one enclosing directory/);
  });
  it.each([
    'import something from "./library.js"; export default something;',
    'export default {create:()=>import("https://example.com/plugin.js")};',
    'export const other = {};',
  ])('rejects non-bundled or unsupported module entries before trust', async (code) => {
    await expect(parseRendererPluginBundle(await bundle({ source: code }))).rejects.toThrow(
      /self-contained|default-export/,
    );
  });
  it('rejects archives with extra executable assets', async () => {
    await expect(parseRendererPluginBundle(await bundle({ extra: 'other.js' }))).rejects.toThrow(
      /contains only/,
    );
  });
  it('rejects unsupported provider APIs', async () => {
    await expect(
      parseRendererPluginBundle(await bundle({ manifest: { ...manifest, apiVersion: 2 } })),
    ).rejects.toThrow(/apiVersion/);
  });
  it('rejects traversal before archive normalization can erase it', async () => {
    await expect(parseRendererPluginBundle(await bundle({ prefix: '../bad/' }))).rejects.toThrow(
      /traversal/,
    );
  });
  it('rejects forged excessive inflate sizes before decoding', async () => {
    const data = await bundle();
    const bytes = new Uint8Array(data);
    const view = new DataView(data);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 0xffffffff, true);
        break;
      }
    }
    await expect(parseRendererPluginBundle(data)).rejects.toThrow(/oversized/);
  });
  it('bounds actual inflate output even when the archive understates its size', async () => {
    const data = await bundle({ source: 'x'.repeat(MAX_RENDERER_PLUGIN_SOURCE_BYTES + 32768) });
    const bytes = new Uint8Array(data);
    const view = new DataView(data);
    // Leave compressed bytes intact but understate the oversized source's declared size.
    for (let i = 0; i < bytes.length - 46; i++) {
      const signature = view.getUint32(i, true);
      const nameStart = signature === 0x02014b50 ? i + 46 : i + 30;
      if (
        [0x02014b50, 0x04034b50].includes(signature) &&
        new TextDecoder().decode(bytes.subarray(nameStart, nameStart + 11)) === 'renderer.js'
      )
        view.setUint32(i + (signature === 0x02014b50 ? 24 : 22), 1, true);
    }
    await expect(parseRendererPluginBundle(data)).rejects.toThrow(/size limit/);
  });
});

const animationManifest = {
  schemaVersion: 1,
  apiVersion: 1,
  kind: 'animation-presets',
  id: 'example.motion',
  version: '1.0.0',
  name: 'Motion presets',
  license: 'MIT',
};
const animationPresets = [
  {
    id: 'fade',
    name: 'Fade',
    tracks: {
      in: [
        {
          property: 'opacity',
          mode: 'factor',
          keys: [
            { at: 0, value: 0 },
            { at: 1, value: 'on-air' },
          ],
        },
      ],
    },
  },
];
async function animationBundle(
  options: { extra?: string; presets?: unknown; manifest?: unknown; prefix?: string } = {},
) {
  const zip = new JSZip(),
    prefix = options.prefix ?? '';
  zip.file(prefix + 'manifest.json', JSON.stringify(options.manifest ?? animationManifest));
  zip.file(prefix + 'presets.json', JSON.stringify(options.presets ?? animationPresets));
  zip.file(prefix + 'LICENSE.txt', 'MIT data pack');
  if (options.extra) zip.file(options.extra, 'throw new Error("must not execute")');
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
describe('multi-kind Studio plugin dispatcher', () => {
  it('loads a shader JSON pack without creating a GPU context and roundtrips its exact hash', async () => {
    const shaders = [
      {
        id: '01',
        name: 'White',
        targets: ['fill', 'outline', 'effect'],
        paint: createShaderPaint({
          fragmentSource: 'void mainImage(out vec4 color, in vec2 coord) { color=vec4(1.0); }',
        }),
      },
    ];
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        ...animationManifest,
        kind: 'shader-pack',
        id: 'example.shaders',
        name: 'Shaders',
        license: 'CC0-1.0',
      }),
    );
    zip.file('shaders.json', JSON.stringify(shaders));
    zip.file('LICENSE.txt', 'CC0 fixture');
    const createElement = vi.fn(() => {
      throw new Error('GPU must not run during import');
    });
    vi.stubGlobal('document', { createElement });
    try {
      const snapshot = await parseStudioPluginBundle(
        await zip.generateAsync({ type: 'arraybuffer' }),
      );
      expect(snapshot.manifest.kind).toBe('shader-pack');
      if (!('shaders' in snapshot)) throw new Error('Expected shaders.');
      expect(snapshot.shaders).toEqual(shaders);
      expect(snapshot.sha256).toBe(shaderPackPluginDigest(snapshot));
      const encoded = await studioPluginBundleBlob(snapshot);
      expect((await parseStudioPluginBundle(await encoded.arrayBuffer())).sha256).toBe(
        snapshot.sha256,
      );
      await expect(parseRendererPluginBundle(await encoded.arrayBuffer())).rejects.toThrow(
        /chart renderer/,
      );
      expect(createElement).not.toHaveBeenCalled();
      zip.file('renderer.js', 'export default {};');
      await expect(
        parseStudioPluginBundle(await zip.generateAsync({ type: 'arraybuffer' })),
      ).rejects.toThrow(/contains only/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('loads and hashes JSON presets without a JavaScript module or execution', async () => {
    const data = await animationBundle({ prefix: 'motion/' });
    const parsed = await parseStudioPluginBundle(data);
    expect(parsed.manifest.kind).toBe('animation-presets');
    if (!('presets' in parsed)) throw new Error('Expected preset data.');
    expect(parsed.presets).toEqual(animationPresets);
    expect(parsed.sha256).toBe(animationPresetPluginDigest(parsed));
    expect('source' in parsed).toBe(false);
    expect(
      (
        await parseStudioPluginFile({
          name: 'motion.ogsplugin.zip',
          size: data.byteLength,
          arrayBuffer: async () => data,
        })
      ).sha256,
    ).toBe(parsed.sha256);
    await expect(parseRendererPluginBundle(data)).rejects.toThrow(/chart renderer/);
    const recreated = await studioPluginBundleBlob(parsed);
    expect((await parseStudioPluginBundle(await recreated.arrayBuffer())).sha256).toBe(
      parsed.sha256,
    );
  });
  it('dispatches old chart bundles unchanged', async () => {
    const parsed = await parseStudioPluginBundle(await bundle());
    expect(parsed.manifest.kind).toBe('chart');
    if (!('source' in parsed)) throw new Error('Expected source.');
    expect(parsed.source).toBe(source);
  });
  it('rejects unknown kinds and executable extras in data packs', async () => {
    await expect(
      parseStudioPluginBundle(
        await animationBundle({ manifest: { ...animationManifest, kind: 'unknown' } }),
      ),
    ).rejects.toThrow(/Unsupported.*kind/);
    await expect(
      parseStudioPluginBundle(await animationBundle({ extra: 'renderer.js' })),
    ).rejects.toThrow(/contains only/);
  });
  it('applies the same traversal and inflate preflight to preset packs', async () => {
    await expect(
      parseStudioPluginBundle(await animationBundle({ prefix: '../motion/' })),
    ).rejects.toThrow(/traversal/);
    const data = await animationBundle(),
      bytes = new Uint8Array(data),
      view = new DataView(data);
    for (let index = 0; index < bytes.length - 46; index++)
      if (view.getUint32(index, true) === 0x02014b50) {
        view.setUint32(index + 24, 0xffffffff, true);
        break;
      }
    await expect(parseStudioPluginBundle(data)).rejects.toThrow(/oversized/);
  });
  it('rejects string formulas rather than interpreting preset values as code', async () => {
    await expect(
      parseStudioPluginBundle(
        await animationBundle({
          presets: [
            {
              ...animationPresets[0],
              tracks: {
                in: [
                  {
                    property: 'opacity',
                    mode: 'factor',
                    keys: [
                      { at: 0, value: 'globalThis.alert(1)' },
                      { at: 1, value: 1 },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/value|number|on-air/i);
  });
});
