import type { DetachedPanePlacement } from '../state/workspaceModel';
import { detachedWindowWidth, type DockPaneId } from './dockModel';

export type ScreenBounds = NonNullable<DetachedPanePlacement['screen']>;

interface PlacementScreen extends Screen {
  availLeft?: number;
  availTop?: number;
  left?: number;
  top?: number;
  isExtended?: boolean;
}

export interface AvailableScreenDetails extends EventTarget {
  screens: PlacementScreen[];
}

type PlacementWindow = Window & {
  getScreenDetails?: () => Promise<AvailableScreenDetails>;
};

export function screenBounds(screen: Screen): ScreenBounds {
  const extended = screen as PlacementScreen;
  return {
    left: Math.round(extended.availLeft ?? extended.left ?? 0),
    top: Math.round(extended.availTop ?? extended.top ?? 0),
    width: Math.max(1, Math.round(screen.availWidth || screen.width)),
    height: Math.max(1, Math.round(screen.availHeight || screen.height)),
  };
}

/** Query only previously granted access; restoring a workspace never asks for permission. */
export async function permittedScreenDetails(
  owner: Window,
): Promise<AvailableScreenDetails | null> {
  const placementWindow = owner as PlacementWindow;
  if (!placementWindow.getScreenDetails || !owner.navigator.permissions) return null;
  try {
    const permission = await owner.navigator.permissions.query({
      name: 'window-management' as PermissionName,
    });
    if (permission.state !== 'granted') return null;
    return await placementWindow.getScreenDetails();
  } catch {
    return null;
  }
}

function overlap(first: ScreenBounds, second: ScreenBounds): number {
  return (
    Math.max(
      0,
      Math.min(first.left + first.width, second.left + second.width) -
        Math.max(first.left, second.left),
    ) *
    Math.max(
      0,
      Math.min(first.top + first.height, second.top + second.height) -
        Math.max(first.top, second.top),
    )
  );
}

export function constrainDetachedPlacement(
  placement: DetachedPanePlacement,
  owner: Window,
  details: AvailableScreenDetails | null,
): DetachedPanePlacement {
  const currentScreen = screenBounds(owner.screen);
  const screens = details?.screens.map(screenBounds) ?? [];
  // Without monitor permission, a browser may expose only the current display. Retain a
  // known secondary display location while it reports multiple displays; the browser
  // performs its own final placement. A single remaining display can be clamped safely.
  if (screens.length === 0) {
    screens.push(
      (owner.screen as PlacementScreen).isExtended && placement.screen
        ? placement.screen
        : currentScreen,
    );
  }
  const reference = placement.screen ?? placement;
  const target = screens.reduce((best, screen) => {
    const coverage = overlap(reference, screen);
    const bestCoverage = overlap(reference, best);
    if (coverage !== bestCoverage) return coverage > bestCoverage ? screen : best;
    const distance = (item: ScreenBounds) =>
      Math.hypot(reference.left - item.left, reference.top - item.top);
    return distance(screen) < distance(best) ? screen : best;
  }, screens[0] ?? currentScreen);
  const width = Math.min(target.width, Math.max(240, Math.round(placement.width)));
  const height = Math.min(target.height, Math.max(160, Math.round(placement.height)));
  return {
    left: Math.round(
      Math.max(target.left, Math.min(placement.left, target.left + target.width - width)),
    ),
    top: Math.round(
      Math.max(target.top, Math.min(placement.top, target.top + target.height - height)),
    ),
    width,
    height,
    screen: { ...target },
  };
}

export function initialDetachedPlacement(pane: DockPaneId, owner: Window): DetachedPanePlacement {
  return {
    left: owner.screenX + 48,
    top: owner.screenY + 48,
    width: detachedWindowWidth(pane),
    height: 760,
    screen: screenBounds(owner.screen),
  };
}

export function captureDetachedPlacement(owner: Window): DetachedPanePlacement {
  return {
    left: Math.round(owner.screenX),
    top: Math.round(owner.screenY),
    width: Math.max(1, Math.round(owner.outerWidth || owner.innerWidth)),
    height: Math.max(1, Math.round(owner.outerHeight || owner.innerHeight)),
    screen: screenBounds(owner.screen),
  };
}

export function sameDetachedPlacement(
  first: DetachedPanePlacement | undefined,
  second: DetachedPanePlacement,
): boolean {
  return Boolean(
    first &&
    first.left === second.left &&
    first.top === second.top &&
    first.width === second.width &&
    first.height === second.height &&
    first.screen?.left === second.screen?.left &&
    first.screen?.top === second.screen?.top &&
    first.screen?.width === second.screen?.width &&
    first.screen?.height === second.screen?.height,
  );
}
