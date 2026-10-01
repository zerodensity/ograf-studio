import { describe, expect, it, vi } from 'vitest';
import {
  evaluateExpression,
  expressionDataScope,
  expressionTimelineScope,
  expressionSyntaxError,
} from './expressions';

describe('expressionTimelineScope', () => {
  it('samples exit progress from the last Step and handles a zero-duration exit', () => {
    const keys = [
      { role: 'start' as const, frame: 0 },
      { role: 'step' as const, frame: 10 },
      { role: 'step' as const, frame: 90 },
      { role: 'end' as const, frame: 100 },
    ];
    for (const [frame, expected] of [
      [0, 0],
      [50, 0],
      [90, 0],
      [95, 0.5],
      [100, 1],
      [110, 1],
    ]) {
      expect(expressionTimelineScope(keys, frame)['timeline.exitProgress']).toBe(expected);
    }
    keys[3]!.frame = 90;
    expect(expressionTimelineScope(keys, 89)['timeline.exitProgress']).toBe(0);
    expect(expressionTimelineScope(keys, 90)['timeline.exitProgress']).toBe(1);
  });

  it('exposes the first and last Step separately, including coincident boundaries', () => {
    expect(
      expressionTimelineScope([
        { role: 'start', frame: 0 },
        { role: 'step', frame: 10 },
        { role: 'step', frame: 90 },
        { role: 'end', frame: 100 },
      ]),
    ).toEqual({
      'timeline.startFrame': 0,
      'timeline.firstStepFrame': 10,
      'timeline.lastStepFrame': 90,
      'timeline.endFrame': 100,
    });
    expect(
      expressionTimelineScope([
        { role: 'start', frame: 0 },
        { role: 'step', frame: 0 },
        { role: 'end', frame: 0 },
      ]),
    ).toEqual({
      'timeline.startFrame': 0,
      'timeline.firstStepFrame': 0,
      'timeline.lastStepFrame': 0,
      'timeline.endFrame': 0,
    });
  });

  it('does not invent Step boundaries for graphics without Steps', () => {
    const scope = expressionTimelineScope([
      { role: 'start', frame: 0 },
      { role: 'end', frame: 20 },
    ]);
    expect(evaluateExpression('timeline.endFrame - timeline.startFrame', scope)).toBe(20);
    expect(() => evaluateExpression('timeline.firstStepFrame', scope)).toThrow();
  });
});

