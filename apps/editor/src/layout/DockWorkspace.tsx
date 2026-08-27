import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { LayerListPanel } from '../panels/LayerListPanel';
import { AgentChatPanel } from '../panels/AgentChatPanel';
import { ResourcesPanel } from '../panels/ResourcesPanel';
import { InspectorPanel } from '../panels/InspectorPanel';
import { DataPanel } from '../panels/DataPanel';
import { PreviewExportPanel } from '../panels/PreviewExportPanel';
import { TimelinePanel } from '../panels/TimelinePanel';
import { ResizeHandle } from './ResizeHandle';
import { useResizable } from './useResizable';
import {
  activateDockPane,
  closeDockPane,
  createDefaultDockLayout,
  DOCK_PANE_LABELS,
  dockPaneAdjacentToTab,
  dockPaneToGroup,
  dockPaneToZone,
  dockZoneNearFloatingRect,
  dockZoneNearPointer,
  floatDockPane,
  moveFloatingDockPane,
  parseDockLayout,
  reopenDockPane,
  resizeDockGroups,
  type DockGroupState,
  type DockLayoutState,
  type DockPaneId,
  type DockTabInsertSide,
  type DockZone,
  type FloatingPaneState,
} from './dockModel';
import './DockWorkspace.css';

const STORAGE_KEY = 'ograf-studio:dock-layout:v1';
const PANE_MIME = 'application/x-ograf-studio-pane';

function loadDockLayout(): DockLayoutState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return parseDockLayout(JSON.parse(stored));
  } catch {
    // A usable default is more important than optional local layout persistence.
  }
  const layout = createDefaultDockLayout();
  if (localStorage.getItem('ograf-studio:left-tab') === 'chat') {
    layout.zones.left[0]!.activePane = 'chat';
  }
  return layout;
}

function persistDockLayout(layout: DockLayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage availability/quota failures; docking remains fully usable for the session.
  }
}

function PaneContent({ pane }: { pane: DockPaneId }) {
  switch (pane) {
    case 'layers':
      return <LayerListPanel />;
    case 'chat':
      return <AgentChatPanel />;
    case 'resources':
      return <ResourcesPanel />;
    case 'inspector':
      return <InspectorPanel />;
    case 'data':
      return <DataPanel />;
    case 'export':
      return <PreviewExportPanel />;
    case 'timeline':
      return <TimelinePanel />;
  }
}

function paneFromDrag(event: DragEvent, fallback: DockPaneId | null): DockPaneId | null {
  const pane = event.dataTransfer.getData(PANE_MIME);
  return pane ? (pane as DockPaneId) : fallback;
}

interface DockGroupProps {
  group: DockGroupState;
  draggingPane: DockPaneId | null;
  onActivate: (groupId: string, pane: DockPaneId) => void;
  onDockIntoGroup: (pane: DockPaneId, groupId: string) => void;
  onDockAtTab: (
    pane: DockPaneId,
    groupId: string,
    targetPane: DockPaneId,
    side: DockTabInsertSide,
  ) => void;
  onFloat: (pane: DockPaneId) => void;
  onClearDropPreview: () => void;
  onPointerDockStart: (pane: DockPaneId) => void;
  onPointerDockMove: (clientX: number, clientY: number) => void;
  onPointerDockEnd: (pane: DockPaneId, clientX: number, clientY: number) => void;
  onPointerDockCancel: () => void;
  onClose: (pane: DockPaneId) => void;
}

