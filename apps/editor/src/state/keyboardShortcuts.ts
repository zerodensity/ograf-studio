/** Form and editable controls keep their native Space/Ctrl+key behavior. */
export function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  const candidate = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  } | null;
  const tagName = candidate?.tagName?.toUpperCase();
  if (tagName && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tagName)) return true;
  return Boolean(
    candidate?.isContentEditable || candidate?.getAttribute?.('role')?.toLowerCase() === 'textbox',
  );
}