describe('evaluateExpression', () => {
  it('enumerates reference keys without evaluating them and resolves only accessed properties', () => {
    const resolve = vi.fn((_name: string, property: string) => (property === 'width' ? 42 : 1));
    expect(evaluateExpression('Object.keys(layer("A")).length', {}, resolve)).toBe(6);
    expect(resolve).not.toHaveBeenCalled();
    expect(evaluateExpression('layer("A").width', {}, resolve)).toBe(42);
    expect(resolve).toHaveBeenCalledTimes(1);
    resolve.mockClear();
    expect(
      evaluateExpression('({...layerById("a")}).width', {}, undefined, {
        resolveLayerById: resolve,
      }),
    ).toBe(42);
    expect(resolve).toHaveBeenCalledTimes(6);
  });

  it('supports native JavaScript functions, loops, arrays, objects and Math', () => {
    expect(
      evaluateExpression(
        `
      const { scale } = { scale: 2 };
      const square = value => value ** 2;
      let total = 0;
      for (const value of [1, 2, 3].map(square)) total += value;
      return Math.max(total * scale, 0);
    `,
        {},
      ),
    ).toBe(28);
    expect(evaluateExpression('true && !false ? Math.sin(Math.PI / 2) : 0', {})).toBe(1);
    expect(evaluateExpression('const name = "A"; return layer(name).x;', { 'A.x': 7 })).toBe(7);
    expect(expressionSyntaxError('throw new Error("not executed")')).toBeUndefined();
    expect(() => evaluateExpression('return {};', {})).toThrow('must be a number');
    expect(() => evaluateExpression('return Promise.resolve(1);', {})).toThrow('synchronously');
  });

  it.each([
    'Promise.reject(new Error("rejected expression"))',
    '(async () => { throw new Error("rejected async expression"); })()',
    '({ then(_resolve, reject) { reject(new Error("rejected thenable")); } })',
  ])('contains returned async failures: %s', async (source) => {
    expect(() => evaluateExpression(source, {})).toThrow('Expressions must finish synchronously');
    // An unhandled rejection here also fails the test run, after the evaluator has returned.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('accepts a trailing semicolon on a formula and supports JavaScript statement bodies', () => {
    const source = 'layer("Rectangle").x + 100; // target';
    expect(expressionSyntaxError(source)).toBeUndefined();
    expect(evaluateExpression(source, { 'Rectangle.x': 25 })).toBe(125);
    expect(evaluateExpression('x + 100', { x: 25 })).toBe(125);
    expect(evaluateExpression('x + 100; return 0;', { x: 25 })).toBe(0);
  });

  it('accepts whitespace and escaped characters in layer references', () => {
    const name = 'Headline "Arabic" \\ Title';
    const scope = { [name + '.x']: 42 };
    expect(evaluateExpression(`layer ( ${JSON.stringify(name)} ) . x`, scope)).toBe(42);
    expect(
      evaluateExpression(
        `const target = layer ( ${JSON.stringify(name)} ); return target . x;`,
        scope,
      ),
    ).toBe(42);
    expect(evaluateExpression('layer("\\u0041").x', { 'A.x': 7 })).toBe(7);
  });

  it('keeps thisLayer independent of local constants with the same property name', () => {
    expect(evaluateExpression('const x = 100; return thisLayer . x + x;', { x: 4 })).toBe(104);
    expect(
      evaluateExpression('const width = 50; return thisLayer.width + width;', { width: 25 }),
    ).toBe(75);
  });

  it('supports comments and ordinary decimal/scientific notation without altering strings', () => {
    expect(
      evaluateExpression('layer /* target */ ("A") . x + thisLayer /* base */ . x', {
        'A.x': 10,
        x: 5,
      }),
    ).toBe(15);
    expect(
      evaluateExpression('// Entry\nconst t = .5; /* position */ return 1e2 * t + 2.;', {}),
    ).toBe(52);
    expect(
      evaluateExpression('data.text == "// layer(\\"Foo\\") /* comment */" ? 1e-2 : 0', {
        'data.text': '// layer("Foo") /* comment */',
      }),
    ).toBe(0.01);
    expect(() => evaluateExpression('1 /* missing end', {})).toThrow();
  });

  it('checks syntax without requiring runtime values', () => {
    expect(expressionSyntaxError('layer("Text").width + data.padding')).toBeUndefined();
    expect(expressionSyntaxError('')).toBeUndefined();
    for (const source of ['x +', 'if (frame > 0) { return 1;']) {
      expect(expressionSyntaxError(source)).toBeTypeOf('string');
    }
  });

  it('isolates cached evaluation state across frames, failures and recursive calls', () => {
    const source = 'const offset = data.offset; return layer("Other").x + offset;';
    expect(
      evaluateExpression(source, { 'data.offset': 1 }, () =>
        evaluateExpression(source, { 'data.offset': 2 }, () => 3),
      ),
    ).toBe(6);
    expect(() => evaluateExpression(source, {}, () => 0)).toThrow();
    expect(evaluateExpression(source, { 'data.offset': 10 }, () => 20)).toBe(30);
    for (let i = 0; i < 300; i++) expect(evaluateExpression(String(i), {})).toBe(i);
    expect(evaluateExpression(source, { 'data.offset': 10 }, () => 20)).toBe(30);
  });

  it('supports selecting easing presets through data', () => {
    expect(evaluateExpression('ease(0, 100, 0.25, "ease-in-out")', {})).toBe(12.5);
    expect(
      evaluateExpression('ease(0, 100, 0.25, data.easing)', { 'data.easing': 'cubic-out' }),
    ).toBe(57.8125);
    expect(evaluateExpression('ease(0, 100, 0.6, "back-out")', {})).toBeGreaterThan(100);
    expect(evaluateExpression('ease(0, 100, 0.2, "elastic-out")', {})).toBeGreaterThan(100);
  });

  it('rejects unknown presets, wrong types and unexpected arguments', () => {
    expect(() => evaluateExpression('ease(0, 1, 0.5)', {})).toThrow('four arguments');
    expect(expressionSyntaxError('ease(0, 1, 0.5)')).toBeUndefined();
    expect(() => evaluateExpression('ease(0, 1, 0.5, "unknown")', {})).toThrow('Unknown easing');
    expect(() => evaluateExpression('ease(0, 1, 0.5, 1)', {})).toThrow('preset name');
    expect(() => evaluateExpression('ease(0, 1, 0.5, "linear", 1)', {})).toThrow('arguments');
    expect(() => evaluateExpression('lerp(0, 1, 0.5, "linear")', {})).toThrow('arguments');
    expect(() => evaluateExpression('clamp(0, 1, 0.5, "linear")', {})).toThrow('arguments');
  });

  it('makes boolean data fields usable as numeric conditions', () => {
    expect(
      evaluateExpression(
        'if (data.fade == 0) return 1; return 0;',
        expressionDataScope({ fade: false }),
      ),
    ).toBe(1);
    expect(
      evaluateExpression(
        'if (data.fade == 0) return 1; return 0;',
        expressionDataScope({ fade: true }),
      ),
    ).toBe(0);
  });
  it('keeps block constants local, supports else-if and returns immediately', () => {
    const script =
      'const x = 7; if (frame < 10) { const x = 3; return x; } else if (frame < 20) { return x + 1; } else { return x; } return missing;';
    expect(evaluateExpression(script, { frame: 0 })).toBe(3);
    expect(evaluateExpression(script, { frame: 15 })).toBe(8);
    expect(evaluateExpression(script, { frame: 25 })).toBe(7);
    expect(
      evaluateExpression('const rect = layer("Main Rectangle"); return rect.x;', {
        'Main Rectangle.x': 42,
      }),
    ).toBe(42);
    expect(() => evaluateExpression('const x = 1;', {})).toThrow('must be a number');
    expect(() => evaluateExpression('const x = 1; const x = 2; return x;', {})).toThrow(
      'already been declared',
    );
    expect(() => evaluateExpression('if (1) { return 2;', {})).toThrow();
  });
  it('short circuits conditions and handles smooth interpolation', () => {
    expect(evaluateExpression('frame < 10 ? 5 : missing / 0', { frame: 0 })).toBe(5);
    expect(evaluateExpression('ease(0, 100, 0.25, "quad-out")', {})).toBe(43.75);
    expect(evaluateExpression('ease(0, 100, 2, "quad-out")', {})).toBe(100);
    expect(evaluateExpression('1 <= 2 ? (3 != 4 ? 8 : 9) : 0', {})).toBe(8);
    expect(() => evaluateExpression('lerp(0, 10)', {})).toThrow('three arguments');
    expect(() => evaluateExpression('1 / 0', {})).toThrow('not finite');
  });
  it('accepts layer names containing spaces and trailing whitespace', () => {
    expect(evaluateExpression('layer("Main Rectangle").x + 1  ', { 'Main Rectangle.x': 4 })).toBe(
      5,
    );
  });
  it('evaluates arithmetic and layer-style references', () => {
    expect(
      evaluateExpression('rectangle.x + rectangle.width + 100', {
        'rectangle.x': 40,
        'rectangle.width': 260,
      }),
    ).toBe(400);
  });
  it('supports precedence, grouping, unary minus, and rejects unknown names', () => {
    expect(evaluateExpression('-(2 + 3) * 4', {})).toBe(-20);
    expect(() => evaluateExpression('missing + 1', {})).toThrow('is not defined');
  });
  it('can use a supplied timeline frame', () => {
    expect(evaluateExpression('frame * 5 + x', { frame: 12, x: 10 })).toBe(70);
  });
  it('resolves explicit layer accessors', () => {
    expect(
      evaluateExpression('layer("Rectangle").x + layer("Rectangle").width + 100', {
        'Rectangle.x': 40,
        'Rectangle.width': 260,
      }),
    ).toBe(400);
  });
  it('resolves thisLayer to the current layer scope', () => {
    expect(evaluateExpression('thisLayer.x + 20', { x: 40 })).toBe(60);
  });
  it('compares select values in numeric branches with JavaScript semantics', () => {
    const scope = { 'data.Alphabet': 'Latin' };
    expect(evaluateExpression('data.Alphabet == "Latin" ? 100 : 200', scope)).toBe(100);
    expect(evaluateExpression("data.Alphabet === 'Arabic' ? 100 : 200", scope)).toBe(200);
    expect(
      evaluateExpression(`data.Alphabet == "layer('Foo')" ? 1 : 0`, {
        'data.Alphabet': "layer('Foo')",
      }),
    ).toBe(1);
    expect(
      evaluateExpression('data.Alphabet == "thisLayer.x" ? 1 : 0', {
        'data.Alphabet': 'thisLayer.x',
      }),
    ).toBe(1);
    expect(
      evaluateExpression(
        'const alphabet = data.Alphabet; if (alphabet != "Arabic") return 30; return 0;',
        scope,
      ),
    ).toBe(30);
    expect(
      evaluateExpression('data.Alphabet == "Latin" ? layer("Rectangle").x : 0', {
        ...scope,
        'Rectangle.x': 42,
      }),
    ).toBe(42);
    expect(() => evaluateExpression('data.Alphabet + 1', scope)).toThrow('must be a number');
    expect(() => evaluateExpression('data.Alphabet', scope)).toThrow('must be a number');
    expect(evaluateExpression('data.Alphabet == "Latin" ? 1 : missing()', scope)).toBe(1);
  });
});