function DockGroup({
  group,
  draggingPane,
  onActivate,
  onDockIntoGroup,
  onDockAtTab,
  onFloat,
  onClearDropPreview,
  onPointerDockStart,
  onPointerDockMove,
  onPointerDockEnd,
  onPointerDockCancel,
  onClose,
}: DockGroupProps) {
  const suppressClickRef = useRef(false);

  const beginPointerReorder = (
    event: ReactPointerEvent<HTMLButtonElement>,
    sourcePane: DockPaneId,
  ) => {
    if (event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY };
    let lastPointer = { ...start };
    let moved = false;
    let overSource = false;
    let target: {
      groupId: string;
      pane: DockPaneId;
      side: DockTabInsertSide;
    } | null = null;

    const clearIndicators = () => {
      document
        .querySelectorAll('.dock-tab-drop-before, .dock-tab-drop-after')
        .forEach((element) =>
          element.classList.remove('dock-tab-drop-before', 'dock-tab-drop-after'),
        );
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      document.body.classList.remove('is-reordering-dock-tab');
      clearIndicators();
      if (moved) suppressClickRef.current = true;
      if (commit && moved && target) {
        onDockAtTab(sourcePane, target.groupId, target.pane, target.side);
      } else if (commit && moved && !overSource) {
        onPointerDockEnd(sourcePane, lastPointer.x, lastPointer.y);
      } else if (moved) {
        onPointerDockCancel();
      }
    };
    const handleMove = (moveEvent: PointerEvent) => {
      if (!moved && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 4) {
        return;
      }
      if (!moved) {
        moved = true;
        onPointerDockStart(sourcePane);
      }
      lastPointer = { x: moveEvent.clientX, y: moveEvent.clientY };
      moveEvent.preventDefault();
      document.body.classList.add('is-reordering-dock-tab');
      clearIndicators();
      const hovered = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest('.dock-tabs button[role="tab"]') as HTMLButtonElement | null;
      const targetPane = hovered?.dataset.dockPane as DockPaneId | undefined;
      const targetGroupId = hovered?.dataset.dockGroup;
      overSource = targetPane === sourcePane;
      if (!hovered || !targetPane || !targetGroupId || overSource) {
        target = null;
        if (overSource) onClearDropPreview();
        else onPointerDockMove(moveEvent.clientX, moveEvent.clientY);
        return;
      }
      onClearDropPreview();
      const bounds = hovered.getBoundingClientRect();
      const side = moveEvent.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
      hovered.classList.add(side === 'before' ? 'dock-tab-drop-before' : 'dock-tab-drop-after');
      target = { groupId: targetGroupId, pane: targetPane, side };
    };
    const handleUp = (upEvent: PointerEvent) => {
      lastPointer = { x: upEvent.clientX, y: upEvent.clientY };
      finish(true);
    };
    const handleCancel = () => finish(false);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
  };

  return (
    <section className="dock-group" style={{ flexGrow: group.weight }}>
      <div
        className="dock-tabs"
        role="tablist"
        aria-label={`${DOCK_PANE_LABELS[group.activePane]} pane group`}
        onDragEnter={(event) => {
          if (!draggingPane) return;
          event.preventDefault();
          onClearDropPreview();
          event.currentTarget.classList.add('dock-drop-into-tabs');
        }}
        onDragOver={(event) => {
          if (!draggingPane) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDragLeave={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return;
          event.currentTarget.classList.remove('dock-drop-into-tabs');
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.classList.remove('dock-drop-into-tabs');
          const pane = paneFromDrag(event, draggingPane);
          if (pane) onDockIntoGroup(pane, group.id);
        }}
      >
        {group.panes.map((pane) => (
          <button
            key={pane}
            type="button"
            role="tab"
            data-dock-pane={pane}
            data-dock-group={group.id}
            className={pane === group.activePane ? 'active' : ''}
            aria-selected={pane === group.activePane}
            title="Drag to reorder, dock, or float · Double-click to float"
            onPointerDown={(event) => beginPointerReorder(event, pane)}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onActivate(group.id, pane);
            }}
            onDoubleClick={() => onFloat(pane)}
            onDragEnter={(event) => {
              if (!draggingPane || draggingPane === pane) return;
              event.preventDefault();
              event.stopPropagation();
              onClearDropPreview();
            }}
            onDragOver={(event) => {
              if (!draggingPane || draggingPane === pane) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              const bounds = event.currentTarget.getBoundingClientRect();
              const side = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
              event.currentTarget.classList.toggle('dock-tab-drop-before', side === 'before');
              event.currentTarget.classList.toggle('dock-tab-drop-after', side === 'after');
            }}
            onDragLeave={(event) => {
              event.currentTarget.classList.remove('dock-tab-drop-before', 'dock-tab-drop-after');
            }}
            onDrop={(event) => {
              if (!draggingPane || draggingPane === pane) return;
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              const side = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
              event.currentTarget.classList.remove('dock-tab-drop-before', 'dock-tab-drop-after');
              const droppedPane = paneFromDrag(event, draggingPane);
              if (droppedPane) onDockAtTab(droppedPane, group.id, pane, side);
            }}
          >
            <span className="dock-tab-grip" aria-hidden="true">
              ⠇
            </span>
            {DOCK_PANE_LABELS[pane]}
          </button>
        ))}
        <button
          type="button"
          className="dock-pane-close"
          aria-label={`Close ${DOCK_PANE_LABELS[group.activePane]}`}
          title={`Close ${DOCK_PANE_LABELS[group.activePane]}`}
          onClick={() => onClose(group.activePane)}
        >
          ×
        </button>
      </div>
      <div className="dock-group-content">
        {group.panes.map((pane) => (
          <div
            key={pane}
            className={`dock-pane-content${pane === group.activePane ? ' active' : ''}`}
            role="tabpanel"
            aria-label={DOCK_PANE_LABELS[pane]}
            hidden={pane !== group.activePane}
          >
            <PaneContent pane={pane} />
          </div>
        ))}
      </div>
    </section>
  );
}

