import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  visualRuleKeyboardMatches,
  type VisualRuleKeyboardTrigger,
} from '@ograf-editor/scene-model';
import { RuleKeyboardTriggerEditor } from './RuleKeyboardTriggerEditor';
import {
  friendlyRuleKeyboardKey,
  parseRuleKeyboardKey,
  recordedRuleKeyboard,
  ruleKeyboardShortcutLabel,
} from './ruleKeyboardControls';

const fixture = vi.hoisted(() => ({
  value: { key: 'Enter' } as VisualRuleKeyboardTrigger,
  trigger: 'key-down' as 'key-down' | 'key-up',
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  changed: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'rule-key-options',
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = fixture.stateIndex++;
    if (!(index in fixture.states)) fixture.states[index] = initial;
    return [
      fixture.states[index],
      (value: unknown) => {
        fixture.states[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = fixture.refIndex++;
    return (fixture.refs[index] ??= { current: initial });
  },
}));

function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(value)) return [];
  return [
    value as ReactElement<Record<string, unknown>>,
    ...[value.props.children].flat().flatMap(nodes),
  ];
}
function render() {
  fixture.stateIndex = 0;
  fixture.refIndex = 0;
  return RuleKeyboardTriggerEditor({
    value: fixture.value,
    trigger: fixture.trigger,
    onChange: fixture.changed,
  });
}
function control(label: string) {
  return nodes(render()).find((node) => node.props['aria-label'] === label)!;
}
function invoke(label: string, handler: string, event?: unknown) {
  (control(label).props[handler] as (event: unknown) => void)(event);
}
function keyboardEvent(key: string, overrides: Partial<KeyboardEvent> = {}) {
  const nativeEvent = {
    key,
    keyCode: 0,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  };
  return { ...nativeEvent, nativeEvent, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}
const recordLabel = 'Record keyboard shortcut';
function startRecording() {
  const focus = vi.fn();
  invoke(recordLabel, 'onClick', { currentTarget: { focus } });
  expect(focus).toHaveBeenCalledOnce();
}

beforeEach(() => {
  fixture.value = { key: 'Enter' };
  fixture.trigger = 'key-down';
  fixture.states = [];
  fixture.refs = [];
  fixture.changed.mockReset().mockImplementation((value: VisualRuleKeyboardTrigger) => {
    fixture.value = value;
  });
});

describe('keyboard Rule labels and recorded chords', () => {
  it.each([
    [' ', 'Space'],
    ['Escape', 'Escape'],
    ['ArrowLeft', 'Left arrow'],
    ['ArrowRight', 'Right arrow'],
    ['ArrowUp', 'Up arrow'],
    ['ArrowDown', 'Down arrow'],
    ['a', 'A'],
    ['F5', 'F5'],
  ])('round-trips %s through its friendly label %s', (key, label) => {
    expect(friendlyRuleKeyboardKey(key)).toBe(label);
    expect(parseRuleKeyboardKey(label)).toBe(key);
  });

  it('records exact modifiers in a configuration accepted by the Rule matcher', () => {
    const event = keyboardEvent('K', { ctrlKey: true, shiftKey: true });
    const config = recordedRuleKeyboard(event.nativeEvent);
    expect(config).toEqual({ key: 'k', ctrl: true, alt: false, shift: true, meta: false });
    expect(visualRuleKeyboardMatches(config!, event.nativeEvent)).toBe(true);
    expect(visualRuleKeyboardMatches(config!, { ...event.nativeEvent, altKey: true })).toBe(false);
    expect(ruleKeyboardShortcutLabel(config!)).toBe('Ctrl + Shift + K');
  });

  it('ignores composition, unknown keys, pure modifiers and native repeated keydown', () => {
    for (const key of [
      'Control',
      'Alt',
      'Shift',
      'Meta',
      'AltGraph',
      'Dead',
      'Process',
      'Unidentified',
    ])
      expect(recordedRuleKeyboard(keyboardEvent(key).nativeEvent)).toBeNull();
    expect(recordedRuleKeyboard(keyboardEvent('a', { isComposing: true }).nativeEvent)).toBeNull();
    expect(recordedRuleKeyboard(keyboardEvent('a', { keyCode: 229 }).nativeEvent)).toBeNull();
    expect(recordedRuleKeyboard(keyboardEvent('a', { repeat: true }).nativeEvent)).toBeNull();
  });
});

describe('compact keyboard Rule editor', () => {
  it.each(
    [null, {}, 7, [], 'Enter', { key: 7 }, { key: '' }, { key: null }, { key: '\t' }].map(
      (value) => [value],
    ),
  )(
    'renders a safe fallback for malformed imported config %j without changing its source',
    (raw) => {
      fixture.value = raw as VisualRuleKeyboardTrigger;
      const original = structuredClone(raw);
      expect(renderToStaticMarkup(render())).toContain('value="Enter"');
      expect(ruleKeyboardShortcutLabel(fixture.value)).toBe('Enter');
      invoke('Rule keyboard key', 'onBlur');
      expect(fixture.changed).not.toHaveBeenCalled();
      expect(fixture.value).toEqual(original);
      invoke('Rule keyboard key', 'onChange', { target: { value: 'K' } });
      invoke('Rule keyboard key', 'onBlur');
      expect(fixture.changed).toHaveBeenCalledExactlyOnceWith({ key: 'k' });
    },
  );

  it('shows the default Enter key, exact modifiers and repeat only for key-down', () => {
    expect(control('Rule keyboard key').props.value).toBe('Enter');
    for (const modifier of ['ctrl', 'alt', 'shift', 'meta'])
      expect(control(`Rule keyboard ${modifier}`).props.checked).toBe(false);
    expect(control('Allow keyboard repeat').props.checked).toBe(false);
    invoke('Rule keyboard ctrl', 'onChange', { target: { checked: true } });
    invoke('Allow keyboard repeat', 'onChange', { target: { checked: true } });
    expect(fixture.value).toEqual({ key: 'Enter', ctrl: true, repeat: true });
    fixture.trigger = 'key-up';
    expect(control('Allow keyboard repeat')).toBeUndefined();
    expect(renderToStaticMarkup(render())).toContain('Rule keyboard ctrl');
  });

  it('listens only after explicit Record and suppresses both edges of the recorded chord', () => {
    const idle = keyboardEvent('q');
    invoke(recordLabel, 'onKeyDownCapture', idle);
    expect(idle.preventDefault).not.toHaveBeenCalled();
    expect(fixture.changed).not.toHaveBeenCalled();
    startRecording();
    expect(control(recordLabel).props['data-rule-key-recording']).toBe('true');
    const down = keyboardEvent('K', { ctrlKey: true, shiftKey: true });
    invoke(recordLabel, 'onKeyDownCapture', down);
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(down.stopPropagation).toHaveBeenCalledOnce();
    expect(fixture.value).toMatchObject({ key: 'k', ctrl: true, shift: true });
    expect(control(recordLabel).props['data-rule-key-recording']).toBe('true');
    const up = keyboardEvent('K', { ctrlKey: true, shiftKey: true });
    invoke(recordLabel, 'onKeyUpCapture', up);
    expect(up.preventDefault).toHaveBeenCalledOnce();
    expect(up.stopPropagation).toHaveBeenCalledOnce();
    expect(control(recordLabel).props['data-rule-key-recording']).toBeUndefined();
    expect(fixture.changed).toHaveBeenCalledOnce();
  });

  it('cancels recording with Escape and still permits Escape through the key field', () => {
    startRecording();
    invoke(recordLabel, 'onKeyDownCapture', keyboardEvent('Escape'));
    expect(fixture.changed).not.toHaveBeenCalled();
    invoke(recordLabel, 'onKeyUpCapture', keyboardEvent('Escape'));
    expect(control(recordLabel).props['data-rule-key-recording']).toBeUndefined();
    invoke('Rule keyboard key', 'onChange', { target: { value: 'Escape' } });
    invoke('Rule keyboard key', 'onBlur');
    expect(fixture.value.key).toBe('Escape');
  });

  it('does not consume IME or let a repeat/modifier-only event finish the recording', () => {
    startRecording();
    const ime = keyboardEvent('a', { isComposing: true });
    invoke(recordLabel, 'onKeyDownCapture', ime);
    expect(ime.preventDefault).not.toHaveBeenCalled();
    invoke(recordLabel, 'onKeyDownCapture', keyboardEvent('Control', { ctrlKey: true }));
    invoke(recordLabel, 'onKeyDownCapture', keyboardEvent('a', { repeat: true }));
    expect(fixture.changed).not.toHaveBeenCalled();
    expect(control(recordLabel).props['data-rule-key-recording']).toBe('true');
    invoke(recordLabel, 'onBlur');
    const outside = keyboardEvent('a');
    invoke(recordLabel, 'onKeyDownCapture', outside);
    expect(outside.preventDefault).not.toHaveBeenCalled();
    expect(fixture.changed).not.toHaveBeenCalled();
  });

  it('commits friendly names and restores an emptied key instead of saving an invalid Rule', () => {
    invoke('Rule keyboard key', 'onBlur');
    expect(fixture.changed).not.toHaveBeenCalled();
    invoke('Rule keyboard key', 'onChange', { target: { value: 'Left arrow' } });
    const composing = keyboardEvent('Enter', { keyCode: 229 });
    invoke('Rule keyboard key', 'onKeyDown', composing);
    expect(composing.preventDefault).not.toHaveBeenCalled();
    expect(fixture.changed).not.toHaveBeenCalled();
    const enter = keyboardEvent('Enter');
    invoke('Rule keyboard key', 'onKeyDown', enter);
    expect(fixture.value.key).toBe('ArrowLeft');
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    fixture.changed.mockClear();
    invoke('Rule keyboard key', 'onChange', { target: { value: '' } });
    invoke('Rule keyboard key', 'onBlur');
    expect(fixture.changed).not.toHaveBeenCalled();
    expect(control('Rule keyboard key').props.value).toBe('Left arrow');
  });
});
