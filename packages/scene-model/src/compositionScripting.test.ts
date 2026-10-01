import { describe, expect, it } from 'vitest';
import {
  resolveExpressionTransforms,
  type ExpressionDiagnostic,
  type ExpressionLayerState,
} from './expressionTransforms';
import { evaluateExpression } from './expressions';
import { scriptModules, scriptModuleName, scriptModuleSyntaxError } from './scriptModules';
import type { CompositionScripting } from './types';

const settings = (
  source = '',
  modules: CompositionScripting['modules'] = [],
): CompositionScripting => ({ source, modules, enabled: true });
const layer = (id = 'Title'): ExpressionLayerState => ({
  id,
  name: id,
  transform: {
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    transformOriginX: 0.5,
    transformOriginY: 0.5,
  },
});

describe('shared JavaScript modules', () => {
  it('supports named/default exports, relative imports, re-exports and normal JavaScript', () => {
    const config = settings('', [
      { fileName: 'math.js', source: 'export const gap = 10; export default (x) => x * 2;' },
      {
        fileName: 'helpers.js',
        source: `import double, { gap } from './math.js';
        export { gap } from './math.js';
        export function spacing(i) { return double(i) * gap; }`,
      },
    ]);
    expect(
      evaluateExpression('helpers.spacing(3) + helpers.gap', {}, undefined, {
        modules: scriptModules(config),
      }),
    ).toBe(70);
  });
  it('initializes once per settings instance and preserves live exported bindings', () => {
    const config = settings('', [
      {
        fileName: 'counter.js',
        source: 'export let value = 0; export function next() { value++; return value; }',
      },
    ]);
    const modules = scriptModules(config);
    expect(evaluateExpression('counter.next()', {}, undefined, { modules })).toBe(1);
    expect(
      evaluateExpression('counter.value', {}, undefined, { modules: scriptModules(config) }),
    ).toBe(1);
    expect(
      evaluateExpression('counter.next()', {}, undefined, {
        modules: scriptModules(structuredClone(config)),
      }),
    ).toBe(1);
    expect(() => evaluateExpression('counter.value = 8', {}, undefined, { modules })).toThrow();
  });
  it('does not initialize an unused broken module', () => {
    const modules = scriptModules(
      settings('', [{ fileName: 'bad.js', source: 'throw new Error("broken");' }]),
    );
    expect(evaluateExpression('2 + 3', {}, undefined, { modules })).toBe(5);
    expect(() => evaluateExpression('bad.value', {}, undefined, { modules })).toThrow(
      'bad.js: broken',
    );
  });
  it.each([
    'Math.js',
    'layer.js',
    'data.js',
    'time.js',
    'return.js',
    '../helpers.js',
    'my-functions.js',
  ])('rejects ambiguous namespace %s', (name) => {
    expect(() => scriptModuleName(name)).toThrow();
  });
  it('reports missing files, unsupported imports and cycles with their filenames', () => {
    for (const source of [
      "import './missing.js';",
      "import 'some-package';",
      "import './helpers.js';",
    ]) {
      const modules = scriptModules(settings('', [{ fileName: 'helpers.js', source }]));
      expect(() => evaluateExpression('helpers.value', {}, undefined, { modules })).toThrow(
        'helpers.js:',
      );
    }
    expect(scriptModuleSyntaxError('export function (')).toBeTruthy();
  });
});

