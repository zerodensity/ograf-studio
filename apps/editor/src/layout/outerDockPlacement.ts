import type { DockZone } from './dockModel';

interface DockGridPlacement {
  gridColumn: string;
  gridRow: string;
}

/** The last outer-edge choice decides which region owns the lower corners. */
export function outerDockPlacement(zone: DockZone, bottomPriority: boolean): DockGridPlacement {
  if (zone === 'left' || zone === 'right') {
    return {
      gridColumn: zone === 'left' ? '1' : '5',
      gridRow: bottomPriority ? '1 / 4' : '1 / -1',
    };
  }
  return {
    gridColumn: zone === 'bottom' && bottomPriority ? '1 / -1' : '3',
    gridRow: zone === 'bottom' ? '5' : '1',
  };
}

/** Match the resize-divider extent to the edge it resizes. */
export function outerDockDividerPlacement(
  zone: DockZone,
  bottomPriority: boolean,
): DockGridPlacement {
  if (zone === 'left' || zone === 'right') {
    return {
      gridColumn: zone === 'left' ? '2' : '4',
      gridRow: bottomPriority ? '1 / 4' : '1 / -1',
    };
  }
  return {
    gridColumn: zone === 'bottom' && bottomPriority ? '1 / -1' : '3',
    gridRow: zone === 'bottom' ? '4' : '2',
  };
}

/** Preview the actual horizontal extent used by the corresponding outer region. */
export function outerHorizontalPreviewSpan(
  zone: 'top' | 'bottom',
  workspaceWidth: number,
  innerOffset: number,
  innerWidth: number,
): { left: number; width: number } {
  return zone === 'bottom'
    ? { left: 0, width: workspaceWidth }
    : { left: innerOffset, width: innerWidth };
}
