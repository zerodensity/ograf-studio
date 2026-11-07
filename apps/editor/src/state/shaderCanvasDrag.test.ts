import { describe, expect, it } from 'vitest';
import { createProject, type StudioPluginReference } from '@ograf-editor/scene-model';
import { SHADER_RESOURCE_MIME } from './shaderDrag';
import {
  decodeShaderPluginPresetDrag,
  encodeShaderPluginPresetDrag,
  hasShaderCanvasDrag,
  shaderCanvasDragData,
  SHADER_PLUGIN_PRESET_MIME,
} from './shaderCanvasDrag';

const reference: StudioPluginReference = {
  id: 'ograf.zd-news-shaders-2',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
};

describe('shader canvas drag identities', () => {
  it('round-trips exact plugin identity without source, embedded images or trust declarations', () => {
    const project = createProject();
    const payload = encodeShaderPluginPresetDrag(project.id, reference, '21');
    expect(JSON.parse(payload)).toEqual({
      kind: 'shader-pack',
      projectId: project.id,
      reference,
      presetId: '21',
    });
    expect(payload).not.toMatch(/fragmentSource|inputImage|trusted|enabled/);
    const result = decodeShaderPluginPresetDrag(project, payload);
    expect(result).toEqual({ reference, presetId: '21' });
    expect(result.reference).not.toBe(reference);
    expect(project.shaders).toHaveLength(0);
  });

  it('refuses cross-project drags rather than applying to a newly opened project', () => {
    const payload = encodeShaderPluginPresetDrag(createProject().id, reference, '21');
    expect(() => decodeShaderPluginPresetDrag(createProject(), payload)).toThrow(
      /different project/,
    );
  });

  it.each([
    '',
    'not json',
    'null',
    '[]',
    '{}',
    JSON.stringify({ kind: 'chart', projectId: 'p', reference, presetId: '21' }),
    JSON.stringify({ kind: 'shader-pack', projectId: 'p', reference, presetId: ' ' }),
    JSON.stringify({ kind: 'shader-pack', projectId: 'p', reference, presetId: 'x'.repeat(257) }),
    JSON.stringify({ kind: 'shader-pack', projectId: 'x'.repeat(257), reference, presetId: '21' }),
    JSON.stringify({ kind: 'shader-pack', projectId: 'p', reference: null, presetId: '21' }),
    JSON.stringify({
      kind: 'shader-pack',
      projectId: 'p',
      reference: { ...reference, id: 'UPPER case' },
      presetId: '21',
    }),
    JSON.stringify({
      kind: 'shader-pack',
      projectId: 'p',
      reference: { ...reference, version: 'latest' },
      presetId: '21',
    }),
    JSON.stringify({
      kind: 'shader-pack',
      projectId: 'p',
      reference: { ...reference, sha256: 'A'.repeat(64) },
      presetId: '21',
    }),
    JSON.stringify({
      kind: 'shader-pack',
      projectId: 'p',
      reference,
      presetId: '21',
      trusted: true,
    }),
    JSON.stringify({
      kind: 'shader-pack',
      projectId: 'p',
      reference: { ...reference, source: 'injected' },
      presetId: '21',
    }),
    ' '.repeat(4097),
    'é'.repeat(2049),
  ])('rejects malformed, non-shader or unbounded plugin reference %s', (payload) => {
    expect(() => decodeShaderPluginPresetDrag(createProject(), payload)).toThrow();
  });

  it('also validates encoder input before producing a drag payload', () => {
    expect(() => encodeShaderPluginPresetDrag(' ', reference, '21')).toThrow();
    expect(() => encodeShaderPluginPresetDrag('p', reference, '')).toThrow();
    expect(() => encodeShaderPluginPresetDrag('p', { ...reference, version: '*' }, '21')).toThrow();
  });

  it('recognizes both shader sources even when Files is also advertised', () => {
    expect(hasShaderCanvasDrag([SHADER_RESOURCE_MIME, 'Files'])).toBe(true);
    expect(hasShaderCanvasDrag(['Files', SHADER_PLUGIN_PRESET_MIME])).toBe(true);
    expect(hasShaderCanvasDrag(['Files', 'text/plain'])).toBe(false);
    expect(hasShaderCanvasDrag([])).toBe(false);
  });

  it('reads only the winning shader identity, never Files or arbitrary text', () => {
    const calls: string[] = [];
    const getData = (type: string) => {
      calls.push(type);
      return `${type}:payload`;
    };
    expect(shaderCanvasDragData({ types: ['Files', SHADER_PLUGIN_PRESET_MIME], getData })).toEqual({
      kind: 'plugin',
      payload: `${SHADER_PLUGIN_PRESET_MIME}:payload`,
    });
    expect(
      shaderCanvasDragData({
        types: ['Files', SHADER_PLUGIN_PRESET_MIME, SHADER_RESOURCE_MIME],
        getData,
      }),
    ).toEqual({ kind: 'resource', payload: `${SHADER_RESOURCE_MIME}:payload` });
    expect(shaderCanvasDragData({ types: ['Files', 'text/plain'], getData })).toBeNull();
    expect(calls).toEqual([SHADER_PLUGIN_PRESET_MIME, SHADER_RESOURCE_MIME]);
  });
});
