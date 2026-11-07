import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const runtime = readFileSync(new URL('./offlinePreviewRuntime.js', import.meta.url), 'utf8');
const source = runtime.slice(
  runtime.indexOf('  function showLanes('),
  runtime.indexOf('  function showActions()'),
);

class ElementStub {
  children: ElementStub[] = [];
  listeners: Record<string, Array<() => void>> = {};
  dataset: Record<string, string> = {};
  value = '';
  textContent = '';
  className = '';
  open = false;
  disabled = false;
  attributes = new Map<string, string>();
  constructor(public tag: string) {}
  appendChild(child: ElementStub) {
    this.children.push(child);
    if (this.tag === 'select' && !this.value) this.value = child.value;
    return child;
  }
  replaceChildren() {
    this.children = [];
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type: string) {
    for (const fn of this.listeners[type] ?? []) fn();
  }
  contains(element: unknown): boolean {
    return this === element || this.children.some((child) => child.contains(element));
  }
  querySelectorAll() {
    const all: ElementStub[] = [];
    const walk = (el: ElementStub) => {
      if (el.tag === 'details' && el.dataset.formKey) all.push(el);
      el.children.forEach(walk);
    };
    walk(this);
    return all;
  }
}

describe('offline coordinated lane UI', () => {
  it('immediately opens selected fields, preserves drafts and guards live updates', async () => {
    const lanes = new ElementStub('main');
    const fieldForms: Array<{
      parent: ElementStub;
      input: ElementStub;
      fields: Record<string, unknown>;
      values: Record<string, unknown>;
      change: (path: string[], value: unknown) => void;
    }> = [];
    const commands: Array<{ type: string; params: unknown }> = [];
    type Selection = { stateId: string; data: Record<string, string> };
    type Snapshot = {
      slots: Record<
        string,
        {
          current?: Selection | null;
          incoming?: Selection | null;
          pending?: { stateId: string } | null;
          transition?: object | null;
        }
      >;
    };
    let snapshot: Snapshot = {
      slots: { headline: { current: { stateId: 'a', data: { shared: 'ON AIR' } } } },
    };
    let publish: (value: typeof snapshot) => void = () => {};
    const runtimeContext = {
      document: {
        createElement: (tag: string) => new ElementStub(tag),
        activeElement: null as ElementStub | null,
      },
      lanes,
      graphic: {
        getPlayoutSnapshot: () => snapshot,
        subscribePlayout: (fn: typeof publish) => {
          publish = fn;
          fn(snapshot);
        },
      },
      manifest: { customActions: [] },
      stateSchemas: {
        headline: {
          a: { default: { shared: 'A default' }, properties: { shared: { type: 'string' } } },
          b: {
            default: { shared: 'B preset', other: 'B only' },
            properties: { shared: { type: 'string' }, other: { type: 'string' } },
          },
        },
      },
      laneForms: new Map(),
      playoutMutations: 0,
      heading: (parent: ElementStub) => parent.appendChild(new ElementStub('section')),
      button: (label: string, callback: () => void) => {
        const el = new ElementStub('button');
        el.textContent = label;
        el.addEventListener('click', callback);
        return el;
      },
      fieldRows: (
        parent: ElementStub,
        fields: Record<string, unknown>,
        values: Record<string, unknown>,
        change: (path: string[], value: unknown) => void,
      ) => {
        const input = parent.appendChild(new ElementStub('input'));
        fieldForms.push({ parent, input, fields, values, change });
      },
      clone: (value: unknown) =>
        value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
      defaults: (_schema: unknown, values: unknown) => values,
      patchFor: (path: string[], value: unknown) => ({ [path[0]!]: value }),
      say: vi.fn(),
      run: (_label: string, callback: () => unknown) => {
        void callback();
      },
      call: (type: string, params: unknown) => {
        commands.push({ type, params });
        return Promise.resolve({ statusCode: 200 });
      },
      updateOfflineLaneData: vi.fn(() => Promise.resolve({ statusCode: 200 })),
      setTimeout,
    };
    const showLanes = runInNewContext(`${source}\nshowLanes`, runtimeContext);
    showLanes(
      {
        properties: {
          headline: { title: 'Headline', properties: { stateId: { enum: ['', 'a', 'b'] } } },
        },
      },
      { slots: { headline: { stateId: 'a' } } },
    );
    const group = lanes.children[0]!;
    const lane = group.children[0]!;
    const row = lane.children[1]!;
    const section = lane.children[2]!;
    const select = row.children[0]!;
    expect(group.className).toBe('section preview-transition-controls');
    expect(lane.className).toBe('preview-transition-slot');
    expect(lane.attributes.get('role')).toBe('group');
    expect(lane.attributes.get('aria-label')).toBe('Headline');
    expect(row.className).toBe('preview-transition-slot-actions');
    expect(lane.children[0]!.children[0]!.textContent).toBe('Headline');
    expect(lane.children[0]!.children[1]!.textContent).toBe('On · a');
    expect(lane.children[0]!.children[1]!.dataset.state).toBe('on');
    expect(row.children[1]!.attributes.get('aria-label')).toBe('Take Headline');
    expect(row.children[2]!.attributes.get('aria-label')).toBe('Out Headline');
    const form = (stateId: string) => {
      const parent = section.children.find((detail) => detail.dataset.stateId === stateId);
      return [...fieldForms].reverse().find((item) => item.parent === parent)!;
    };
    expect(form('a').values.shared).toBe('ON AIR');
    // Even a stale focus reference must not prevent a deliberate dropdown selection.
    runtimeContext.document.activeElement = form('a').input;
    select.value = 'b';
    select.fire('change');
    expect(section.children.map((detail) => detail.dataset.formKey)).toEqual(['next:b']);
    expect(section.children.map((detail) => detail.open)).toEqual([true]);
    expect(form('a')).toBeUndefined();
    expect(form('b').values).toMatchObject({ shared: 'B preset', other: 'B only' });
    expect(Object.keys(form('b').fields)).toEqual(['shared', 'other']);
    expect(commands).toHaveLength(0);
    expect(runtimeContext.updateOfflineLaneData).not.toHaveBeenCalled();

    // A poll updates observations but never replaces a currently edited field.
    const focused = form('b');
    runtimeContext.document.activeElement = focused.input;
    snapshot = { slots: { headline: { current: { stateId: 'a', data: { shared: 'NEW A' } } } } };
    publish(snapshot);
    expect(form('b').parent).toBe(focused.parent);
    runtimeContext.document.activeElement = null;
    focused.parent.open = false;
    publish(snapshot);
    expect(form('b').parent.open).toBe(false);
    select.value = 'a';
    select.fire('change');
    expect(section.children.map((detail) => detail.dataset.formKey)).toEqual(['on-air:a']);
    expect(form('a').parent.open).toBe(true);
    select.value = 'b';
    select.fire('change');
    expect(form('b').parent.open).toBe(true);
    form('b').change(['shared'], 'STAGED');
    select.value = 'a';
    select.fire('change');
    expect(form('a').values.shared).toBe('NEW A');
    select.value = 'b';
    select.fire('change');
    expect(form('b').values.shared).toBe('STAGED');
    expect(commands).toHaveLength(0);
    row.children[1]!.fire('click');
    expect(commands.at(-1)).toEqual({
      type: 'customAction',
      params: {
        id: 'transition.take',
        payload: { slotId: 'headline', stateId: 'b', data: { shared: 'STAGED' } },
      },
    });
    snapshot = { slots: { headline: { current: { stateId: 'b', data: { shared: 'STAGED' } } } } };
    publish(snapshot);
    expect(section.children.map((detail) => detail.dataset.formKey)).toEqual(['on-air:b']);
    expect(form('b').parent.open).toBe(true);
    expect(form('b').values.shared).toBe('STAGED');
    form('b').change(['shared'], 'UPDATED');
    expect(runtimeContext.updateOfflineLaneData).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      'headline',
      { shared: 'UPDATED' },
      'b',
    );

    // An edit can arrive after Take captured its payload but before the new state is on air.
    select.value = 'a';
    select.fire('change');
    row.children[1]!.fire('click');
    snapshot = {
      slots: {
        headline: {
          current: { stateId: 'b', data: { shared: 'STAGED' } },
          pending: { stateId: 'a' },
        },
      },
    };
    publish(snapshot);
    form('a').change(['shared'], 'LATE EDIT');
    snapshot = {
      slots: {
        headline: {
          current: { stateId: 'b', data: { shared: 'STAGED' } },
          incoming: { stateId: 'a', data: { shared: 'OLD' } },
          transition: {},
        },
      },
    };
    publish(snapshot);
    expect(runtimeContext.updateOfflineLaneData).toHaveBeenCalledTimes(1);
    snapshot = { slots: { headline: { current: { stateId: 'a', data: { shared: 'OLD' } } } } };
    publish(snapshot);
    expect(runtimeContext.updateOfflineLaneData).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      'headline',
      { shared: 'LATE EDIT' },
      'a',
    );

    // Selection does not flush staged values even if runtime visibility changed before its event.
    select.value = 'b';
    select.fire('change');
    form('b').change(['shared'], 'B DRAFT');
    snapshot = { slots: { headline: { current: { stateId: 'b', data: { shared: 'OLD B' } } } } };
    select.value = 'a';
    select.fire('change');
    expect(runtimeContext.updateOfflineLaneData).toHaveBeenCalledTimes(2);
    publish(snapshot);
    expect(runtimeContext.updateOfflineLaneData).toHaveBeenCalledTimes(3);
    expect(runtimeContext.updateOfflineLaneData).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      'headline',
      { shared: 'B DRAFT' },
      'b',
    );
  });
});