interface DockRegionProps extends Omit<DockGroupProps, 'group'> {
  zone: DockZone;
  groups: DockGroupState[];
  onResizeGroups: (zone: DockZone, weights: Record<string, number>) => void;
}

function DockRegion({ zone, groups, onResizeGroups, ...groupProps }: DockRegionProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const vertical = zone === 'left' || zone === 'right' || zone === 'bottom';

  const beginGroupResize = (event: ReactPointerEvent<HTMLDivElement>, dividerIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const region = regionRef.current;
    if (!region) return;
    const groupElements = [...region.children].filter((child) =>
      child.classList.contains('dock-group'),
    ) as HTMLElement[];
    const startSizes = groupElements.map((element) =>
      vertical ? element.getBoundingClientRect().height : element.getBoundingClientRect().width,
    );
    const startPosition = vertical ? event.clientY : event.clientX;
    const minimumSize = vertical ? 80 : 120;

    const handleMove = (moveEvent: PointerEvent) => {
      const position = vertical ? moveEvent.clientY : moveEvent.clientX;
      const requestedDelta = position - startPosition;
      const beforeSize = startSizes[dividerIndex]!;
      const afterSize = startSizes[dividerIndex + 1]!;
      const delta = Math.min(
        afterSize - minimumSize,
        Math.max(minimumSize - beforeSize, requestedDelta),
      );
      const nextSizes = [...startSizes];
      nextSizes[dividerIndex] = beforeSize + delta;
      nextSizes[dividerIndex + 1] = afterSize - delta;
      onResizeGroups(
        zone,
        Object.fromEntries(groups.map((group, index) => [group.id, nextSizes[index]!])),
      );
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      document.body.classList.remove('is-resizing');
    };

    document.body.classList.add('is-resizing');
    document.body.dataset.resizeAxis = vertical ? 'row' : 'col';
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  return (
    <div
      ref={regionRef}
      className={`dock-region dock-region-${zone}${vertical ? ' vertical' : ' horizontal'}`}
      aria-label={`${zone} dock region`}
    >
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          <DockGroup group={group} {...groupProps} />
          {index < groups.length - 1 ? (
            <div
              className={`dock-group-resize-handle ${vertical ? 'row' : 'col'}`}
              role="separator"
              aria-orientation={vertical ? 'horizontal' : 'vertical'}
              aria-label={`Resize ${DOCK_PANE_LABELS[group.activePane]} and ${DOCK_PANE_LABELS[groups[index + 1]!.activePane]}`}
              onPointerDown={(event) => beginGroupResize(event, index)}
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

interface FloatingDockPaneProps {
  floating: FloatingPaneState;
  workspace: HTMLDivElement | null;
  onMoveStart: (pane: DockPaneId) => void;
  onMove: (
    pane: DockPaneId,
    x: number,
    y: number,
    width: number,
    height: number,
    clientX: number,
    clientY: number,
  ) => void;
  onMoveEnd: (
    pane: DockPaneId,
    x: number,
    y: number,
    width: number,
    height: number,
    clientX: number,
    clientY: number,
  ) => void;
  onDragStart: (event: DragEvent, pane: DockPaneId) => void;
  onDragEnd: () => void;
  onDock: (pane: DockPaneId, zone: DockZone) => void;
  onClose: (pane: DockPaneId) => void;
}

function FloatingDockPane({
  floating,
  workspace,
  onMoveStart,
  onMove,
  onMoveEnd,
  onDragStart,
  onDragEnd,
  onDock,
  onClose,
}: FloatingDockPaneProps) {
  const beginMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    onMoveStart(floating.pane);
    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: floating.x,
      y: floating.y,
    };
    let lastPosition = { x: floating.x, y: floating.y };
    const handleMove = (moveEvent: PointerEvent) => {
      const bounds = workspace?.getBoundingClientRect();
      const maxX = Math.max(0, (bounds?.width ?? window.innerWidth) - floating.width);
      const maxY = Math.max(0, (bounds?.height ?? window.innerHeight) - floating.height);
      lastPosition = {
        x: Math.min(maxX, Math.max(0, start.x + moveEvent.clientX - start.pointerX)),
        y: Math.min(maxY, Math.max(0, start.y + moveEvent.clientY - start.pointerY)),
      };
      onMove(
        floating.pane,
        lastPosition.x,
        lastPosition.y,
        floating.width,
        floating.height,
        moveEvent.clientX,
        moveEvent.clientY,
      );
    };
    const handleUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      document.body.classList.remove('is-moving-dock-pane');
      onMoveEnd(
        floating.pane,
        lastPosition.x,
        lastPosition.y,
        floating.width,
        floating.height,
        upEvent.clientX,
        upEvent.clientY,
      );
    };
    document.body.classList.add('is-moving-dock-pane');
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  return (
    <section
      className="dock-floating-pane"
      style={{
        left: floating.x,
        top: floating.y,
        width: floating.width,
        height: floating.height,
      }}
    >
      <div className="dock-floating-title" onPointerDown={beginMove}>
        <strong>{DOCK_PANE_LABELS[floating.pane]}</strong>
        <div>
          <button
            type="button"
            draggable
            aria-label={`Drag ${DOCK_PANE_LABELS[floating.pane]} to dock`}
            title="Drag to a docking hint"
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => onDragStart(event, floating.pane)}
            onDragEnd={onDragEnd}
          >
            ⠇
          </button>
          <select
            aria-label={`Dock ${DOCK_PANE_LABELS[floating.pane]}`}
            title="Choose dock location"
            value=""
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (event.target.value) onDock(floating.pane, event.target.value as DockZone);
            }}
          >
            <option value="" disabled>
              Dock…
            </option>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
          <button
            type="button"
            aria-label={`Close ${DOCK_PANE_LABELS[floating.pane]}`}
            title={`Close ${DOCK_PANE_LABELS[floating.pane]}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onClose(floating.pane)}
          >
            ×
          </button>
        </div>
      </div>
      <div className="dock-floating-content dock-pane-content active">
        <PaneContent pane={floating.pane} />
      </div>
    </section>
  );
}

type DockDropTarget = DockZone | 'float';

function DockTargetIcon({ target }: { target: DockDropTarget }) {
  return (
    <span className={`dock-target-icon ${target}`} aria-hidden="true">
      <i />
    </span>
  );
}

export interface DockPaneCommand {
  id: number;
  action: 'open' | 'close';
  pane: DockPaneId;
}

export function DockWorkspace({
  center,
  paneCommand,
  onClosedPanesChange,
}: {
  center: ReactNode;
  paneCommand?: DockPaneCommand | null;
  onClosedPanesChange?: (panes: DockPaneId[]) => void;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(loadDockLayout);
  const [draggingPane, setDraggingPane] = useState<DockPaneId | null>(null);
  const [dropTarget, setDropTarget] = useState<DockDropTarget | null>(null);
  const [movingFloatingPane, setMovingFloatingPane] = useState<DockPaneId | null>(null);
  const [edgeDropTarget, setEdgeDropTarget] = useState<DockZone | null>(null);

  const left = useResizable({
    key: 'left-sidebar',
    axis: 'col',
    defaultSize: 380,
    min: 220,
    max: 520,
  });
  const right = useResizable({
    key: 'right-tabs',
    axis: 'col',
    defaultSize: 300,
    min: 220,
    max: 520,
    invert: true,
  });
  const top = useResizable({
    key: 'top-dock',
    axis: 'row',
    defaultSize: 220,
    min: 120,
    max: 420,
  });
  const bottom = useResizable({
    key: 'timeline',
    axis: 'row',
    defaultSize: 220,
    min: 120,
    max: 480,
    invert: true,
  });

  useEffect(() => persistDockLayout(layout), [layout]);
  useEffect(() => onClosedPanesChange?.(layout.closed), [layout.closed, onClosedPanesChange]);
  useEffect(() => {
    if (!paneCommand) return;
    setLayout((current) =>
      paneCommand.action === 'open'
        ? reopenDockPane(current, paneCommand.pane)
        : closeDockPane(current, paneCommand.pane),
    );
  }, [paneCommand]);

  const hasLeft = layout.zones.left.length > 0;
  const hasRight = layout.zones.right.length > 0;
  const hasTop = layout.zones.top.length > 0;
  const hasBottom = layout.zones.bottom.length > 0;

  const beginDockDrag = (event: DragEvent, pane: DockPaneId) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(PANE_MIME, pane);
    event.dataTransfer.setData('text/plain', pane);
    setDraggingPane(pane);
  };

  const finishDockDrag = () => {
    workspaceRef.current
      ?.querySelectorAll('.dock-tab-drop-before, .dock-tab-drop-after')
      .forEach((element) =>
        element.classList.remove('dock-tab-drop-before', 'dock-tab-drop-after'),
      );
    setDraggingPane(null);
    setDropTarget(null);
  };

  const pointerDockTargetAt = (clientX: number, clientY: number): DockDropTarget | null => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const guides: Array<{ target: DockDropTarget; x: number; y: number }> = [
      { target: 'top', x: centerX, y: centerY - 49 },
      { target: 'left', x: centerX - 49, y: centerY },
      { target: 'float', x: centerX, y: centerY },
      { target: 'right', x: centerX + 49, y: centerY },
      { target: 'bottom', x: centerX, y: centerY + 49 },
    ];
    const guide = guides.find(
      (candidate) => Math.abs(clientX - candidate.x) <= 24 && Math.abs(clientY - candidate.y) <= 24,
    );
    return guide?.target ?? dockZoneNearPointer(clientX, clientY, bounds);
  };

  const beginPointerDock = (pane: DockPaneId) => {
    setDraggingPane(pane);
    setDropTarget(null);
  };

  const updatePointerDock = (clientX: number, clientY: number) => {
    setDropTarget(pointerDockTargetAt(clientX, clientY));
  };

  const finishPointerDock = (pane: DockPaneId, clientX: number, clientY: number) => {
    const target = pointerDockTargetAt(clientX, clientY);
    if (target && target !== 'float') {
      setLayout((current) => dockPaneToZone(current, pane, target));
    } else {
      const bounds = workspaceRef.current?.getBoundingClientRect();
      setLayout((current) =>
        floatDockPane(current, pane, {
          x: Math.max(0, clientX - (bounds?.left ?? 0) - 180),
          y: Math.max(0, clientY - (bounds?.top ?? 0) - 28),
        }),
      );
    }
    finishDockDrag();
  };

  const edgeZoneForFloating = (
    x: number,
    y: number,
    width: number,
    height: number,
    clientX: number,
    clientY: number,
  ): DockZone | null => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return (
      dockZoneNearFloatingRect(
        {
          left: bounds.left + x,
          top: bounds.top + y,
          right: bounds.left + x + width,
          bottom: bounds.top + y + height,
        },
        bounds,
      ) ?? dockZoneNearPointer(clientX, clientY, bounds)
    );
  };

  const beginFloatingMove = (pane: DockPaneId) => {
    setMovingFloatingPane(pane);
    setEdgeDropTarget(null);
  };

  const updateFloatingMove = (
    pane: DockPaneId,
    x: number,
    y: number,
    width: number,
    height: number,
    clientX: number,
    clientY: number,
  ) => {
    setLayout((current) => moveFloatingDockPane(current, pane, x, y));
    setEdgeDropTarget(edgeZoneForFloating(x, y, width, height, clientX, clientY));
  };

  const finishFloatingMove = (
    pane: DockPaneId,
    x: number,
    y: number,
    width: number,
    height: number,
    clientX: number,
    clientY: number,
  ) => {
    const zone = edgeZoneForFloating(x, y, width, height, clientX, clientY);
    if (zone) setLayout((current) => dockPaneToZone(current, pane, zone));
    setMovingFloatingPane(null);
    setEdgeDropTarget(null);
  };

  const floatAtCenter = (pane: DockPaneId) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    const width = Math.min(380, Math.max(280, (bounds?.width ?? 760) - 80));
    const height = Math.min(460, Math.max(220, (bounds?.height ?? 640) - 80));
    setLayout((current) =>
      floatDockPane(current, pane, {
        x: Math.max(24, ((bounds?.width ?? 760) - width) / 2),
        y: Math.max(24, ((bounds?.height ?? 640) - height) / 2),
        width,
        height,
      }),
    );
    finishDockDrag();
  };

  const dockToTarget = (event: DragEvent, target: DockDropTarget) => {
    event.preventDefault();
    const pane = paneFromDrag(event, draggingPane);
    if (!pane) return;
    if (target === 'float') {
      const bounds = workspaceRef.current?.getBoundingClientRect();
      setLayout((current) =>
        floatDockPane(current, pane, {
          x: Math.max(0, event.clientX - (bounds?.left ?? 0) - 180),
          y: Math.max(0, event.clientY - (bounds?.top ?? 0) - 28),
        }),
      );
    } else {
      setLayout((current) => dockPaneToZone(current, pane, target));
    }
    finishDockDrag();
  };

  const groupProps: Omit<DockGroupProps, 'group'> = {
    draggingPane,
    onActivate: (groupId, pane) => setLayout((current) => activateDockPane(current, groupId, pane)),
    onDockIntoGroup: (pane, groupId) => {
      setLayout((current) => dockPaneToGroup(current, pane, groupId));
      finishDockDrag();
    },
    onDockAtTab: (pane, groupId, targetPane, side) => {
      setLayout((current) => dockPaneAdjacentToTab(current, pane, groupId, targetPane, side));
      finishDockDrag();
    },
    onFloat: floatAtCenter,
    onClearDropPreview: () => setDropTarget(null),
    onPointerDockStart: beginPointerDock,
    onPointerDockMove: updatePointerDock,
    onPointerDockEnd: finishPointerDock,
    onPointerDockCancel: finishDockDrag,
    onClose: (pane) => setLayout((current) => closeDockPane(current, pane)),
  };

  const updateDockGroupWeights = (zone: DockZone, weights: Record<string, number>) => {
    setLayout((current) => resizeDockGroups(current, zone, weights));
  };

  const workspaceStyle = {
    gridTemplateColumns: `${hasLeft ? `${left.size}px` : '0px'} ${hasLeft ? 'var(--panel-divider-size)' : '0px'} minmax(200px, 1fr) ${hasRight ? 'var(--panel-divider-size)' : '0px'} ${hasRight ? `${right.size}px` : '0px'}`,
    gridTemplateRows: `${hasTop ? `${top.size}px` : '0px'} ${hasTop ? 'var(--panel-divider-size)' : '0px'} minmax(120px, 1fr) ${hasBottom ? 'var(--panel-divider-size)' : '0px'} ${hasBottom ? `${bottom.size}px` : '0px'}`,
    '--dock-bottom-size': `${bottom.size}px`,
    '--dock-bottom-preview-size': `${Math.max(60, bottom.size / 2)}px`,
  } as CSSProperties;

  return (
    <div
      className={`dock-workspace${hasBottom ? ' has-bottom-dock' : ''}`}
      ref={workspaceRef}
      style={workspaceStyle}
    >
      {hasTop ? (
        <DockRegion
          zone="top"
          groups={layout.zones.top}
          onResizeGroups={updateDockGroupWeights}
          {...groupProps}
        />
      ) : null}
      {hasTop ? (
        <ResizeHandle axis="row" gridColumn="1 / -1" gridRow="2" onPointerDown={top.startDrag} />
      ) : null}
      {hasLeft ? (
        <DockRegion
          zone="left"
          groups={layout.zones.left}
          onResizeGroups={updateDockGroupWeights}
          {...groupProps}
        />
      ) : null}
      {hasLeft ? (
        <ResizeHandle axis="col" gridColumn="2" gridRow="3" onPointerDown={left.startDrag} />
      ) : null}
      <main className="dock-center">{center}</main>
      {hasRight ? (
        <ResizeHandle axis="col" gridColumn="4" gridRow="3" onPointerDown={right.startDrag} />
      ) : null}
      {hasRight ? (
        <DockRegion
          zone="right"
          groups={layout.zones.right}
          onResizeGroups={updateDockGroupWeights}
          {...groupProps}
        />
      ) : null}
      {hasBottom ? (
        <ResizeHandle axis="row" gridColumn="1 / -1" gridRow="4" onPointerDown={bottom.startDrag} />
      ) : null}
      {hasBottom ? (
        <DockRegion
          zone="bottom"
          groups={layout.zones.bottom}
          onResizeGroups={updateDockGroupWeights}
          {...groupProps}
        />
      ) : null}

      {layout.floating.map((floating) => (
        <FloatingDockPane
          key={floating.pane}
          floating={floating}
          workspace={workspaceRef.current}
          onMoveStart={beginFloatingMove}
          onMove={updateFloatingMove}
          onMoveEnd={finishFloatingMove}
          onDragStart={beginDockDrag}
          onDragEnd={finishDockDrag}
          onDock={(pane, zone) => setLayout((current) => dockPaneToZone(current, pane, zone))}
          onClose={(pane) => setLayout((current) => closeDockPane(current, pane))}
        />
      ))}

      {draggingPane ? (
        <div className="dock-hints" aria-label={`Dock ${DOCK_PANE_LABELS[draggingPane]}`}>
          {dropTarget ? <div className={`dock-drop-preview ${dropTarget}`} /> : null}
          <div className="dock-hint-cluster">
            {(['top', 'left', 'float', 'right', 'bottom'] as DockDropTarget[]).map((target) => (
              <div
                key={target}
                className={`dock-hint dock-hint-${target}${dropTarget === target ? ' active' : ''}`}
                role="button"
                aria-label={target === 'float' ? 'Float pane' : `Dock ${target}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDropTarget(target);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => dockToTarget(event, target)}
              >
                <DockTargetIcon target={target} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {movingFloatingPane && edgeDropTarget ? (
        <div
          className="dock-hints dock-edge-hints"
          aria-label={`Dock ${DOCK_PANE_LABELS[movingFloatingPane]} ${edgeDropTarget}`}
        >
          <div className={`dock-drop-preview ${edgeDropTarget}`} />
          <div className={`dock-edge-hint ${edgeDropTarget}`}>
            <DockTargetIcon target={edgeDropTarget} />
            <span>Dock {edgeDropTarget}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
