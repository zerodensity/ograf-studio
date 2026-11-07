import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  type Project,
  type LogicFunctionDefinition,
} from '@ograf-editor/scene-model';
import { FunctionsEditor } from './FunctionsPanel';

const fixture = vi.hoisted(() => ({
  project: null as unknown as Project,
  activeCompositionId: '',
  stateIndex: 0,
  states: [] as unknown[],
  setLogicFunctions: vi.fn(),
}));
vi.mock('../state/projectStore', () => ({
  useProjectStore: Object.assign((select: (state: typeof fixture) => unknown) => select(fixture), {
    getState: () => fixture,
  }),
  useActiveComposition: () => fixture.project.compositions[0],
}));
vi.mock('../state/historyStore', () => ({ runDiscreteHistoryStep: (run: () => void) => run() }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = fixture.stateIndex++;
    if (!(index in fixture.states))
      fixture.states[index] = typeof initial === 'function' ? initial() : initial;
    return [
      fixture.states[index],
      (next: unknown) => {
        fixture.states[index] = next;
      },
    ];
  },
}));
function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(value)) return [];
  return [value as ReactElement<Record<string, unknown>>, ...nodes(value.props.children)];
}
function render() {
  fixture.stateIndex = 0;
  const composition = fixture.project.compositions[0]!;
  return FunctionsEditor({ ownerKey: `${fixture.project.id}:${composition.id}`, composition });
}
function button(label: string) {
  return nodes(render()).find((node) => node.type === 'button' && node.props.children === label)!;
}
function click(label: string) {
  (button(label).props.onClick as () => void)();
}
function change(label: string, value: string) {
  const input = nodes(render()).find((node) => node.props['aria-label'] === label)!;
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}

beforeEach(() => {
  fixture.project = createProject();
  fixture.activeCompositionId = fixture.project.mainCompositionId;
  fixture.states = [];
  fixture.setLogicFunctions
    .mockReset()
    .mockImplementation((functions: LogicFunctionDefinition[], id: string) => {
      fixture.project.compositions.find((item) => item.id === id)!.functions =
        structuredClone(functions);
    });
});

describe('Functions pane explicit authoring flow', () => {
  it('keeps Mouse input off by default and persists the explicit opt-in on Apply', () => {
    click('Add function');
    const checkbox = () =>
      nodes(render()).find((node) => node.props['aria-label'] === 'Function mouse input')!;
    expect(checkbox().props.checked).toBe(false);
    (checkbox().props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(fixture.setLogicFunctions).not.toHaveBeenCalled();
    expect(checkbox().props.checked).toBe(true);
    click('Apply changes');
    expect(fixture.project.compositions[0]!.functions![0]!.pointer).toBe(true);
    (checkbox().props.onChange as (event: unknown) => void)({ target: { checked: false } });
    click('Apply changes');
    expect(fixture.project.compositions[0]!.functions![0]!.pointer).toBe(false);
  });
  it('keeps edits local until Apply and never evaluates source text', () => {
    click('Add function');
    const source = '(() => { throw new Error("not editor code"); })()';
    change('Function source', source);
    expect(fixture.setLogicFunctions).not.toHaveBeenCalled();
    expect(fixture.project.compositions[0]!.functions).toBeUndefined();
    click('Apply changes');
    expect(fixture.setLogicFunctions).toHaveBeenCalledOnce();
    expect(fixture.project.compositions[0]!.functions![0]!.source).toBe(source);
    expect(button('Apply changes').props.disabled).toBe(true);
  });

  it('retains an unapplied draft when the pane remounts and discards only on request', () => {
    click('Add function');
    change('Function name', 'Pending logic');
    fixture.states = [];
    expect(renderToStaticMarkup(render())).toContain('Pending logic');
    expect(fixture.setLogicFunctions).not.toHaveBeenCalled();
    click('Discard draft');
    expect(renderToStaticMarkup(render())).not.toContain('Pending logic');
    expect(fixture.setLogicFunctions).not.toHaveBeenCalled();
  });

  it('blocks stale document changes and reports structural errors without writing', () => {
    click('Add function');
    change('Function initial state', '{broken');
    click('Apply changes');
    expect(renderToStaticMarkup(render())).toContain('valid JSON');
    expect(fixture.setLogicFunctions).not.toHaveBeenCalled();
    fixture.project.compositions[0]!.functions = [
      {
        id: 'external',
        name: 'Other change',
        type: 'javascript',
        version: 1,
        enabled: false,
        source: '(ctx) => ({state:ctx.state})',
        inputs: {},
        outputs: {},
        actions: [],
      },
    ];
    expect(button('Apply changes').props.disabled).toBe(true);
    click('Apply changes');
    expect(fixture.setLogicFunctions).not.toHaveBeenCalled();
    click('Discard draft');
    expect(renderToStaticMarkup(render())).toContain('Other change');
  });
});
