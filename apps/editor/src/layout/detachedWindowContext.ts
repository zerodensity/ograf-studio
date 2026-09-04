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
}
export const DetachedWindowContext = createContext<WindowRegistry | null>(null);
export const useDetachedWindows = () => useContext(DetachedWindowContext)!;
