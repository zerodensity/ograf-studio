/** Preview navigation takes priority over editor Timeline shortcuts only in its own surface. */
export function installPreviewShortcuts(
  owner: Document,
  panel: HTMLElement,
  viewport: HTMLElement,
  onStep: (delta: -1 | 1) => void,
  isReady: () => boolean,
): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    if (event.key === 'Escape' && owner.fullscreenElement === viewport) {
      event.preventDefault();
      event.stopPropagation();
      void owner.exitFullscreen().catch(() => undefined);
      return;
    }
    const space = event.code === 'Space' || event.key === ' ';
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' || space ? 1 : null;
    if (delta === null) return;
    const target = event.target as HTMLElement | null;
    const fullscreen = owner.fullscreenElement === viewport;
    if (!fullscreen && (!target || !('nodeType' in target) || !panel.contains(target))) return;
    if (
      target?.isContentEditable ||
      target?.closest?.(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"]',
      )
    )
      return;
    // Outside fullscreen, Space on a button retains its normal accessible activation behavior.
    if (!fullscreen && space && target?.closest?.('button, [role="button"]')) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat && isReady()) onStep(delta);
  };
  owner.addEventListener('keydown', keydown, true);
  return () => owner.removeEventListener('keydown', keydown, true);
}

export async function enterPreviewFullscreen(viewport: HTMLElement): Promise<void> {
  if (!viewport.requestFullscreen || viewport.ownerDocument.fullscreenEnabled === false) {
    throw new Error(
      'Fullscreen is unavailable in this browser. Open Studio in a regular browser window and try again.',
    );
  }
  await viewport.requestFullscreen({ navigationUI: 'hide' });
  viewport.focus({ preventScroll: true });
}
