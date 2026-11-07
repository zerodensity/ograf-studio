/** Fullscreen in a different window does not obscure this canvas. Synced preview uses its pixels. */
export function shouldRenderEditorCanvas(
  root: HTMLElement | null,
  synchronizedPreview: boolean,
): boolean {
  if (synchronizedPreview) return true;
  if (!root?.isConnected) return false;
  const owner = root.ownerDocument;
  return !owner.hidden && (!owner.fullscreenElement || owner.fullscreenElement.contains(root));
}
