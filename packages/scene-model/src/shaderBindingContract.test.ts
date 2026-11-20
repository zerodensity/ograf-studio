import { describe, expect, it } from 'vitest';
import { applyElementDataValue, applyElementDataValues, readElementDataValue } from './boundPaint';
import { createShaderElement, createTextElement } from './factory';
import { createShaderPaint, inspectShaderSource, shaderParameterDefinition } from './shader';
import type { Element, ShaderPaint } from './types';

const source = `#pragma ograf amount slider min(0) max(10)
const float amount = 1.;
#pragma ograf tint color
const vec3 tint = vec3(0.01, 0.16, 0.42);
void mainImage(out vec4 c, in vec2 p) { c = vec4(tint * amount, 1.); }`;
const paint = () => createShaderPaint({ fragmentSource: source });
const sequential = (element: Element, entries: ReadonlyArray<readonly [string, unknown]>) =>
  entries.reduce(
    (current, [property, value]) => applyElementDataValue(current, property, value),
    element,
  );

describe('validated shader binding batches', () => {
  it('keeps cached definitions and returned parameter values private to each caller', () => {
    const definition = shaderParameterDefinition(source, 'tint')!;
    (definition.defaultValue as number[])[0] = 999;
    definition.name = 'changed';
    expect(shaderParameterDefinition(source, 'tint')).toMatchObject({
      name: 'tint',
      defaultValue: [0.01, 0.16, 0.42],
    });
    expect(inspectShaderSource(source).parameters[1]).toMatchObject({
      name: 'tint',
      defaultValue: [0.01, 0.16, 0.42],
    });
    const element = createShaderElement({ fragmentSource: source });
    const value = readElementDataValue(element, 'parameters.tint') as number[];
    value[0] = 999;
    expect(readElementDataValue(element, 'parameters.tint')).toEqual([0.01, 0.16, 0.42]);
    expect(element.parameters).toEqual({});
  });

  it('retains clamping and precise authored colours when a parameter is written repeatedly', () => {
    const element = createShaderElement({ fragmentSource: source });
    const entries = [
      ['parameters.amount', 20],
      ['parameters.tint', '#03296b'],
      ['parameters.amount', -1],
      ['parameters.amount', 3],
      ['parameters.tint', [0.011, 0.161, 0.421]],
      ['parameters.tint', '#03296b'],
    ] as const;
    expect(applyElementDataValues(element, entries)).toEqual(sequential(element, entries));
    expect(applyElementDataValues(element, entries)).toMatchObject({
      parameters: { amount: 3, tint: [0.011, 0.161, 0.421] },
    });
    expect(element.parameters).toEqual({});
  });

  it('preserves fill, outline and ordinary-property ordering across paint replacements', () => {
    const element = createTextElement({ content: 'Before', fill: paint(), strokePaint: paint() });
    const entries: ReadonlyArray<readonly [string, unknown]> = [
      ['fill.parameters.amount', 2],
      ['strokePaint.parameters.amount', 3],
      ['fill.parameters.tint', '#ffffff'],
      ['content', 'After'],
      ['strokePaint.parameters.tint', '#03296b'],
      ['fill', '#112233'],
      ['fill', paint()],
      ['fill.parameters.amount', 7],
      ['fontSize', '72'],
    ];
    expect(applyElementDataValues(element, entries)).toEqual(sequential(element, entries));
    expect(applyElementDataValues(element, entries)).toMatchObject({
      content: 'After',
      fontSize: 72,
      fill: { parameters: { amount: 7 } },
      strokePaint: { parameters: { amount: 3, tint: [0.01, 0.16, 0.42] } },
    });
    expect(element).toMatchObject({
      content: 'Before',
      fill: { parameters: {} },
      strokePaint: { parameters: {} },
    });
  });

  it.each([{ missing: 1 }, { tint: 'not-a-colour' }])(
    'rejects invalid authored siblings %j before a batch can overwrite them',
    (parameters) => {
      const element = createShaderElement({ fragmentSource: source });
      element.parameters = parameters as unknown as ShaderPaint['parameters'];
      const entries = [
        ['parameters.amount', 2],
        ['parameters.tint', '#ffffff'],
      ] as const;
      expect(() => applyElementDataValues(element, entries)).toThrow();
      expect(() => applyElementDataValue(element, 'parameters.amount', 2)).toThrow();
      expect(() => readElementDataValue(element, 'parameters.amount')).toThrow();
      expect(element.parameters).toEqual(parameters);
    },
  );

  it('rejects a malformed source and preserves the first incoming validation error', () => {
    const element = createShaderElement({
      fragmentSource: source + '\nuniform float unsupported;',
    });
    expect(() => applyElementDataValues(element, [['parameters.amount', 2]])).toThrow();
    const valid = createShaderElement({ fragmentSource: source });
    const entries = [
      ['parameters.amount', 'not-a-number'],
      ['parameters.missing', 2],
    ] as const;
    const reason = (operation: () => unknown) => {
      try {
        operation();
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('Expected validation failure.');
    };
    expect(reason(() => applyElementDataValues(valid, entries))).toBe(
      reason(() => sequential(valid, entries)),
    );
    expect(() =>
      applyElementDataValues(createTextElement(), [['fill.parameters.amount', 2]]),
    ).toThrow('requires a shader paint');
    expect(() => applyElementDataValues(valid, [['parameters.missing', 2]])).toThrow(
      'Unknown shader parameter',
    );
  });

  it('validates the authored parameter set once per consecutive slot rather than per binding', () => {
    const names = Array.from({ length: 12 }, (_, index) => `value${index}`);
    const parametersSource =
      names
        .map((name) => `#pragma ograf ${name} slider min(0) max(10)\nconst float ${name} = 1.;`)
        .join('\n') + '\nvoid mainImage(out vec4 c, in vec2 p) { c = vec4(1.); }';
    const element = createShaderElement({ fragmentSource: parametersSource });
    let reads = 0;
    for (const name of names)
      Object.defineProperty(element.parameters, name, {
        enumerable: true,
        get: () => {
          reads++;
          return 1;
        },
      });
    const result = applyElementDataValues(
      element,
      names.map((name) => [`parameters.${name}`, 4] as const),
    );
    expect(result).toMatchObject({
      parameters: Object.fromEntries(names.map((name) => [name, 4])),
    });
    expect(reads).toBe(names.length * 2); // One complete validation and one immutable copy.
  });
});
