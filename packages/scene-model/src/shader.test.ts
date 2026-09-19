import { describe, expect, it } from 'vitest';
import { createProject, createShaderElement, createShaderLayer } from './factory';
import { migrateProject } from './migrations';
import {
  DEFAULT_SHADER_FRAGMENT_SOURCE,
  inspectShaderElement,
  inspectShaderSource,
  resolveShaderParameters,
  getElementShaderPaint,
} from './shader';

describe('single-pass shader contract', () => {
  it('preserves authored source byte-for-byte through JSON and project migration', () => {
    const fragmentSource = `// Keep this source and whitespace intact.\r\n${DEFAULT_SHADER_FRAGMENT_SOURCE}\n`;
    const project = createProject();
    const layer = createShaderLayer();
    layer.element = createShaderElement({ fragmentSource, speed: 0, resolutionScale: 0.5 });
    project.compositions[0]!.layers.push(layer);
    const restored = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(getElementShaderPaint(restored.compositions[0]!.layers[0]!.element)).toEqual({
      ...layer.element,
      parameters: resolveShaderParameters(layer.element),
    });
    expect(inspectShaderElement(layer.element).valid).toBe(true);
  });

  it('fills only absent shader defaults and keeps older layers unchanged', () => {
    const project = createProject();
    const layer = createShaderLayer();
    layer.element = { type: 'shader', fragmentSource: DEFAULT_SHADER_FRAGMENT_SOURCE } as never;
    project.compositions[0]!.layers.push(layer);
    const restored = migrateProject(project);
    const expected = createShaderElement();
    expect(getElementShaderPaint(restored.compositions[0]!.layers[0]!.element)).toEqual({
      ...expected,
      parameters: resolveShaderParameters(expected),
    });
    expect(layer.element).not.toHaveProperty('speed');
    expect(migrateProject(createProject()).compositions[0]!.layers).toEqual([]);
  });

  it.each([
    'iChannel0',
    'iChannelResolution',
    'iMouse',
    'iDate',
    'iFrame',
    'iTimeDelta',
    'iSampleRate',
    'iFrameRate',
  ])('rejects unsupported input %s while ignoring comments', (input) => {
    expect(
      inspectShaderSource(`${DEFAULT_SHADER_FRAGMENT_SOURCE}\nfloat x = ${input};`).valid,
    ).toBe(false);
    expect(
      inspectShaderSource(`// ${input}\n/* ${input} */\n${DEFAULT_SHADER_FRAGMENT_SOURCE}`).valid,
    ).toBe(true);
  });

  it.each([
    '',
    'void main() {}',
    '#version 300 es\n' + DEFAULT_SHADER_FRAGMENT_SOURCE,
    'uniform float customValue;\n' + DEFAULT_SHADER_FRAGMENT_SOURCE,
  ])('rejects source outside the Image pass contract', (source) => {
    expect(inspectShaderSource(source).valid).toBe(false);
  });

  it.each([
    { speed: -1 },
    { speed: 11 },
    { speed: Number.NaN },
    { resolutionScale: 0 },
    { resolutionScale: 1.01 },
  ])('reports invalid numeric parameters without silently clamping them', (patch) => {
    expect(inspectShaderElement(createShaderElement(patch)).valid).toBe(false);
  });
});
