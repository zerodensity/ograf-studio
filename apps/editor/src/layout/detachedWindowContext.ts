import { createContext, useContext } from 'react';
import type { DockPaneId } from './dockModel';
import type { EditorWindow } from './EditorWindow';

export interface DetachedWindow {
  window: EditorWindow;
  container: HTMLElement;
}
export interface WindowRegistry {
  windows: Partial<Record<DockPaneId, DetachedWindow>>;
  open: (pane: DockPaneId) => void;
  dock: (pane: DockPaneId) => void;
  /** Synchronous so a menu click can supply the browser's popup activation. */
  restore: () => void;
  /** Save current native-window bounds before saving a workspace preset. */
  capture: () => void;
  pending: DockPaneId[];
}
export const DetachedWindowContext = createContext<WindowRegistry | null>(null);
export const useDetachedWindows = () => useContext(DetachedWindowContext)!;
