export type FileMenuShortcut = 'save' | 'open' | 'export';

const SHORTCUT_BY_CODE: Record<string, FileMenuShortcut> = {
  KeyS: 'save',
  KeyO: 'open',
  KeyE: 'export',
};

/** Ctrl/Command + S, O or E with no other modifier. New stays menu-only: browsers own Ctrl+N. */
export function fileMenuShortcut(event: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): FileMenuShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return null;
  return SHORTCUT_BY_CODE[event.code] ?? null;
}
