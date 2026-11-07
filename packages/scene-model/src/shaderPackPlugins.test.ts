import { describe, expect, it } from 'vitest';
import { createShaderPaint, inspectShaderElement, normalizeShaderElement } from './shader';
import {
  createShaderPackPluginSnapshot,
  isShaderPackPluginSnapshot,
  resolveShaderPackPresetPaint,
  shaderPackPluginDigest,
  validateShaderPackPluginSnapshot,
  MAX_SHADER_PACK_SOURCE_BYTES,
} from './shaderPackPlugins';
import { studioPluginDigest, validateStudioPluginSnapshot } from './animationPresetPlugins';
import type { ShaderPackPreset, ShaderPackPluginManifest } from './types';

const solid = `#pragma ograf amount slider min(0.0) max(1.0)
const float amount=0.5;
void mainImage(out vec4 c,in vec2 p){c=vec4(vec3(amount),1.0);}`;
const channel = 'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,p/iResolution.xy);}';
const manifest: ShaderPackPluginManifest = {
  schemaVersion: 1,
  apiVersion: 1,
  kind: 'shader-pack',
  id: 'test.shaders',
  version: '1.0.0',
  name: 'Test shaders',
  license: 'CC0-1.0',
  author: 'Fixture author',
};
function preset(): ShaderPackPreset {
  return {
    id: '01',
    name: 'Shader One',
    targets: ['fill', 'outline', 'effect'],
    paint: createShaderPaint({ fragmentSource: solid, parameters: { amount: 0.5 } }),
  };
}
function snapshot(entry = preset()) {
  return createShaderPackPluginSnapshot({
    manifest,
    shaders: [entry],
    licenseText: 'CC0 fixture dedication',
  });
}

