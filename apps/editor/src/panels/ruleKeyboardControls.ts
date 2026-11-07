import {
  normalizeVisualRuleKeyboardKey,
  type VisualRuleKeyboardTrigger,
} from '@ograf-editor/scene-model';

export const RULE_KEY_OPTIONS = [
  ['Enter', 'Enter'],
  [' ', 'Space'],
  ['Escape', 'Escape'],
  ['ArrowLeft', 'Left arrow'],
  ['ArrowRight', 'Right arrow'],
  ['ArrowUp', 'Up arrow'],
  ['ArrowDown', 'Down arrow'],
  ['Tab', 'Tab'],
  ['Backspace', 'Backspace'],
  ['Delete', 'Delete'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'Page up'],
  ['PageDown', 'Page down'],
] as const;

export function friendlyRuleKeyboardKey(key: string): string {
  const normalized = normalizeVisualRuleKeyboardKey(key);
  return (
    RULE_KEY_OPTIONS.find(([value]) => value.toLowerCase() === normalized.toLowerCase())?.[1] ??
    ([...normalized].length === 1 ? normalized.toUpperCase() : normalized)
  );
}

export function parseRuleKeyboardKey(label: string): string {
  const option = RULE_KEY_OPTIONS.find(
    ([key, name]) =>
      key.toLowerCase() === label.trim().toLowerCase() ||
      name.toLowerCase() === label.trim().toLowerCase(),
  );
  return option?.[0] ?? normalizeVisualRuleKeyboardKey(label);
}

/** Display an editable fallback without changing a malformed imported Rule. */
export function ruleKeyboardEditorValue(value: unknown): VisualRuleKeyboardTrigger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { key: 'Enter' };
  const config = value as VisualRuleKeyboardTrigger;
  return typeof config.key === 'string' && normalizeVisualRuleKeyboardKey(config.key)
    ? config
    : { key: 'Enter' };
}

export function ruleKeyboardShortcutLabel(config?: VisualRuleKeyboardTrigger): string {
  const keyboard = ruleKeyboardEditorValue(config);
  return [
    keyboard.ctrl === true && 'Ctrl',
    keyboard.alt === true && 'Alt',
    keyboard.shift === true && 'Shift',
    keyboard.meta === true && 'Meta',
    friendlyRuleKeyboardKey(keyboard.key),
  ]
    .filter(Boolean)
    .join(' + ');
}

/** Recording is local to the focused Record button; the caller owns event suppression. */
export function recordedRuleKeyboard(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing' | 'repeat' | 'keyCode'
  >,
): VisualRuleKeyboardTrigger | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'Dead', 'Process', 'Unidentified'].includes(
      event.key,
    )
  )
    return null;
  const key = normalizeVisualRuleKeyboardKey(event.key);
  if (!key) return null;
  return {
    key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}
