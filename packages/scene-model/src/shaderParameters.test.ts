import { describe, expect, it } from 'vitest';
import { applyElementDataValue } from './boundPaint';
import { createShaderElement } from './factory';
import { inspectShaderElement, inspectShaderSource, resolveShaderParameters } from './shader';
import { normalizeShaderParameterValue } from './shaderParameters';

const main =
  '\nvoid mainImage(out vec4 color, in vec2 pos) { color = vec4(pos / iResolution.xy, sin(iTime), 1.0); }';
const source = `#pragma ograf amount slider min(0.0) max(5.0) step(0.1)
const float amount = 2.8;
vec3 tint = vec3(0.01, 0.16, 0.42);
#pragma ograf tint color
#pragma ograf enabled toggle
const bool enabled = true;
#pragma ograf count slider min(1) max(100) step(1)
#define count 60
#pragma ograf offset vector2 min(-4.0) max(4.0) step(0.1)
const vec2 offset = vec2(-2., 0.);${main}`;

describe('annotated shader parameters', () => {
  it('discovers typed defaults and adapts uniforms without changing the authored source or line count', () => {
    const result = inspectShaderSource(source);
    expect(result.errors).toEqual([]);
    expect(result.parameters).toEqual([
      {
        name: 'amount',
        glslType: 'float',
        control: 'slider',
        defaultValue: 2.8,
        min: 0,
        max: 5,
        step: 0.1,
      },
      { name: 'tint', glslType: 'vec3', control: 'color', defaultValue: [0.01, 0.16, 0.42] },
      { name: 'enabled', glslType: 'bool', control: 'toggle', defaultValue: true },
      {
        name: 'count',
        glslType: 'int',
        control: 'slider',
        defaultValue: 60,
        min: 1,
        max: 100,
        step: 1,
      },
      {
        name: 'offset',
        glslType: 'vec2',
        control: 'vector2',
        defaultValue: [-2, 0],
        min: -4,
        max: 4,
        step: 0.1,
      },
    ]);
    expect(result.adaptedSource).toContain('uniform float amount;');
    expect(result.adaptedSource).toContain('uniform vec3 tint;');
    expect(result.adaptedSource).toContain('uniform int count;');
    expect(result.adaptedSource).not.toContain('#pragma ograf');
    expect(result.adaptedSource.split('\n')).toHaveLength(source.split('\n').length);
    const element = createShaderElement({ fragmentSource: source });
    expect(element.fragmentSource).toBe(source);
    expect(inspectShaderElement(element).valid).toBe(true);
    expect(resolveShaderParameters(element)).toEqual({
      amount: 2.8,
      tint: [0.01, 0.16, 0.42],
      enabled: true,
      count: 60,
      offset: [-2, 0],
    });
  });

  it('keeps comments and unrelated declarations and supports CRLF and scalar vector constructors', () => {
    const text = `// #pragma ograf fake slider\r\n/* const float fake = 2.; */\r\n#pragma ograf tint color\r\nconst vec4 tint = vec4(0.5);\r\nconst float other = 3.;${main}`;
    const result = inspectShaderSource(text);
    expect(result.errors).toEqual([]);
    expect(result.parameters).toHaveLength(1);
    expect(result.parameters[0]!.defaultValue).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(result.adaptedSource).toContain('const float other = 3.;');
    expect(result.adaptedSource.match(/\r\n/g)).toHaveLength(text.match(/\r\n/g)!.length);
  });

  it('supports literal bool and vector object macros without exposing unmarked helpers', () => {
    const result = inspectShaderSource(
      `#define ENABLED true\n#define TINT vec4(0.1,0.2,0.3,0.4)\n#define INTERNAL 10\n#pragma ograf ENABLED toggle\n#pragma ograf TINT color${main}`,
    );
    expect(result.errors).toEqual([]);
    expect(result.parameters.map((definition) => definition.name)).toEqual(['ENABLED', 'TINT']);
    expect(result.adaptedSource).toContain('uniform bool ENABLED;');
    expect(result.adaptedSource).toContain('uniform vec4 TINT;');
    expect(result.adaptedSource).toContain('#define INTERNAL 10');
    expect(normalizeShaderParameterValue(result.parameters[1]!, '#12345678')).toEqual([
      18 / 255,
      52 / 255,
      86 / 255,
      120 / 255,
    ]);
  });

  it.each([
    ['#pragma ograf missing slider', /exactly one/],
    ['#pragma ograf x expose\nfloat x = 1.;', /unsupported control/],
    ['#pragma ograf x slider min=0\nfloat x = 1.;', /invalid options/],
    ['#pragma ograf x slider min(0) min(1)\nfloat x = 1.;', /repeats min/],
    ['#pragma ograf x slider min(4) max(2)\nfloat x = 3.;', /min cannot exceed/],
    ['#pragma ograf x slider step(0)\nfloat x = 1.;', /step must be positive/],
    ['#pragma ograf x slider min(2)\nfloat x = 1.;', /default value is outside/],
    ['#pragma ograf x slider\n#pragma ograf x slider\nfloat x = 1.;', /duplicate/],
    ['#pragma ograf x slider\nfloat x = 1.;\nfloat x = 2.;', /found 2/],
    ['#pragma ograf x slider\n#define x(v) v', /function-like/],
    ['#pragma ograf x slider\nconst float x = 1. + 2.;', /literal initializer/],
    ['#pragma ograf x color\nconst float x = 1.;', /incompatible/],
    ['#pragma ograf x toggle min(0)\nconst bool x = true;', /does not accept/],
    ['#pragma ograf x slider step(.5)\nconst int x = 2;', /integer/],
    ['#pragma ograf x slider\nconst mat2 x = mat2(1.);', /literal initializer/],
    ['#pragma ograf gl_x slider\nfloat gl_x = 1.;', /reserved/],
    ['#pragma ograf x slider\n#if 1\nfloat x = 1.;\n#endif', /conditional preprocessing/],
    ['#pragma ograf x slider\n#define x 1.\n#undef x', /undefined by preprocessing/],
    [
      '#pragma ograf x slider\nconst float x = 1.;\nconst float dependent = 2. - x;',
      /dependent calculation/,
    ],
    [
      '#pragma ograf x slider\nconst float x = 1.;\n#define ALIAS x\nconst float dependent = ALIAS;',
      /dependent calculation/,
    ],
    ['#pragma ograf x slider\n#define x 1\n#if x\n#endif', /compile-time constant/],
    ['#pragma ograf x slider\nconst int x = 2;\nfloat data[x];', /array sizes/],
    ['#pragma ograf x slider\nfloat x = 1.;\nvoid mutate() { x += 1.; }', /read-only/],
    ['#pragma ograf x color\nvec3 x = vec3(1.);\nvoid mutate() { x.r = 0.; }', /read-only/],
    [
      '#pragma ograf x slider\nfloat x = 1.;\nvoid mutate(out float a) { a = 2.; }\nvoid run() { mutate(x); }',
      /out\/inout/,
    ],
    [
      '#pragma ograf x slider\nfloat x = 1.;\nvoid read() { const float y = x; }',
      /const initializer/,
    ],
    [
      '#pragma ograf x slider\nfloat x = 1.;\n#define CHANGE(v) v++\nvoid run() { CHANGE(x); }',
      /read-only/,
    ],
    [
      '#pragma ograf x slider\nfloat x = 1.;\n#define ALIAS x\nvoid run() { ALIAS = 0.; }',
      /read-only/,
    ],
    [
      '#pragma ograf x slider\nint x = 1;\nvoid run() { switch(1) { case x: break; } }',
      /compile-time constant/,
    ],
  ])('rejects unsafe or unsupported annotation %s', (input, error) => {
    expect(inspectShaderSource(input + main).errors.join(' ')).toMatch(error);
  });

  it('normalizes typed runtime values and keeps exact color defaults', () => {
    const element = createShaderElement({ fragmentSource: source });
    const amount = inspectShaderSource(source).parameters[0]!;
    expect(normalizeShaderParameterValue(amount, 8)).toBe(5);
    expect(() => normalizeShaderParameterValue(amount, '2')).toThrow(/finite number/);
    expect(() => normalizeShaderParameterValue(amount, Number.NaN)).toThrow(/finite number/);
    expect(applyElementDataValue(element, 'parameters.offset', { x: 2, y: -1 })).toMatchObject({
      parameters: { offset: [2, -1] },
    });
    expect(applyElementDataValue(element, 'parameters.tint', '#03296b')).toMatchObject({
      parameters: { tint: [0.01, 0.16, 0.42] },
    });
    expect(applyElementDataValue(element, 'parameters.tint', '#ff0000')).toMatchObject({
      parameters: { tint: [1, 0, 0] },
    });
    expect(() => applyElementDataValue(element, 'parameters.missing', 1)).toThrow(/Unknown/);
    expect(inspectShaderElement({ ...element, parameters: { amount: 8 } }).valid).toBe(false);
    expect(() => resolveShaderParameters({ ...element, parameters: { missing: 8 } })).toThrow(
      /Unknown/,
    );
  });
});
