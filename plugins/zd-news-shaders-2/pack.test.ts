import { readFile, readdir } from 'node:fs/promises';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createShaderPackPluginSnapshot,
  inspectShaderElement,
  isShaderPackPluginSnapshot,
  resolveShaderPackPresetPaint,
  resolveShaderParameters,
  validateShaderPackPluginSnapshot,
  type ShaderPackPluginManifest,
  type ShaderPackPluginSnapshot,
} from '@ograf-editor/scene-model';
import { parseStudioPluginBundle } from '../../apps/editor/src/state/rendererPluginBundles';
import { numberedShaderPackPreset } from '../../scripts/shaderPackSourcePresets';

const expectedFiles = [
  '21-world-globe.glsl',
  '22-radar-sweep.glsl',
  '23-equalizer-bars.glsl',
  '24-led-matrix.glsl',
  '25-halftone-wave.glsl',
  '26-light-leaks.glsl',
  '27-confetti.glsl',
  '28-snowfall.glsl',
  '29-lightning-storm.glsl',
  '30-fireworks.glsl',
  '31-topo-lines.glsl',
  '32-progress-ring.glsl',
  '33-live-pulse.glsl',
  '34-kaleidoscope.glsl',
  '35-stage-spotlights.glsl',
  '36-silk-ribbons.glsl',
  '37-plexus-network.glsl',
  '38-tile-reveal.glsl',
  '39-neon-sign.glsl',
  '40-heat-shimmer.glsl',
];
const effectIds = ['led-matrix', 'tile-reveal', 'neon-sign', 'heat-shimmer'];

async function loadSourcePack(directory: URL) {
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', directory), 'utf8'),
  ) as ShaderPackPluginManifest;
  const licenseText = await readFile(new URL('LICENSE.txt', directory), 'utf8');
  const files = (await readdir(new URL('src/', directory)))
    .filter((file) => /^\d{2}-.*\.glsl$/.test(file))
    .sort();
  const shaders = await Promise.all(
    files.map(async (file) =>
      numberedShaderPackPreset(
        file,
        await readFile(new URL(`src/${file}`, directory), 'utf8'),
        manifest.license,
      ),
    ),
  );
  return {
    files,
    snapshot: createShaderPackPluginSnapshot({ manifest, shaders, licenseText }),
  };
}