describe('portable shader pack definitions', () => {
  it('supports the third generic kind and hashes exact GLSL/license/metadata bytes', () => {
    const pack = snapshot();
    expect(isShaderPackPluginSnapshot(pack)).toBe(true);
    expect(validateStudioPluginSnapshot(pack)).toEqual([]);
    expect(studioPluginDigest(pack)).toBe(shaderPackPluginDigest(pack));
    pack.shaders[0]!.paint.fragmentSource += '\n// changed';
    expect(validateShaderPackPluginSnapshot(pack).join(' ')).toContain('integrity');
  });

  it('resolves independent copies with portable last-copied attribution', () => {
    const pack = snapshot();
    const fill = resolveShaderPackPresetPaint(pack, '01', 'fill');
    const outline = resolveShaderPackPresetPaint(pack, '01', 'outline');
    expect(fill.packProvenance).toMatchObject({
      reference: { id: 'test.shaders', version: '1.0.0', sha256: pack.sha256 },
      presetId: '01',
      packName: 'Test shaders',
      license: 'CC0-1.0',
      licenseText: 'CC0 fixture dedication',
      author: 'Fixture author',
    });
    fill.parameters.amount = 0.8;
    expect(outline.parameters.amount).toBe(0.5);
    expect(pack.shaders[0]!.paint.parameters.amount).toBe(0.5);
    expect(() => resolveShaderPackPresetPaint(pack, 'missing', 'fill')).toThrow('not found');
  });

  it('retains provenance after source/parameter edits without requiring a pack installation', () => {
    const paint = resolveShaderPackPresetPaint(snapshot(), '01', 'fill');
    const original = structuredClone(paint.packProvenance);
    const edited = normalizeShaderElement({
      ...paint,
      fragmentSource: solid + '\n// designer change',
      parameters: { amount: 0.9 },
    });
    expect(edited.packProvenance).toEqual(original);
    expect(edited.packProvenance).not.toBe(paint.packProvenance);
    expect(edited.packProvenance!.reference).not.toBe(paint.packProvenance!.reference);
    expect(inspectShaderElement(edited).valid).toBe(true);
    expect(normalizeShaderElement({ fragmentSource: solid })).not.toHaveProperty('packProvenance');
  });

  it('permits incoming iChannel0 only for effects and requires embedded input for fill/outline', () => {
    const effect = preset();
    effect.targets = ['effect'];
    effect.paint = createShaderPaint({ fragmentSource: channel, parameters: {} });
    const pack = snapshot(effect);
    const paint = resolveShaderPackPresetPaint(pack, '01', 'effect');
    expect(inspectShaderElement(paint, { channel0Provided: true }).errors).toEqual([]);
    expect(() => resolveShaderPackPresetPaint(pack, '01', 'fill')).toThrow('target');
    effect.targets = ['fill'];
    expect(() => snapshot(effect)).toThrow('no input image');
    effect.paint.inputImage = {
      source: 'data:image/png;base64,iVBORw0KGgo=',
      wrap: 'clamp',
      filter: 'linear',
    };
    expect(validateShaderPackPluginSnapshot(snapshot(effect))).toEqual([]);
    effect.targets = ['outline'];
    expect(validateShaderPackPluginSnapshot(snapshot(effect))).toEqual([]);
    effect.targets = ['fill', 'effect'];
    expect(() => snapshot(effect)).toThrow('must not embed inputImage');
  });

  it.each(['https://example.com/image.png', 'asset:picture', 'data:image/svg+xml;base64,PHN2Zy8+'])(
    'rejects unsupported shader input %s',
    (source) => {
      const entry = preset();
      entry.targets = ['fill'];
      entry.paint.inputImage = { source, wrap: 'repeat', filter: 'nearest' };
      expect(() => snapshot(entry)).toThrow('embedded PNG/JPEG');
    },
  );

  it.each([
    'data:image/png;base64,====',
    'data:image/png;base64,PHN2Zy8+',
    'data:image/jpeg;base64,iVBORw0KGgo=',
  ])('rejects malformed or falsely labeled embedded image input %s', (source) => {
    const entry = preset();
    entry.targets = ['fill'];
    entry.paint.inputImage = { source, wrap: 'repeat', filter: 'linear' };
    expect(() => snapshot(entry)).toThrow(/base64|PNG\/JPEG format/);
  });

  it.each([
    (entry: ShaderPackPreset) => {
      Object.assign(entry, { script: 'alert(1)' });
    },
    (entry: ShaderPackPreset) => {
      Object.assign(entry.paint, { javascript: 'alert(1)' });
    },
    (entry: ShaderPackPreset) => {
      entry.id = 'constructor';
    },
    (entry: ShaderPackPreset) => {
      entry.targets = ['fill', 'fill'];
    },
    (entry: ShaderPackPreset) => {
      entry.paint.parameters.amount = Infinity;
    },
    (entry: ShaderPackPreset) => {
      entry.paint.parameters.amount = 2;
    },
    (entry: ShaderPackPreset) => {
      entry.paint.parameters.unknown = 1;
    },
    (entry: ShaderPackPreset) => {
      entry.paint.fragmentSource = '//' + 'x'.repeat(MAX_SHADER_PACK_SOURCE_BYTES) + solid;
    },
  ])('rejects unsafe schema/source/parameter values %s', (change) => {
    const entry = preset();
    change(entry);
    expect(() => snapshot(entry)).toThrow();
  });

  it('bounds shader count and complete JSON bytes without changing old shader contracts', () => {
    const entry = preset();
    expect(() =>
      createShaderPackPluginSnapshot({
        manifest,
        shaders: Array(65).fill(entry),
        licenseText: 'CC0',
      }),
    ).toThrow('1..64');
    const entries = Array.from({ length: 20 }, (_, index) => ({
      ...entry,
      id: String(index),
      paint: createShaderPaint({ fragmentSource: solid + '\n//' + 'x'.repeat(120 * 1024) }),
    }));
    expect(() =>
      createShaderPackPluginSnapshot({ manifest, shaders: entries, licenseText: 'CC0' }),
    ).toThrow('2 MiB');
    const paint = resolveShaderPackPresetPaint(snapshot(), '01', 'fill');
    expect(() =>
      normalizeShaderElement({
        ...paint,
        packProvenance: { ...paint.packProvenance!, licenseText: '' },
      }),
    ).toThrow('licenseText');
  });
});