describe('structured expression data', () => {
  it('preserves nested objects, arrays, null, booleans and literal field keys', () => {
    const scope = expressionDataScope({
      visible: true,
      rows: [{ score: 7 }],
      missing: null,
      'a.b': 3,
      'home score': 2,
    });
    expect(
      evaluateExpression(
        'data.visible === true && data.missing === null ? data.rows[0].score + data["a.b"] + data["home score"] : 0',
        scope,
      ),
    ).toBe(12);
    expect(evaluateExpression('Number(data.visible)', scope)).toBe(1);
    expect(evaluateExpression('Object.keys(data).length', scope)).toBe(5);
  });
  it('detaches and freezes nested values without freezing the input', () => {
    const input = { rows: [{ score: 7 }], visible: true };
    const scope = expressionDataScope(input);
    input.rows[0]!.score = 9;
    for (const source of [
      'data.rows[0].score = 100; return 1;',
      'data.rows.push({score: 100}); return 1;',
      'data.visible = false; return 1;',
      'delete data.rows; return 1;',
    ])
      expect(() => evaluateExpression(source, scope)).toThrow();
    expect(evaluateExpression('data.rows[0].score', scope)).toBe(7);
    expect(input.rows[0]!.score).toBe(9);
    expect(Object.isFrozen(input.rows)).toBe(false);
  });
  it('keeps special object keys as data without changing prototypes', () => {
    const data = JSON.parse('{"__proto__":{"score":7},"constructor":3}');
    expect(
      evaluateExpression('data.__proto__.score + data.constructor', expressionDataScope(data)),
    ).toBe(10);
  });
});