describe('composition scripts', () => {
  it('passes explicit frame data and writable layer references to imported functions', () => {
    const config = settings('helpers.move(layer("Title"), frame, data.gap);', [
      {
        fileName: 'helpers.js',
        source: 'export function move(target, frame, gap) { target.x += frame * gap; }',
      },
    ]);
    expect(
      resolveExpressionTransforms([layer()], { frame: 3, 'data.gap': 5 }, [], 1, config).get(
        'Title',
      )!.x,
    ).toBe(25);
    const diagnostics: ExpressionDiagnostic[] = [];
    resolveExpressionTransforms(
      [
        {
          ...layer(),
          expressions: { x: 'helpers.move(layer("Title"), frame, data.gap); return 1;' },
        },
      ],
      { frame: 3, 'data.gap': 5 },
      diagnostics,
      1,
      { ...config, enabled: false },
    );
    expect(diagnostics[0]?.property).toBe('x');
  });

  it('runs after expressions, reads its writes, and never changes authored poses', () => {
    const title = { ...layer(), expressions: { x: 'helpers.offset(thisLayer.x)' } };
    const background = layer('Background');
    const config = settings(
      `const title = layer('Title');
      title.x += frame;
      layerById('Background').x = title.x - 20;
      layer('Background').width = title.width + 40;`,
      [{ fileName: 'helpers.js', source: 'export const offset = x => x + 5;' }],
    );
    const diagnostics: ExpressionDiagnostic[] = [];
    for (const frame of [25, 5, 25]) {
      const result = resolveExpressionTransforms(
        [title, background],
        { frame },
        diagnostics,
        1,
        config,
      );
      expect(result.get('Title')!.x).toBe(15 + frame);
      expect(result.get('Background')).toMatchObject({ x: frame - 5, width: 140 });
    }
    expect(title.transform.x).toBe(10);
    expect(background.transform.width).toBe(100);
    expect(diagnostics).toEqual([]);
  });
  it.each([
    'throw new Error("failed")',
    'layer("Title").x = NaN',
    'layer("Title").foo = 1',
    'layer("missing").x = 1',
  ])('rolls back every write on failure: %s', (failure) => {
    const title = { ...layer(), expressions: { x: '21' } };
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms(
      [title],
      {},
      diagnostics,
      1,
      settings(`layer('Title').x = 99; ${failure};`),
    );
    expect(result.get('Title')!.x).toBe(21);
    expect(diagnostics[0]?.property).toBe('script');
  });
  it('keeps layer references read-only inside property expressions', () => {
    const title = { ...layer(), expressions: { x: 'layer("Other").x = 99; return 4;' } };
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([title, layer('Other')], {}, diagnostics);
    expect(result.get('Other')!.x).toBe(10);
    expect(diagnostics[0]?.layerId).toBe('Title');
  });
  it('allows disabling the script while retaining libraries for expressions', () => {
    const config = settings('layer("Title").x = 99', [
      { fileName: 'helpers.js', source: 'export const value = 42;' },
    ]);
    config.enabled = false;
    const title = { ...layer(), expressions: { x: 'helpers.value' } };
    expect(resolveExpressionTransforms([title], {}, [], 1, config).get('Title')!.x).toBe(42);
  });
  it('rejects future API versions and ambiguous names, but accepts exact runtime IDs', () => {
    const a = layer('a'),
      b = layer('b');
    a.name = b.name = 'Title';
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(
      resolveExpressionTransforms([a, b], {}, diagnostics, 1, settings('layer("Title").x = 5')).get(
        'a',
      )!.x,
    ).toBe(10);
    expect(diagnostics[0]?.message).toContain('Ambiguous');
    expect(
      resolveExpressionTransforms([a, b], {}, [], 1, settings('layerById("a").x = 5')).get('a')!.x,
    ).toBe(5);
    expect(
      resolveExpressionTransforms([a], {}, diagnostics, 23, settings('layerById("a").x = 5')).get(
        'a',
      )!.x,
    ).toBe(10);
    expect(diagnostics.at(-1)?.message).toContain('Unsupported expression API');
  });
  it('rejects returned promises and discards their delayed writes', async () => {
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms(
      [layer()],
      {},
      diagnostics,
      1,
      settings('return Promise.resolve().then(() => { layer("Title").x = 99; });'),
    );
    await Promise.resolve();
    expect(result.get('Title')!.x).toBe(10);
    expect(diagnostics[0]?.message).toContain('synchronously');
  });
});
