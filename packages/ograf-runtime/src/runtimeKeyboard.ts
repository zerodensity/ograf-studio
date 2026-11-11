import {
  isVisualRuleKeyboardTrigger,
  visualRuleKeyboardMatches,
  visualRuleTrigger,
  type VisualRuleKeyboardInput,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';

export type RuntimeKeyboardTrigger = 'key-down' | 'key-up';
export function hasRuntimeKeyboardRules(layers: readonly CompiledLayer[]): boolean {
  return layers.some((layer) =>
    layer.visualRules?.some(
      (rule) =>
        rule.enabled &&
        isVisualRuleKeyboardTrigger(visualRuleTrigger(rule)) &&
        !!rule.keyboard?.key,
    ),
  );
}
/** Reserve both edges of an authored chord, independently of conditions and repeat suppression. */
export function claimsRuntimeKeyboardInput(
  layers: readonly CompiledLayer[],
  trigger: RuntimeKeyboardTrigger,
  input: VisualRuleKeyboardInput,
): boolean {
  if (!isVisualRuleKeyboardTrigger(trigger) || input.isComposing) return false;
  return layers.some((layer) =>
    layer.visualRules?.some(
      (rule) =>
        rule.enabled &&
        isVisualRuleKeyboardTrigger(visualRuleTrigger(rule)) &&
        !!rule.keyboard &&
        visualRuleKeyboardMatches(rule.keyboard, { ...input, repeat: false }),
    ),
  );
}

function interactive(event: Event): boolean {
  const path = event.composedPath?.() ?? [event.target];
  return path.some((item) => {
    if (!item || typeof item !== 'object' || !('nodeType' in item) || item.nodeType !== 1)
      return false;
    const element = item as HTMLElement;
    return (
      element.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY', 'DIALOG'].includes(
        element.tagName,
      ) ||
      element.getAttribute('data-rule-key-recording') === 'true' ||
      [
        'textbox',
        'combobox',
        'spinbutton',
        'slider',
        'listbox',
        'button',
        'menuitem',
        'dialog',
      ].includes(element.getAttribute('role') ?? '')
    );
  });
}
/** Host-local listeners survive document adoption and never intercept another graphic's keys. */
export function bindRuntimeKeyboard(
  host: HTMLElement,
  enabled: boolean,
  receive: (
    trigger: RuntimeKeyboardTrigger,
    input: VisualRuleKeyboardInput,
    event: KeyboardEvent,
  ) => boolean,
): () => void {
  if (!enabled) return () => {};
  const addedTabIndex = !host.hasAttribute('tabindex');
  if (addedTabIndex) host.tabIndex = 0;
  let composing = false,
    disposed = false;
  const key = (event: Event) => {
    const input = event as KeyboardEvent;
    if (
      disposed ||
      event.defaultPrevented ||
      composing ||
      input.isComposing ||
      input.keyCode === 229 ||
      interactive(event)
    )
      return;
    if (
      receive(
        event.type === 'keydown' ? 'key-down' : 'key-up',
        {
          key: input.key,
          ctrlKey: input.ctrlKey,
          altKey: input.altKey,
          shiftKey: input.shiftKey,
          metaKey: input.metaKey,
          repeat: input.repeat,
          isComposing: input.isComposing,
        },
        input,
      )
    )
      event.preventDefault();
  };
  const focus = (event: Event) => {
    if (
      disposed ||
      composing ||
      event.defaultPrevented ||
      interactive(event) ||
      (event as PointerEvent).button !== 0
    )
      return;
    host.focus({ preventScroll: true });
  };
  const start = () => {
    composing = true;
  };
  const end = () => {
    composing = false;
  };
  host.addEventListener('keydown', key);
  host.addEventListener('keyup', key);
  host.addEventListener('pointerdown', focus);
  host.addEventListener('compositionstart', start);
  host.addEventListener('compositionend', end);
  host.addEventListener('focusout', end);
  return () => {
    if (disposed) return;
    disposed = true;
    host.removeEventListener('keydown', key);
    host.removeEventListener('keyup', key);
    host.removeEventListener('pointerdown', focus);
    host.removeEventListener('compositionstart', start);
    host.removeEventListener('compositionend', end);
    host.removeEventListener('focusout', end);
    if (addedTabIndex && host.getAttribute('tabindex') === '0') host.removeAttribute('tabindex');
  };
}
