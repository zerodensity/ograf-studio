import { describe, expect, it, vi } from 'vitest';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import {
  bindRuntimeKeyboard,
  claimsRuntimeKeyboardInput,
  hasRuntimeKeyboardRules,
} from './runtimeKeyboard';

class Host extends EventTarget {
  nodeType = 1;
  tagName = 'OGRAF-GRAPHIC';
  isContentEditable = false;
  attributes = new Map<string, string>();
  focus = vi.fn();
  hasAttribute(key: string) {
    return this.attributes.has(key);
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  set tabIndex(value: number) {
    this.attributes.set('tabindex', String(value));
  }
}
const rules = (enabled = true) =>
  [
    {
      visualRules: [
        {
          id: 'key',
          enabled,
          trigger: 'key-down',
          keyboard: { key: 'a', ctrl: true, repeat: false },
          conditions: [{ dataKey: 'condition', operator: 'equals', value: false }],
        },
      ],
    },
  ] as unknown as CompiledLayer[];
function event(type: string, properties: Record<string, unknown> = {}) {
  const value = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(value, { key: 'a', ctrlKey: true, button: 0, ...properties });
  return value;
}

describe('graphic-local keyboard listeners', () => {
  it('claims matching chords independently of data conditions and repeat suppression', () => {
    expect(hasRuntimeKeyboardRules(rules())).toBe(true);
    expect(hasRuntimeKeyboardRules(rules(false))).toBe(false);
    expect(
      claimsRuntimeKeyboardInput(rules(), 'key-down', { key: 'A', ctrlKey: true, repeat: true }),
    ).toBe(true);
    expect(claimsRuntimeKeyboardInput(rules(), 'key-down', { key: 'a' })).toBe(false);
    expect(claimsRuntimeKeyboardInput(rules(), 'key-up', { key: 'a', ctrlKey: true })).toBe(true);
    expect(
      claimsRuntimeKeyboardInput(rules(), 'key-down', {
        key: 'a',
        ctrlKey: true,
        isComposing: true,
      }),
    ).toBe(false);
  });
  it('makes only configured hosts focusable, focuses on pointer input and consumes only claimed keys', () => {
    const host = new Host(),
      receive = vi.fn().mockReturnValue(true);
    const stop = bindRuntimeKeyboard(host as unknown as HTMLElement, true, receive);
    expect(host.getAttribute('tabindex')).toBe('0');
    host.dispatchEvent(event('pointerdown'));
    expect(host.focus).toHaveBeenCalledWith({ preventScroll: true });
    const down = event('keydown');
    host.dispatchEvent(down);
    expect(receive).toHaveBeenLastCalledWith(
      'key-down',
      expect.objectContaining({ key: 'a', ctrlKey: true }),
      down,
    );
    expect(down.defaultPrevented).toBe(true);
    receive.mockReturnValue(false);
    const up = event('keyup');
    host.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    stop();
    stop();
    receive.mockClear();
    host.dispatchEvent(event('keydown'));
    expect(receive).not.toHaveBeenCalled();
    expect(host.hasAttribute('tabindex')).toBe(false);
    const untouched = new Host();
    bindRuntimeKeyboard(untouched as unknown as HTMLElement, false, receive);
    expect(untouched.hasAttribute('tabindex')).toBe(false);
  });
  it('respects interactive composed paths, composition, existing handlers and existing focus settings', () => {
    const host = new Host();
    host.tabIndex = 3;
    const receive = vi.fn().mockReturnValue(true);
    const stop = bindRuntimeKeyboard(host as unknown as HTMLElement, true, receive);
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY', 'DIALOG']) {
      const child = new Host();
      child.tagName = tagName;
      const down = event('keydown');
      Object.defineProperty(down, 'composedPath', { value: () => [child, host] });
      host.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(false);
      const pointer = event('pointerdown');
      Object.defineProperty(pointer, 'composedPath', { value: () => [child, host] });
      host.dispatchEvent(pointer);
    }
    const editable = new Host();
    editable.isContentEditable = true;
    const content = event('keydown');
    Object.defineProperty(content, 'composedPath', { value: () => [editable, host] });
    host.dispatchEvent(content);
    const prevented = event('keydown');
    prevented.preventDefault();
    host.dispatchEvent(prevented);
    host.dispatchEvent(event('keydown', { isComposing: true }));
    host.dispatchEvent(event('keydown', { keyCode: 229 }));
    host.dispatchEvent(event('compositionstart'));
    host.dispatchEvent(event('keyup'));
    host.dispatchEvent(event('compositionend'));
    expect(receive).not.toHaveBeenCalled();
    expect(host.focus).not.toHaveBeenCalled();
    stop();
    expect(host.getAttribute('tabindex')).toBe('3');
  });
});
