/**
 * Escape during a pane drag turns docking off for the rest of that drag, so a pane can be parked
 * near the workspace edges without snapping into a dock. The next drag starts with docking on.
 */
export interface DockingSuppression {
  /** Start listening for Escape at the beginning of a drag, with docking enabled. */
  arm(): void;
  /** Stop listening at the end of a drag and enable docking again. */
  disarm(): void;
  readonly suppressed: boolean;
}

export function createDockingSuppression(
  owner: EventTarget,
  onChange: (suppressed: boolean) => void,
): DockingSuppression {
  let armed = false;
  let suppressed = false;
  const setSuppressed = (next: boolean) => {
    if (suppressed === next) return;
    suppressed = next;
    onChange(next);
  };
  // Window capture runs before document and element listeners, so editor shortcuts, menus,
  // and dialogs never see the Escape that belongs to the drag.
  const capture = { capture: true };
  const handleKeyDown = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setSuppressed(true);
  };
  return {
    arm() {
      if (!armed) owner.addEventListener('keydown', handleKeyDown, capture);
      armed = true;
      setSuppressed(false);
    },
    disarm() {
      if (armed) owner.removeEventListener('keydown', handleKeyDown, capture);
      armed = false;
      setSuppressed(false);
    },
    get suppressed() {
      return suppressed;
    },
  };
}
