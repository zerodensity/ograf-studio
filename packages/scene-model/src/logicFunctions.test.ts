import { describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createCustomActionDefinition,
  createFieldDefinition,
  createMediaCue,
  createProject,
} from './factory';
import { migrateProject } from './migrations';
import { inspectDataFieldUsage } from './dataFieldUsage';
import type { LogicFunctionDefinition } from './types';
import {
  MAX_LOGIC_FUNCTION_SOURCE_BYTES,
  MAX_LOGIC_FUNCTION_STATE_BYTES,
  assertLogicFunctionReferenceRemovable,
  isLogicFunctionAlias,
  logicFunctionJsonErrors,
  validateLogicFunctionDefinitions,
} from './logicFunctions';

function fixture() {
  const composition = createComposition({
    dataFields: [
      createFieldDefinition('number', { id: 'in', key: 'input' }),
      createFieldDefinition('number', { id: 'out', key: 'output' }),
    ],
    customActions: [
      createCustomActionDefinition({ actionId: 'calculate' }),
      createCustomActionDefinition({ actionId: 'done' }),
    ],
    mediaCues: [createMediaCue({ id: 'ding' })],
  });
  const definition: LogicFunctionDefinition = {
    type: 'javascript',
    version: 1,
    id: 'double',
    name: 'Double value',
    enabled: true,
    source: '({data,state}) => ({data:{result:data.value*2},state})',
    inputs: { value: 'in' },
    outputs: { result: 'out' },
    actions: ['calculate'],
    emits: { completed: 'done' },
    media: { chime: 'ding' },
    initialState: { count: 0 },
    timeoutMs: 250,
  };
  return { composition, definition };
}

describe('reusable function contracts', () => {
  it('preserves all function settings through factory, JSON save and migration without evaluating source', () => {
    const { composition, definition } = fixture();
    definition.source = '(()=>{throw new Error("must not execute during authoring")})()';
    definition.pointer = true;
    const configured = createComposition({ ...composition, functions: [definition] });
    const project = createProject({
      compositions: [configured],
      mainCompositionId: configured.id,
      supportsNonRealTime: false,
    });
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(reopened.compositions[0]!.functions).toEqual([definition]);
    expect(validateLogicFunctionDefinitions([definition], configured)).toEqual([]);
    expect(migrateProject(createProject()).compositions[0]!.functions).toBeUndefined();
    const fields = inspectDataFieldUsage(project).fields;
    expect(fields.map((field) => field.status)).toEqual(['referenced', 'referenced']);
    expect(fields[0]!.references).toEqual([
      {
        kind: 'function',
        ownerId: 'double',
        targetProperty: 'value',
        enabled: true,
        access: 'read',
      },
    ]);
    expect(fields[1]!.references[0]!.access).toBe('write');
  });
  it('rejects dangling references, duplicate writers/names and unsafe aliases', () => {
    const { composition, definition } = fixture();
    for (const patch of [
      { inputs: { value: 'missing' } },
      { outputs: { result: 'missing' } },
      { actions: ['missing'] },
      { emits: { done: 'missing' } },
      { media: { ding: 'missing' } },
      { timeoutMs: 15 },
      { timeoutMs: 1001 },
      { inputs: JSON.parse('{"__proto__":"in"}') },
      { enabled: 'yes' },
      { pointer: 'yes' },
      { type: 'external-plugin' },
      { source: '' },
    ])
      expect(
        validateLogicFunctionDefinitions([{ ...definition, ...patch }], composition).length,
      ).toBeGreaterThan(0);
    expect(
      validateLogicFunctionDefinitions(
        [definition, { ...definition, id: 'other' }],
        composition,
      ).join('\n'),
    ).toContain('more than one function writer');
    expect(
      validateLogicFunctionDefinitions(
        [definition, { ...definition, id: 'other', outputs: {} }],
        composition,
      ).join('\n'),
    ).toContain('repeats name');
    expect(isLogicFunctionAlias('board_rows')).toBe(true);
    for (const alias of ['constructor', 'prototype', '__proto__', 'two words', '3first'])
      expect(isLogicFunctionAlias(alias)).toBe(false);
  });
  it('enforces UTF8 byte bounds and bounded JSON state, without accepting cycles or non-JSON values', () => {
    const { composition, definition } = fixture();
    expect(
      validateLogicFunctionDefinitions(
        [{ ...definition, source: 'x'.repeat(MAX_LOGIC_FUNCTION_SOURCE_BYTES) }],
        composition,
      ),
    ).toEqual([]);
    expect(
      validateLogicFunctionDefinitions(
        [{ ...definition, source: 'é'.repeat(MAX_LOGIC_FUNCTION_SOURCE_BYTES) }],
        composition,
      ).join('\n'),
    ).toContain('UTF-8 bytes');
    expect(logicFunctionJsonErrors('x'.repeat(MAX_LOGIC_FUNCTION_STATE_BYTES - 2))).toEqual([]);
    expect(logicFunctionJsonErrors('x'.repeat(MAX_LOGIC_FUNCTION_STATE_BYTES))).not.toEqual([]);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse: unknown[] = [];
    sparse.length = 2;
    for (const value of [
      cycle,
      NaN,
      Infinity,
      new Date(),
      undefined,
      [undefined],
      sparse,
      JSON.parse('{"constructor":1}'),
    ])
      expect(logicFunctionJsonErrors(value)).not.toEqual([]);
    expect(logicFunctionJsonErrors({ board: [[0, 1]], score: 4, paused: false })).toEqual([]);
  });
  it('protects mapped reads/writes, listened/emitted actions and media until reconfigured', () => {
    const { composition, definition } = fixture();
    composition.functions = [definition];
    for (const [kind, id] of [
      ['field', 'in'],
      ['field', 'out'],
      ['action', 'calculate'],
      ['action', 'done'],
      ['cue', 'ding'],
    ] as const)
      expect(() => assertLogicFunctionReferenceRemovable(composition, kind, id)).toThrow(
        /Remove or reconfigure the function first/,
      );
    expect(() =>
      assertLogicFunctionReferenceRemovable(composition, 'field', 'other'),
    ).not.toThrow();
    composition.functions = [];
    expect(() => assertLogicFunctionReferenceRemovable(composition, 'field', 'in')).not.toThrow();
  });
  it('rejects accessors without invoking them and rejects state that JSON would silently change', () => {
    const getter = vi.fn(() => 7);
    const accessor = Object.defineProperty({}, 'score', { enumerable: true, get: getter });
    const arrayAccessor = Object.defineProperty([0], '0', { enumerable: true, get: getter });
    const extra = Object.assign([1], { another: true });
    const symbol = { [Symbol('hidden')]: 1 };
    const hidden = Object.defineProperty({}, 'score', { enumerable: false, value: 1 });
    for (const value of [accessor, arrayAccessor, extra, symbol, hidden])
      expect(logicFunctionJsonErrors(value)).not.toEqual([]);
    expect(getter).not.toHaveBeenCalled();
    expect(logicFunctionJsonErrors(Object.assign(Object.create(null), { score: 7 }))).toEqual([]);
  });
});
