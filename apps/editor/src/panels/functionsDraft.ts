import {
  validateLogicFunctionDefinitions,
  type Composition,
  type LogicFunctionDefinition,
  type LogicJsonValue,
} from '@ograf-editor/scene-model';

export interface FunctionMappingDraft {
  id: string;
  alias: string;
  target: string;
}
export interface LogicFunctionDraft extends Omit<
  LogicFunctionDefinition,
  'inputs' | 'outputs' | 'emits' | 'media' | 'initialState' | 'timeoutMs'
> {
  inputs: FunctionMappingDraft[];
  outputs: FunctionMappingDraft[];
  emits: FunctionMappingDraft[];
  media: FunctionMappingDraft[];
  initialStateText: string;
  timeoutText: string;
}
export interface FunctionsDraft {
  ownerKey: string;
  baseline: string;
  initialDraft: string;
  entries: LogicFunctionDraft[];
  selectedId: string | null;
}
const nextId = () => `function-${crypto.randomUUID()}`;
const mappingRows = (mapping: Record<string, string> = {}): FunctionMappingDraft[] =>
  Object.entries(mapping ?? {}).map(([alias, target]) => ({ id: nextId(), alias, target }));
export const functionsSignature = (functions: readonly LogicFunctionDefinition[] | undefined) =>
  JSON.stringify(functions ?? []);

export function createFunctionDraft(value: LogicFunctionDefinition): LogicFunctionDraft {
  const { initialState, timeoutMs, inputs, outputs, emits, media, ...rest } = value;
  return {
    ...structuredClone(rest),
    inputs: mappingRows(inputs),
    outputs: mappingRows(outputs),
    emits: mappingRows(emits),
    media: mappingRows(media),
    initialStateText: initialState === undefined ? '' : JSON.stringify(initialState, null, 2),
    timeoutText: timeoutMs === undefined ? '' : String(timeoutMs),
  };
}

export function createFunctionsDraft(
  ownerKey: string,
  functions: readonly LogicFunctionDefinition[] = [],
): FunctionsDraft {
  const entries = functions.map(createFunctionDraft);
  return {
    ownerKey,
    baseline: functionsSignature(functions),
    initialDraft: JSON.stringify(entries),
    entries,
    selectedId: entries[0]?.id ?? null,
  };
}
export const functionsDraftDirty = (draft: FunctionsDraft) =>
  JSON.stringify(draft.entries) !== draft.initialDraft;
export const functionsDraftStale = (
  draft: FunctionsDraft,
  functions: readonly LogicFunctionDefinition[] | undefined,
) => draft.baseline !== functionsSignature(functions);

export function newFunctionDraft(entries: readonly LogicFunctionDraft[]): LogicFunctionDraft {
  const names = new Set(entries.map((entry) => entry.name.trim().toLowerCase()));
  let number = 1;
  while (names.has(`function #${number}`)) number++;
  return createFunctionDraft({
    id: nextId(),
    name: `Function #${number}`,
    type: 'javascript',
    version: 1,
    enabled: true,
    source:
      '(ctx) => {\n  // Read mapped inputs from ctx.data and return mapped output values.\n  return { state: ctx.state };\n}',
    inputs: {},
    outputs: {},
    actions: [],
  });
}

export function duplicateFunctionDraft(
  entry: LogicFunctionDraft,
  entries: readonly LogicFunctionDraft[],
): LogicFunctionDraft {
  const names = new Set(entries.map((candidate) => candidate.name.trim().toLowerCase()));
  let name = `${entry.name} copy`,
    suffix = 2;
  while (names.has(name.toLowerCase())) name = `${entry.name} copy ${suffix++}`;
  const copy = structuredClone(entry);
  copy.id = nextId();
  copy.name = name;
  // Copies retain editable bindings; validation requires resolving duplicate output writers.
  copy.enabled = false;
  for (const mapping of [copy.inputs, copy.outputs, copy.emits, copy.media])
    for (const row of mapping) row.id = nextId();
  return copy;
}

/** Structural checks only: source stays a string and is never evaluated by the authoring UI. */
export function materializeFunctionsDraft(
  draft: FunctionsDraft,
  composition: Pick<Composition, 'dataFields' | 'customActions' | 'mediaCues'>,
  currentFunctions: readonly LogicFunctionDefinition[] | undefined,
): { functions: LogicFunctionDefinition[]; errors: string[] } {
  const errors: string[] = [];
  if (functionsDraftStale(draft, currentFunctions))
    errors.push(
      'Functions changed elsewhere. Discard this draft to load the latest version before applying.',
    );
  const functions = draft.entries.map((entry) => {
    const { inputs, outputs, emits, media, initialStateText, timeoutText, ...rest } = entry;
    const mapping = (rows: FunctionMappingDraft[], label: string) => {
      const aliases = new Set<string>();
      for (const row of rows) {
        if (aliases.has(row.alias))
          errors.push(`${entry.name}: ${label} alias “${row.alias}” is used more than once.`);
        aliases.add(row.alias);
      }
      return Object.fromEntries(rows.map((row) => [row.alias, row.target]));
    };
    let initialState: LogicJsonValue | undefined;
    if (initialStateText.trim()) {
      try {
        initialState = JSON.parse(initialStateText) as LogicJsonValue;
      } catch {
        errors.push(`${entry.name}: Initial state must be valid JSON.`);
      }
    }
    return {
      ...rest,
      inputs: mapping(inputs, 'Input'),
      outputs: mapping(outputs, 'Output'),
      ...(emits.length ? { emits: mapping(emits, 'Emitted action') } : {}),
      ...(media.length ? { media: mapping(media, 'Media') } : {}),
      ...(initialState !== undefined ? { initialState } : {}),
      ...(timeoutText.trim() ? { timeoutMs: Number(timeoutText) } : {}),
    };
  });
  errors.push(...validateLogicFunctionDefinitions(functions, composition));
  return { functions, errors };
}
