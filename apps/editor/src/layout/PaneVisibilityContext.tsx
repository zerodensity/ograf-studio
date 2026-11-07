import { createContext, useContext, type ReactNode } from 'react';

const PaneVisibilityContext = createContext(true);

/** Inactive dock tabs remain mounted for their form state, but can release expensive previews. */
export function DockPaneVisibilityProvider({
  visible,
  children,
}: {
  visible: boolean;
  children?: ReactNode;
}) {
  return (
    <PaneVisibilityContext.Provider value={visible}>{children}</PaneVisibilityContext.Provider>
  );
}

// The provider and consumer intentionally share this one pane-visibility context.
// oxlint-disable-next-line react/only-export-components
export function useDockPaneVisible(): boolean {
  return useContext(PaneVisibilityContext);
}
