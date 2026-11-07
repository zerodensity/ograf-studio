/** Keep right-click available to Studio handlers while suppressing the browser's own menu. */
export function suppressBrowserContextMenu(ownerDocument: Document): () => void {
  const preventDefault = (event: Event) => event.preventDefault();
  ownerDocument.addEventListener('contextmenu', preventDefault, true);
  return () => ownerDocument.removeEventListener('contextmenu', preventDefault, true);
}
