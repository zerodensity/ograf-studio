import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createCustomActionDefinition,
  createMediaCue,
  type LogicFunctionDefinition,
} from '@ograf-editor/scene-model';
import {
  createFunctionsDraft,
  duplicateFunctionDraft,
  functionsDraftDirty,
  materializeFunctionsDraft,
  newFunctionDraft,
} from './functionsDraft';

function fixture() {
  const composition = createComposition();
  composition.dataFields = [
    createFieldDefinition('number', { id: 'input', key: 'input' }),
    createFieldDefinition('number', { id: 'output', key: 'output' }),
  ];
  composition.customActions = [
    createCustomActionDefinition({ actionId: 'button' }),
    createCustomActionDefinition({ actionId: 'done' }),
  ];
  composition.mediaCues = [createMediaCue({ id: 'sound' })];
  const definition: LogicFunctionDefinition = {
    id: 'counter',
    name: 'Counter',
    type: 'javascript',
    version: 1,
    enabled: true,
    source: '(ctx) => ({ state: ctx.state, data: { result: ctx.data.value } })',
    inputs: { value: 'input' },
    outputs: { result: 'output' },
    actions: ['button'],
    emits: { done: 'done' },
    media: { tone: 'sound' },
    initialState: { count: 0 },
    timeoutMs: 250,
  };
  return {
    composition,
    definition,
    draft: createFunctionsDraft('project:composition', [definition]),
  };
}

describe('Functions authoring drafts', () => {
  it('round-trips mappings, state and timeout while keeping source as unexecuted text', () => {
    const { composition, definition, draft } = fixture();
    expect(functionsDraftDirty(draft)).toBe(false);
    const result = materializeFunctionsDraft(draft, composition, [definition]);
    expect(result.errors).toEqual([]);
    expect(result.functions).toEqual([definition]);
    draft.entries[0]!.source = '(() => { throw new Error("must not execute during Apply"); })()';
    expect(() => materializeFunctionsDraft(draft, composition, [definition])).not.toThrow();
    expect(functionsDraftDirty(draft)).toBe(true);
    expect(definition.source).toContain('ctx.data.value');
  });

  it('blocks stale updates, duplicate aliases, missing references and invalid JSON/timeout', () => {
    const { composition, definition, draft } = fixture();
    expect(
      materializeFunctionsDraft(draft, composition, [
        { ...definition, name: 'Changed elsewhere' },
      ]).errors.join(' '),
    ).toContain('changed elsewhere');
    draft.entries[0]!.inputs.push({ id: 'row2', alias: 'value', target: 'missing' });
    draft.entries[0]!.initialStateText = '{broken';
    draft.entries[0]!.timeoutText = '1';
    const errors = materializeFunctionsDraft(draft, composition, [definition]).errors.join(' ');
    expect(errors).toContain('used more than once');
    expect(errors).toContain('missing data field');
    expect(errors).toContain('valid JSON');
    expect(errors).toContain('timeoutMs');
  });

  it('duplicates source and all bindings under a fresh identity without aliasing the original', () => {
    const { composition, definition, draft } = fixture();
    const original = draft.entries[0]!;
    const copy = duplicateFunctionDraft(original, draft.entries);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Counter copy');
    expect(copy.enabled).toBe(false);
    expect(copy.source).toBe(original.source);
    expect(copy.outputs[0]!.target).toBe('output');
    expect(copy.outputs[0]!.id).not.toBe(original.outputs[0]!.id);
    draft.entries.push(copy);
    expect(materializeFunctionsDraft(draft, composition, [definition]).errors.join(' ')).toContain(
      'more than one function writer',
    );
    copy.outputs = [];
    expect(original.outputs).toHaveLength(1);
    expect(materializeFunctionsDraft(draft, composition, [definition]).errors).toEqual([]);
  });

  it('creates unique neutral functions and supports explicitly applying an empty list', () => {
    const first = newFunctionDraft([]),
      second = newFunctionDraft([newFunctionDraft([])]);
    expect(first.name).toBe('Function #1');
    expect(second.name).toBe('Function #2');
    expect(first.source).toContain('state: ctx.state');
    const { composition, definition, draft } = fixture();
    draft.entries = [];
    expect(materializeFunctionsDraft(draft, composition, [definition])).toEqual({
      functions: [],
      errors: [],
    });
  });
});
