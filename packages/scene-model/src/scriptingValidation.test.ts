import { describe, expect, it } from 'vitest';
import { scriptingErrors } from './scriptingValidation';
import { scriptModuleName } from './scriptModules';
import { createProject } from './factory';
import { migrateProject } from './migrations';
import { resolveExpressionTransforms, type ExpressionDiagnostic } from './expressionTransforms';

describe('serialized scripting validation', () => {
  it.each([
    { scripting: null },
    { scripting: { enabled: true, source: null, modules: [] } },
    { scripting: { enabled: 'yes', source: '', modules: [] } },
    { scripting: { enabled: true, source: '', modules: {} } },
    { scripting: { enabled: true, source: '', modules: [{ fileName: 'helpers.js', source: 7 }] } },
    {
      scripting: {
        enabled: true,
        source: '',
        modules: [
          { fileName: 'helpers.js', source: '' },
          { fileName: 'helpers.mjs', source: '' },
        ],
      },
    },
    { expressionApiVersion: '1' },
    { expressionApiVersion: 0 },
    { collections: [{ prototypeLayers: [{ expressions: { x: null } }] }] },
    { layers: [{ expressions: { x: 7 } }] },
    { layers: [{ expressionsEnabled: { x: 'true' } }] },
    { components: [{ layers: [{ expressions: { unsupported: '1' } }] }] },
  ])('rejects malformed new fields: %j', (input) => {
    expect(scriptingErrors(input).length).toBeGreaterThan(0);
  });

  it('accepts legacy absence and syntax errors without executing source', () => {
    expect(scriptingErrors({ layers: [{}] })).toEqual([]);
    expect(scriptingErrors({ expressionApiVersion: 2 })).toEqual([]);
    expect(
      scriptingErrors({ scripting: { enabled: false, source: 'invalid {', modules: [] } }),
    ).toEqual([]);
  });

  it('rejects malformed scripting before loading/migrating a project', () => {
    const project = createProject();
    Object.assign(project.compositions[0]!, {
      scripting: { enabled: true, source: null, modules: [] },
    });
    expect(() => migrateProject(project)).toThrow('source must be a string');
  });

  it('keeps evaluator fallback for malformed source outside project loading', () => {
    const diagnostics: ExpressionDiagnostic[] = [];
    const scripting = { enabled: true, source: null, modules: [] } as unknown as Parameters<
      typeof resolveExpressionTransforms
    >[4];
    expect(resolveExpressionTransforms([], {}, diagnostics, 1, scripting).size).toBe(0);
    expect(diagnostics[0]?.message).toContain('Invalid scripting settings');
  });

  it('uses the same filename policy regardless of host globals', () => {
    Object.defineProperty(globalThis, 'portableTestHelper', { configurable: true, value: {} });
    try {
      expect(scriptModuleName('portableTestHelper.js')).toBe('portableTestHelper');
      expect(scriptModuleName('process.js')).toBe('process');
      expect(scriptModuleName('window.js')).toBe('window');
      expect(() => scriptModuleName('Promise.js')).toThrow('Reserved module name');
      expect(() => scriptModuleName('console.js')).toThrow('Reserved module name');
    } finally {
      Reflect.deleteProperty(globalThis, 'portableTestHelper');
    }
    expect(scriptModuleName('portableTestHelper.js')).toBe('portableTestHelper');
  });
});
