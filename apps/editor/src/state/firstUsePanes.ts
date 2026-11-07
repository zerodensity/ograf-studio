import type { DockPaneId } from '../layout/dockModel';
import { usePaneRequestStore } from './paneRequestStore';

const seenInSession = new Set<DockPaneId>();
const key = (pane: DockPaneId) => `ograf-studio:first-use-pane:${pane}`;

/** Reveal only on the first authoring use, without changing saved layouts at startup. */
export function revealPaneOnFirstUse(pane: DockPaneId): boolean {
  if (seenInSession.has(pane)) return false;
  try {
    if (localStorage.getItem(key(pane))) {
      seenInSession.add(pane);
      return false;
    }
  } catch {
    /* session fallback */
  }
  seenInSession.add(pane);
  try {
    localStorage.setItem(key(pane), '1');
  } catch {
    /* session fallback */
  }
  usePaneRequestStore.getState().reveal(pane);
  window.dispatchEvent(new CustomEvent('ograf-first-use-pane', { detail: pane }));
  return true;
}
