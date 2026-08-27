import { describe, expect, it } from 'vitest';
import { isInteractiveShortcutTarget } from './keyboardShortcuts';

describe('playback shortcut focus protection', () => {
  it('protects text and form controls while allowing the canvas', () => {
    expect(isInteractiveShortcutTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isInteractiveShortcutTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(
      true,
    );
    expect(isInteractiveShortcutTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(
      true,
    );
    expect(isInteractiveShortcutTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
  });
});
