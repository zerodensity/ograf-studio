import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const runtime = readFileSync(new URL('./offlinePreviewRuntime.js', import.meta.url), 'utf8');
const source = runtime.slice(0, runtime.indexOf('(async function ()'));

class ElementStub extends EventTarget {
  textContent = '';
  hidden = false;
  disabled = true;
  children: ElementStub[] = [];
  get childElementCount() {
    return this.children.length;
  }
  get lastElementChild() {
    return { remove: () => this.children.pop() };
  }
  append(...children: ElementStub[]) {
    this.children.push(...children);
  }
  prepend(child: ElementStub) {
    this.children.unshift(child);
  }
  replaceChildren() {
    this.children = [];
  }
}

function setup() {
  const install = runInNewContext(`${source}\ninstallFrameCueLog`) as (
    graphic: EventTarget,
  ) => () => void;
  const entries = new ElementStub();
  const count = new ElementStub();
  const empty = new ElementStub();
  const clear = new ElementStub();
  const elements = new Map([
    ['frame-cue-entries', entries],
    ['frame-cue-count', count],
    ['frame-cue-empty', empty],
    ['frame-cue-clear', clear],
  ]);
  const graphic = Object.assign(new EventTarget(), {
    ownerDocument: {
      getElementById: (id: string) => elements.get(id),
      createElement: () => new ElementStub(),
    },
  });
  const dispose = install(graphic);
  const fireCue = (detail: Record<string, unknown>) =>
    graphic.dispatchEvent(new CustomEvent('ograf-studio-cue', { detail }));
  return { entries, count, empty, clear, dispose, fireCue };
}

describe('offline preview frame cue log', () => {
  it('records emitted cue details as text, including coordinated identity and a JSON payload', () => {
    const { entries, count, empty, clear, fireCue } = setup();
    fireCue({ name: '<Blue>', frame: 0, instanceId: 'single' });
    fireCue({
      name: 'Amber',
      frame: 12,
      instanceId: 'amber-instance',
      laneId: 'lane-a',
      templateId: 'template-a',
      payload: { note: '<img>' },
    });
    expect(entries.children.map((row) => row.children.map((node) => node.textContent))).toEqual([
      [
        'Amber',
        'Frame 12 · Instance amber-instance · Lane lane-a · Template template-a',
        '{"note":"<img>"}',
      ],
      ['<Blue>', 'Frame 0 · Instance single'],
    ]);
    expect(count.textContent).toBe('2');
    expect(empty.hidden).toBe(true);
    expect(clear.disabled).toBe(false);
  });

  it('keeps the latest twenty cues, clears them, and unsubscribes on disposal', () => {
    const { entries, count, empty, clear, dispose, fireCue } = setup();
    for (let frame = 0; frame < 21; frame++) fireCue({ name: 'cue', frame, instanceId: 'single' });
    expect(count.textContent).toBe('20');
    expect(entries.children.at(0)?.children[1]?.textContent).toBe('Frame 20 · Instance single');
    expect(entries.children.at(-1)?.children[1]?.textContent).toBe('Frame 1 · Instance single');

    clear.dispatchEvent(new Event('click'));
    expect(entries.children).toHaveLength(0);
    expect(count.textContent).toBe('0');
    expect(empty.hidden).toBe(false);
    expect(clear.disabled).toBe(true);

    dispose();
    fireCue({ name: 'cue', frame: 21, instanceId: 'single' });
    expect(entries.children).toHaveLength(0);
  });
});
