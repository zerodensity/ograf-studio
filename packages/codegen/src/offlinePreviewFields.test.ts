import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const runtime = readFileSync(new URL('./offlinePreviewRuntime.js', import.meta.url), 'utf8');
const source = runtime.slice(
  runtime.indexOf('  function fieldRows('),
  runtime.indexOf('  function showData('),
);

class FieldElement {
  children: FieldElement[] = [];
  attributes = new Map<string, string>();
  listeners: Record<string, (event: { currentTarget: FieldElement }) => void> = {};
  value = '';
  type = '';
  className = '';
  textContent = '';
  validity = { valid: true };
  tagName: string;
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  appendChild(child: FieldElement) {
    this.children.push(child);
    return child;
  }
  replaceChildren() {
    this.children = [];
  }
  contains(target: FieldElement | null): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }
  addEventListener(type: string, callback: (event: { currentTarget: FieldElement }) => void) {
    this.listeners[type] = callback;
  }
  fire(type: string) {
    this.listeners[type]!({ currentTarget: this });
  }
  byLabel(label: string): FieldElement | undefined {
    return this.attributes.get('aria-label') === label
      ? this
      : this.children.map((child) => child.byLabel(label)).find(Boolean);
  }
}

function setup(schema: Record<string, unknown>, value: unknown) {
  const parent = new FieldElement('div');
  const values = { value };
  const changed = vi.fn();
  const say = vi.fn();
  const render = runInNewContext(`${source}\nfieldRows`, {
    document: { createElement: (tag: string) => new FieldElement(tag) },
    heading: (target: FieldElement) => target.appendChild(new FieldElement('section')),
    valueFor: (_schema: unknown, input: unknown) => input,
    setPath: (target: Record<string, unknown>, path: string[], next: unknown) => {
      target[path[0]!] = next;
    },
    say,
  });
  render(parent, { value: { title: 'Tint', ...schema } }, values, changed);
  return { parent, values, changed, say };
}

function setupAction(schema: Record<string, unknown>) {
  const actionsPanel = new FieldElement('div');
  const doc = {
    createElement: (tag: string) => new FieldElement(tag),
    activeElement: null as FieldElement | null,
  };
  const pendingBlur: Array<() => void> = [];
  const sent = vi.fn();
  const say = vi.fn();
  const actionSource = runtime.slice(
    runtime.indexOf('  function showActions()'),
    runtime.indexOf('  async function stageOfflineLaneDraftsForPlay()'),
  );
  const render = runInNewContext(`${source}\n${actionSource}\nshowActions`, {
    document: doc,
    actionsPanel,
    manifest: { customActions: [{ id: 'demo', name: 'Demo', schema }] },
    heading: (target: FieldElement) => target.appendChild(new FieldElement('section')),
    valueFor: (_schema: unknown, input: unknown) => input,
    setPath: (target: Record<string, unknown>, path: string[], next: unknown) => {
      target[path[0]!] = next;
    },
    defaults: (input: { properties: Record<string, { default: unknown }> }) =>
      Object.fromEntries(
        Object.entries(input.properties).map(([key, property]) => [
          key,
          structuredClone(property.default),
        ]),
      ),
    button: (text: string, callback: () => void) => {
      const button = new FieldElement('button');
      button.textContent = text;
      button.addEventListener('click', callback);
      return button;
    },
    run: (_label: string, callback: () => unknown) => callback(),
    call: (_type: string, params: unknown) => sent(structuredClone(params)),
    setTimeout: (callback: () => void) => pendingBlur.push(callback),
    say,
  });
  render();
  const detail = actionsPanel.children[0]!.children[0]!;
  const fields = detail.children[1]!;
  const run = detail.children[2]!;
  return { doc, fields, run, sent, say, pendingBlur };
}