describe('ZD News Shaders 2 portable pack', () => {
  let pack: ShaderPackPluginSnapshot;
  let files: string[];

  beforeAll(async () => {
    const result = await loadSourcePack(new URL('./', import.meta.url));
    pack = result.snapshot;
    files = result.files;
  });

  it('contains exactly the second twenty numbered sources with an independent identity', () => {
    expect(files).toEqual(expectedFiles);
    expect(pack.shaders).toHaveLength(20);
    expect(pack.manifest).toMatchObject({
      kind: 'shader-pack',
      id: 'ograf.zd-news-shaders-2',
      version: '1.0.0',
      name: 'ZD News Shaders 2',
      license: 'CC0-1.0',
    });
    expect(pack.licenseText).toContain('CC0');
    expect(validateShaderPackPluginSnapshot(pack)).toEqual([]);
    expect(pack.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const preset of pack.shaders) {
      expect(preset.license).toBe('CC0-1.0');
      expect(preset.paint.fragmentSource).toContain('CC0-1.0');
    }
  });

  it('classifies the four incoming-layer shaders as effects and keeps other presets as paints', () => {
    expect(
      pack.shaders.filter((preset) => preset.targets.includes('effect')).map((p) => p.id),
    ).toEqual(effectIds);
    for (const preset of pack.shaders) {
      expect(preset.targets).toEqual(
        effectIds.includes(preset.id) ? ['effect'] : ['fill', 'outline'],
      );
      expect(preset.paint.inputImage).toBeUndefined();
      for (const target of preset.targets) {
        expect(
          inspectShaderElement(preset.paint, { channel0Provided: target === 'effect' }).errors,
        ).toEqual([]);
      }
    }
    const controls = pack.shaders.flatMap(
      (preset) =>
        inspectShaderElement(preset.paint, { channel0Provided: preset.targets.includes('effect') })
          .parameters,
    );
    expect(controls).toHaveLength(223);
  });

  it('retains portable attribution on every applied copy without sharing mutable paints', () => {
    for (const preset of pack.shaders) {
      for (const target of preset.targets) {
        const paint = resolveShaderPackPresetPaint(pack, preset.id, target);
        expect(paint.packProvenance).toMatchObject({
          reference: {
            id: pack.manifest.id,
            version: pack.manifest.version,
            sha256: pack.sha256,
          },
          presetId: preset.id,
          packName: pack.manifest.name,
          license: 'CC0-1.0',
          licenseText: pack.licenseText,
        });
        expect(paint.fragmentSource).toBe(preset.paint.fragmentSource);
        expect(paint.parameters).toEqual(preset.paint.parameters);
        expect(paint.parameters).not.toBe(preset.paint.parameters);
      }
    }
    const fill = resolveShaderPackPresetPaint(pack, 'world-globe', 'fill');
    const outline = resolveShaderPackPresetPaint(pack, 'world-globe', 'outline');
    fill.parameters.globeRadius = 0.2;
    expect(outline.parameters.globeRadius).toBeUndefined();
    expect(pack.shaders[0]!.paint.parameters.globeRadius).toBeUndefined();
    expect(resolveShaderParameters(outline).globeRadius).toBe(0.38);
    expect(() => resolveShaderPackPresetPaint(pack, 'neon-sign', 'fill')).toThrow('target');
  });

  it('round-trips the package through the same ZIP parser used by the Plugins installer', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(pack.manifest));
    zip.file('shaders.json', JSON.stringify(pack.shaders));
    zip.file('LICENSE.txt', pack.licenseText);
    const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    const parsed = await parseStudioPluginBundle(bytes);
    expect(isShaderPackPluginSnapshot(parsed)).toBe(true);
    expect(parsed).toEqual(pack);
    expect(validateShaderPackPluginSnapshot(parsed)).toEqual([]);
  });

  it('keeps the original twenty-shader pack separate and its Signal Glitch effect intact', async () => {
    const original = await loadSourcePack(new URL('../zd-news-shaders/', import.meta.url));
    expect(original.files).toHaveLength(20);
    expect(original.files.map((file) => Number(file.slice(0, 2)))).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(original.snapshot.manifest.id).toBe('ograf.zd-news-shaders');
    expect(original.snapshot.manifest.id).not.toBe(pack.manifest.id);
    expect(
      original.snapshot.shaders
        .filter((preset) => preset.targets.includes('effect'))
        .map((p) => p.id),
    ).toEqual(['signal-glitch']);
    expect(validateShaderPackPluginSnapshot(original.snapshot)).toEqual([]);
  });
});

describe('numbered GLSL source classification', () => {
  it('uses shader input requirements rather than a hardcoded file number', () => {
    const effect = numberedShaderPackPreset(
      '07-incoming-layer.glsl',
      '// Incoming Layer - Image pass.\nvoid mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,p/iResolution.xy);}',
      'CC0-1.0',
    );
    const fill = numberedShaderPackPreset(
      '20-solid-finish.glsl',
      '// Solid Finish - Image pass.\nvoid mainImage(out vec4 c,in vec2 p){c=vec4(1.0);}',
      'CC0-1.0',
    );
    expect(effect.targets).toEqual(['effect']);
    expect(fill.targets).toEqual(['fill', 'outline']);
  });

  it.each([
    'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel1,p/iResolution.xy);}',
    'uniform float custom;\nvoid mainImage(out vec4 c,in vec2 p){c=vec4(custom);}',
    'void mainImage(out vec4 c,in vec2 p){c=vec4(iMouse.xy,0.0,1.0);}',
  ])('rejects unsupported sources instead of silently marking them as effects', (source) => {
    expect(() => numberedShaderPackPreset('21-unsupported.glsl', source, 'CC0-1.0')).toThrow();
  });
});
