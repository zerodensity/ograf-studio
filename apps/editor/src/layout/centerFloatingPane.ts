import {
  DEFAULT_PLUGINS_UNDOCKED_WIDTH,
  DEFAULT_RULES_UNDOCKED_WIDTH,
  DEFAULT_TRANSITION_LOGIC_FLOATING_WIDTH,
  floatDockPane,
  type DockLayoutState,
  type DockPaneId,
} from './dockModel';

/** Bring a pane into the Studio workspace as a centered floating window. */
export function centerFloatingPane(
  layout: DockLayoutState,
  pane: DockPaneId,
  bounds: { width: number; height: number },
): DockLayoutState {
  const previous = layout.floating.find((item) => item.pane === pane);
  const preferred =
    pane === 'timeline'
      ? { width: 720, height: 340 }
      : pane === 'plugins'
        ? { width: DEFAULT_PLUGINS_UNDOCKED_WIDTH, height: 520 }
        : pane === 'transitions'
          ? { width: DEFAULT_TRANSITION_LOGIC_FLOATING_WIDTH, height: 520 }
          : pane === 'rules' || pane === 'functions'
            ? { width: DEFAULT_RULES_UNDOCKED_WIDTH, height: 460 }
            : pane === 'chat' || pane === 'export'
              ? { width: 460, height: 520 }
              : { width: 380, height: 460 };
  const availableWidth = Math.max(1, bounds.width - 12);
  const availableHeight = Math.max(1, bounds.height - 12);
  const width = Math.min(previous?.width ?? preferred.width, availableWidth);
  const height = Math.min(previous?.height ?? preferred.height, availableHeight);
  return floatDockPane(layout, pane, {
    x: Math.max(0, Math.round((bounds.width - width) / 2)),
    y: Math.max(0, Math.round((bounds.height - height) / 2)),
    width,
    height,
  });
}