describe('offline Studio-style exposed field controls', () => {
  it('keeps color swatch and editable hex synchronized without publishing invalid drafts', () => {
    const { parent, values, changed, say } = setup(
      { type: 'string', gddType: 'color-rrggbb' },
      '#112233',
    );
    const swatch = parent.byLabel('Tint')!;
    const hex = parent.byLabel('Tint hex')!;
    expect(swatch.type).toBe('color');
    expect(hex.value).toBe('#112233');
    hex.value = '#abcdef';
    hex.fire('input');
    expect(values.value).toBe('#abcdef');
    expect(swatch.value).toBe('#abcdef');
    expect(changed).toHaveBeenLastCalledWith(['value'], '#abcdef');
    hex.value = '#ab';
    hex.fire('input');
    expect(values.value).toBe('#abcdef');
    expect(changed).toHaveBeenCalledOnce();
    expect(hex.attributes.get('aria-invalid')).toBe('true');
    expect(say).toHaveBeenLastCalledWith('Use #RRGGBB.', true);
    swatch.value = '#654321';
    swatch.fire('input');
    expect(hex.value).toBe('#654321');
    expect(hex.attributes.get('aria-invalid')).toBe('false');
  });

  it('preserves alpha through hex, swatch and percentage edits', () => {
    const { parent, values } = setup({ type: 'string', gddType: 'color-rrggbbaa' }, '#11223380');
    const swatch = parent.byLabel('Tint')!;
    const hex = parent.byLabel('Tint hex')!;
    const alpha = parent.byLabel('Tint opacity percent')!;
    hex.value = '#aabbcc40';
    hex.fire('input');
    expect(swatch.value).toBe('#aabbcc');
    expect(alpha.value).toBe('25.1');
    expect(values.value).toBe('#aabbcc40');
    swatch.value = '#334455';
    swatch.fire('input');
    expect(values.value).toBe('#33445540');
    expect(hex.value).toBe('#33445540');
    alpha.value = '50';
    alpha.fire('change');
    expect(values.value).toBe('#33445580');
    expect(hex.value).toBe('#33445580');
    alpha.value = '';
    alpha.fire('change');
    expect(alpha.attributes.get('aria-invalid')).toBe('true');
    expect(values.value).toBe('#33445580');
    alpha.value = '25';
    alpha.fire('change');
    expect(alpha.attributes.get('aria-invalid')).toBe('false');
    expect(values.value).toBe('#33445540');
    hex.value = '#123456';
    hex.fire('input');
    expect(values.value).toBe('#12345640');
  });

  it('updates text while typing and retains the last valid structured value', () => {
    const text = setup({ type: 'string' }, 'Headline');
    const input = text.parent.byLabel('Tint')!;
    input.value = 'Updated headline';
    input.fire('input');
    expect(text.values.value).toBe('Updated headline');
    const array = setup({ type: 'array' }, [1]);
    const json = array.parent.byLabel('Tint')!;
    json.value = '{}';
    json.fire('input');
    expect(array.values.value).toEqual([1]);
    expect(array.changed).not.toHaveBeenCalled();
    expect(array.say).toHaveBeenLastCalledWith('Enter a JSON array.', true);
    json.value = '[1,2]';
    json.fire('input');
    expect(array.values.value).toEqual([1, 2]);
  });

  it('keeps custom-action text, number and invalid JSON drafts mounted across multiple keystrokes', () => {
    const { doc, fields, run, sent, pendingBlur } = setupAction({
      properties: {
        title: { title: 'Title', type: 'string', default: '' },
        count: { title: 'Count', type: 'number', default: 0 },
        items: { title: 'Items', type: 'array', default: [1] },
      },
    });
    const text = fields.byLabel('Title')!;
    doc.activeElement = text;
    for (const value of ['A', 'AB', 'ABC']) {
      text.value = value;
      text.fire('input');
      expect(fields.byLabel('Title')).toBe(text);
      expect(doc.activeElement).toBe(text);
    }
    const number = fields.byLabel('Count')!;
    doc.activeElement = number;
    for (const value of ['1', '12', '123']) {
      number.value = value;
      number.fire('input');
      expect(fields.byLabel('Count')).toBe(number);
    }
    const json = fields.byLabel('Items')!;
    doc.activeElement = json;
    json.value = '[1,';
    json.fire('input');
    expect(fields.byLabel('Items')).toBe(json);
    expect(json.value).toBe('[1,');
    doc.activeElement = null;
    fields.fire('focusout');
    for (const refresh of pendingBlur.splice(0)) refresh();
    // A blur with an unchanged schema must not discard an invalid structured draft either.
    expect(fields.byLabel('Items')).toBe(json);
    expect(json.value).toBe('[1,');
    run.fire('click');
    expect(sent).toHaveBeenLastCalledWith({
      id: 'demo',
      payload: { title: 'ABC', count: 123, items: [1] },
    });
  });

  it('refreshes conditional custom-action dropdowns immediately with their new valid defaults', () => {
    const { doc, fields, run, sent } = setupAction({
      properties: {
        mode: { title: 'Mode', type: 'string', enum: ['a', 'b'], default: 'a' },
        choice: { title: 'Choice', type: 'string', enum: ['first'], default: 'first' },
      },
      allOf: [
        {
          if: { required: ['mode'], properties: { mode: { const: 'b' } } },
          then: { properties: { choice: { enum: ['second'], default: 'second' } } },
        },
      ],
    });
    const select = fields.byLabel('Mode')!;
    const oldChoice = fields.byLabel('Choice')!;
    doc.activeElement = select;
    select.value = 'b';
    select.fire('change');
    expect(fields.byLabel('Mode')).not.toBe(select);
    expect(fields.byLabel('Choice')).not.toBe(oldChoice);
    expect(fields.byLabel('Mode')!.value).toBe('b');
    expect(fields.byLabel('Choice')!.value).toBe('second');
    run.fire('click');
    expect(sent).toHaveBeenLastCalledWith({ id: 'demo', payload: { mode: 'b', choice: 'second' } });
  });
});
