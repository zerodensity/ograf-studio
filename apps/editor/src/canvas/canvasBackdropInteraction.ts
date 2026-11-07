/** A modal camera settings dialog is portaled outside the toolbar but belongs to its popup. */
export function isCanvasBackdropInteraction(
  container: Pick<Node, 'contains'> | null,
  target: EventTarget | null,
): boolean {
  if (!target || typeof (target as Node).nodeType !== 'number') return false;
  const node = target as Node;
  if (container?.contains(node)) return true;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return Boolean(element?.closest('dialog.webcam-camera-settings[open]'));
}

/** Let the modal handle Escape before closing its parent popup. */
export function cameraSettingsDialogOpen(document: Pick<Document, 'querySelector'>): boolean {
  return Boolean(document.querySelector('dialog.webcam-camera-settings[open]'));
}
