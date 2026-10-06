import { describe, expect, it } from 'vitest';
import { fileMenuShortcut } from './fileMenuShortcuts';

const key = (
  code: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('file menu shortcuts', () => {
  it('maps Ctrl/Command + S, O and E to save, open and export', () => {
    expect(fileMenuShortcut(key('KeyS', { metaKey: true }))).toBe('save');
    expect(fileMenuShortcut(key('KeyS', { ctrlKey: true }))).toBe('save');
    expect(fileMenuShortcut(key('KeyO', { metaKey: true }))).toBe('open');
    expect(fileMenuShortcut(key('KeyE', { ctrlKey: true }))).toBe('export');
  });

  it('ignores plain keys and other modifier combinations', () => {
    expect(fileMenuShortcut(key('KeyS'))).toBeNull();
    expect(fileMenuShortcut(key('KeyS', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(fileMenuShortcut(key('KeyO', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(fileMenuShortcut(key('KeyN', { metaKey: true }))).toBeNull();
  });
});
