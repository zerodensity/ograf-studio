import { useCanvasViewStore } from '../state/canvasViewStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import {
  Fragment,
  useCallback,
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
import { useAgentReviewStore } from '../state/agentReviewStore';
import { ResourcesPanel } from '../panels/ResourcesPanel';
import { BrandKitPanel } from '../panels/BrandKitPanel';
import { InspectorPanel } from '../panels/InspectorPanel';
import { ModifiersPanel } from '../panels/ModifiersPanel';
import { DataPanel } from '../panels/DataPanel';
import { RulesPanel } from '../panels/RulesPanel';
import { FunctionsPanel } from '../panels/FunctionsPanel';
import { PreviewExportPanel } from '../panels/PreviewExportPanel';
import { PlayoutControlsPanel } from '../panels/PlayoutControlsPanel';
import { TimelinePanel } from '../panels/TimelinePanel';
import { HistoryPanel } from '../panels/HistoryPanel';
import { BoardPanel } from '../panels/BoardPanel';
import { ReviewPanel } from '../panels/ReviewPanel';
import { PluginsPanel } from '../panels/PluginsPanel';
import { TransitionsPanel } from '../panels/TransitionsPanel';
import { TemplateNavigatorPanel } from '../panels/TemplateNavigatorPanel';
import { SceneTreePanel } from '../panels/SceneTreePanel';
import { DockPaneVisibilityProvider } from './PaneVisibilityContext';
import { ResizeHandle } from './ResizeHandle';
import { PropertyColumnProvider } from '../components/PropertyRow';
import { DetachablePane } from './DetachedWindows';
import { useDetachedWindows } from './detachedWindowContext';
import { useResizable } from './useResizable';
import { createDockingSuppression } from './dockingSuppression';
import { centerFloatingPane } from './centerFloatingPane';
import {
  outerDockDividerPlacement,
  outerDockPlacement,
  outerHorizontalPreviewSpan,
} from './outerDockPlacement';
import {
  activateDockPane,
  revealDockPane,
  closeDockPane,
  DEFAULT_RULES_UNDOCKED_WIDTH,
  DEFAULT_PLUGINS_UNDOCKED_WIDTH,
  DEFAULT_TRANSITION_LOGIC_FLOATING_WIDTH,
  DOCK_PANE_LABELS,
  dockPaneAdjacentToTab,
  dockPaneToGroup,
  dockPaneToZone,
  dockPaneToOuterZone,
  dockPaneAdjacentToGroup,
  resizeOuterDockGroups,
  dockZoneNearPointer,
  floatDockPane,
  initialFloatingWidth,
  moveFloatingDockPane,
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

const PANE_MIME = 'application/x-ograf-studio-pane';

function PaneContent({ pane, active }: { pane: DockPaneId; active: boolean }) {
  const { windows } = useDetachedWindows();
  return (
    <DockPaneVisibilityProvider visible={active || Boolean(windows[pane])}>
      <DetachablePane pane={pane}>
        <PropertyColumnProvider key={pane} pane={pane}>
          <PaneBody pane={pane} />
        </PropertyColumnProvider>
      </DetachablePane>
    </DockPaneVisibilityProvider>
  );
}

function PaneBody({ pane }: { pane: DockPaneId }) {
  switch (pane) {
    case 'layers':
      return <LayerListPanel />;
    case 'templates':
      return <TemplateNavigatorPanel />;
    case 'scene-tree':
      return <SceneTreePanel />;
    case 'chat':
      return <AgentChatPanel />;
    case 'resources':
      return <ResourcesPanel />;
    case 'brand-kit':
      return <BrandKitPanel />;
    case 'inspector':
      return <InspectorPanel />;
    case 'modifiers':
      return <ModifiersPanel />;
    case 'data':
      return <DataPanel />;
    case 'rules':
      return <RulesPanel />;
    case 'functions':
      return <FunctionsPanel />;
    case 'export':
      return <PreviewExportPanel />;
    case 'playout-controls':
      return <PlayoutControlsPanel />;
    case 'timeline':
      return <TimelinePanel />;
    case 'history':
      return <HistoryPanel />;
    case 'board':
      return <BoardPanel />;
    case 'review':
      return <ReviewPanel />;
    case 'plugins':
      return <PluginsPanel />;
    case 'transitions':
      return <TransitionsPanel />;
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
  isDockingSuppressed: () => boolean;
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
  isDockingSuppressed,
  onClose,
}: DockGroupProps) {
  const suppressClickRef = useRef(false);
  const detached = useDetachedWindows();
  const visiblePanes = group.panes.filter((pane) => !detached.windows[pane]);
  const activePane = visiblePanes.includes(group.activePane)
    ? group.activePane
    : (visiblePanes[0] ?? group.activePane);

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
      if (commit && moved && target && !isDockingSuppressed()) {
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
      if (!hovered || !targetPane || !targetGroupId || overSource || isDockingSuppressed()) {
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
    <section
      data-dock-group-id={group.id}
      className={`dock-group${visiblePanes.length ? '' : ' detached-empty'}`}
      style={{ flexGrow: group.weight }}
    >
      <div
        className="dock-tabs"
        role="tablist"
        aria-label={`${DOCK_PANE_LABELS[activePane]} pane group`}
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
        {visiblePanes.map((pane) => (
          <button
            key={pane}
            type="button"
            role="tab"
            data-dock-pane={pane}
            data-dock-group={group.id}
            className={pane === activePane ? 'active' : ''}
            aria-selected={pane === activePane}
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
          className="dock-pane-popout"
          aria-label={`Open ${DOCK_PANE_LABELS[activePane]} in new window`}
          title="Open in new window"
          onClick={() => detached.open(activePane)}
        >
          ↗
        </button>
        <button
          type="button"
          className="dock-pane-close"
          aria-label={`Close ${DOCK_PANE_LABELS[activePane]}`}
          title={`Close ${DOCK_PANE_LABELS[activePane]}`}
          onClick={() => onClose(activePane)}
        >
          ×
        </button>
      </div>
      <div className="dock-group-content">
        {group.panes.map((pane) => (
          <div
            key={pane}
            className={`dock-pane-content${pane === activePane && !detached.windows[pane] ? ' active' : ''}`}
            role="tabpanel"
            aria-label={DOCK_PANE_LABELS[pane]}
            hidden={pane !== activePane || Boolean(detached.windows[pane])}
          >
            <PaneContent pane={pane} active={pane === activePane} />
          </div>
        ))}
      </div>
    </section>
  );
}

interface DockRegionProps extends Omit<DockGroupProps, 'group'> {
  zone: DockZone;
  outer?: boolean;
  regionStyle?: CSSProperties;
  groups: DockGroupState[];
  onResizeGroups: (zone: DockZone, weights: Record<string, number>) => void;
}

function DockRegion({
  zone,
  outer = false,
  regionStyle,
  groups,
  onResizeGroups,
  ...groupProps
}: DockRegionProps) {
  const { windows } = useDetachedWindows();
  const visibleGroups = groups.filter((group) => group.panes.some((pane) => !windows[pane]));
  const regionRef = useRef<HTMLDivElement>(null);
  const vertical = zone === 'left' || zone === 'right' || zone === 'bottom';

  const beginGroupResize = (event: ReactPointerEvent<HTMLDivElement>, dividerIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const region = regionRef.current;
    if (!region) return;
    const groupElements = [...region.children].filter(
      (child) =>
        child.classList.contains('dock-group') && !child.classList.contains('detached-empty'),
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
        Object.fromEntries(visibleGroups.map((group, index) => [group.id, nextSizes[index]!])),
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
      className={`dock-region ${outer ? `dock-outer-${zone}` : `dock-region-${zone}`}${vertical ? ' vertical' : ' horizontal'}${visibleGroups.length ? '' : ' detached-empty'}`}
      style={regionStyle}
      aria-label={`${zone} dock region`}
    >
      {groups.map((group) => (
        <Fragment key={group.id}>
          <DockGroup group={group} {...groupProps} />
          {visibleGroups.includes(group) &&
          visibleGroups.indexOf(group) < visibleGroups.length - 1 ? (
            <div
              className={`dock-group-resize-handle ${vertical ? 'row' : 'col'}`}
              role="separator"
              aria-orientation={vertical ? 'horizontal' : 'vertical'}
              aria-label={`Resize ${DOCK_PANE_LABELS[group.activePane]} and ${DOCK_PANE_LABELS[visibleGroups[visibleGroups.indexOf(group) + 1]!.activePane]}`}
              onPointerDown={(event) => beginGroupResize(event, visibleGroups.indexOf(group))}
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
  const detached = useDetachedWindows();
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
      className={`dock-floating-pane${detached.windows[floating.pane] ? ' detached-empty' : ''}`}
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
            aria-label={`Open ${DOCK_PANE_LABELS[floating.pane]} in new window`}
            title="Open in new window"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => detached.open(floating.pane)}
          >
            ↗
          </button>
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
        <PaneContent pane={floating.pane} active />
      </div>
    </section>
  );
}

type OuterDockTarget = `outer-${DockZone}`;
type GroupDockTarget = `group:${string}:${'before' | 'after'}`;
type TabDockTarget = `tab:${string}`;
type DockDropTarget = DockZone | OuterDockTarget | GroupDockTarget | TabDockTarget | 'float';

/** While a docking preview shows, tells the user Esc keeps the pane where they drop it. */
function DockEscapeNote({ placement }: { placement: 'center' | DockZone }) {
  return (
    <div className={`dock-escape-note ${placement}`} role="note">
      Press <kbd>Esc</kbd> to move without docking
    </div>
  );
}

function DockTargetIcon({ target }: { target: DockZone | 'float' }) {
  return (
    <span className={`dock-target-icon ${target}`} aria-hidden="true">
      <i />
    </span>
  );
}

export interface DockPaneCommand {
  id: number;
  action: 'open' | 'close' | 'float-center';
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
  const innerWorkspaceRef = useRef<HTMLDivElement>(null);
  const designView = useCanvasViewStore((state) => state.mode === 'design');
  const layout = useWorkspaceStore((state) => state.current.layout);
  const sizes = useWorkspaceStore((state) => state.current.sizes);
  const applyRevision = useWorkspaceStore((state) => state.applyRevision);
  const setLayout = useCallback(
    (next: DockLayoutState | ((current: DockLayoutState) => DockLayoutState)) => {
      const state = useWorkspaceStore.getState();
      state.updateLayout(typeof next === 'function' ? next(state.current.layout) : next);
    },
    [],
  );
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const fitFloatingPanes = () => {
      const bounds = workspace.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setLayout((current) => {
        let changed = false;
        const floating = current.floating.map((pane) => {
          const width = Math.min(pane.width, Math.max(100, bounds.width - 12));
          const height = Math.min(pane.height, Math.max(80, bounds.height - 12));
          const x = Math.max(0, Math.min(pane.x, bounds.width - width));
          const y = Math.max(0, Math.min(pane.y, bounds.height - height));
          if (width === pane.width && height === pane.height && x === pane.x && y === pane.y)
            return pane;
          changed = true;
          return { ...pane, x, y, width, height };
        });
        return changed ? { ...current, floating } : current;
      });
    };
    fitFloatingPanes();
    const observer = new ResizeObserver(fitFloatingPanes);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [applyRevision, setLayout]);
  const detached = useDetachedWindows();
  const detachedRef = useRef(detached);
  detachedRef.current = detached;
  const proposalId = useAgentReviewStore((state) => state.proposals[0]?.id);
  useEffect(() => {
    if (proposalId) setLayout((current) => revealDockPane(current, 'chat'));
  }, [proposalId]);
  const paneRequest = usePaneRequestStore((state) => state.request);
  useEffect(() => {
    if (paneRequest) {
      const entry = detachedRef.current.windows[paneRequest.pane];
      if (entry && !entry.window.closed) entry.window.focus();
      setLayout((current) => revealDockPane(current, paneRequest.pane));
    }
  }, [paneRequest]);
  const resetRequest = usePaneRequestStore((state) => state.resetRequest);
  useEffect(() => {
    if (resetRequest > 0) useWorkspaceStore.getState().resetCurrent();
  }, [resetRequest]);
  const { windows: detachedWindows } = detached;
  const [draggingPane, setDraggingPane] = useState<DockPaneId | null>(null);
  const [dropTarget, setDropTarget] = useState<DockDropTarget | null>(null);
  const [movingFloatingPane, setMovingFloatingPane] = useState<DockPaneId | null>(null);
  const [edgeDropTarget, setEdgeDropTarget] = useState<DockDropTarget | null>(null);
  const [dockingSuppressed, setDockingSuppressed] = useState(false);
  const [dockingSuppression] = useState(() =>
    createDockingSuppression(window, (suppressed) => {
      setDockingSuppressed(suppressed);
      if (!suppressed) return;
      setDropTarget(null);
      setEdgeDropTarget(null);
      clearTabDropIndicators();
    }),
  );
  useEffect(() => () => dockingSuppression.disarm(), [dockingSuppression]);

  const left = useResizable({
    key: 'left-sidebar',
    axis: 'col',
    defaultSize: 380,
    value: sizes.left,
    onSizeChange: (left) => useWorkspaceStore.getState().updateSizes({ left }),
    min: 220,
    max: 520,
  });
  const right = useResizable({
    key: 'right-tabs',
    axis: 'col',
    defaultSize: 300,
    value: sizes.right,
    onSizeChange: (right) => useWorkspaceStore.getState().updateSizes({ right }),
    min: 220,
    max: 520,
    invert: true,
  });
  const top = useResizable({
    key: 'top-dock',
    axis: 'row',
    defaultSize: 220,
    value: sizes.top,
    onSizeChange: (top) => useWorkspaceStore.getState().updateSizes({ top }),
    min: 120,
    max: 420,
  });
  const bottom = useResizable({
    key: 'timeline',
    axis: 'row',
    defaultSize: 220,
    value: sizes.bottom,
    onSizeChange: (bottom) => useWorkspaceStore.getState().updateSizes({ bottom }),
    min: 120,
    max: 480,
    invert: true,
  });

  const outerLeft = useResizable({
    key: 'outer-left',
    axis: 'col',
    defaultSize: 300,
    value: sizes.outerLeft ?? 300,
    onSizeChange: (outerLeft) => useWorkspaceStore.getState().updateSizes({ outerLeft }),
    min: 180,
    max: 700,
  });
  const outerRight = useResizable({
    key: 'outer-right',
    axis: 'col',
    defaultSize: 300,
    value: sizes.outerRight ?? 300,
    onSizeChange: (outerRight) => useWorkspaceStore.getState().updateSizes({ outerRight }),
    min: 180,
    max: 700,
    invert: true,
  });
  const outerTop = useResizable({
    key: 'outer-top',
    axis: 'row',
    defaultSize: 200,
    value: sizes.outerTop ?? 200,
    onSizeChange: (outerTop) => useWorkspaceStore.getState().updateSizes({ outerTop }),
    min: 100,
    max: 500,
  });
  const outerBottom = useResizable({
    key: 'outer-bottom',
    axis: 'row',
    defaultSize: 200,
    value: sizes.outerBottom ?? 200,
    onSizeChange: (outerBottom) => useWorkspaceStore.getState().updateSizes({ outerBottom }),
    min: 100,
    max: 500,
    invert: true,
  });

  useEffect(() => onClosedPanesChange?.(layout.closed), [layout.closed, onClosedPanesChange]);
  useEffect(() => {
    if (!paneCommand) return;
    if (paneCommand.action === 'float-center') {
      // Return an OS-detached pane to its stable Studio host before floating it here.
      if (detachedRef.current.windows[paneCommand.pane]) detachedRef.current.dock(paneCommand.pane);
      const bounds = workspaceRef.current?.getBoundingClientRect();
      setLayout((current) =>
        centerFloatingPane(current, paneCommand.pane, {
          width: bounds?.width ?? 760,
          height: bounds?.height ?? 640,
        }),
      );
      return;
    }
    if (paneCommand.action === 'close') detachedRef.current.dock(paneCommand.pane);
    setLayout((current) => {
      if (paneCommand.action === 'close') return closeDockPane(current, paneCommand.pane);
      const bounds = workspaceRef.current?.getBoundingClientRect();
      if (!bounds) return reopenDockPane(current, paneCommand.pane);
      const preferred =
        paneCommand.pane === 'timeline'
          ? { width: 720, height: 340 }
          : paneCommand.pane === 'plugins'
            ? { width: DEFAULT_PLUGINS_UNDOCKED_WIDTH, height: 520 }
            : paneCommand.pane === 'transitions'
              ? { width: DEFAULT_TRANSITION_LOGIC_FLOATING_WIDTH, height: 520 }
              : paneCommand.pane === 'rules' || paneCommand.pane === 'functions'
                ? { width: DEFAULT_RULES_UNDOCKED_WIDTH, height: 460 }
                : paneCommand.pane === 'chat' || paneCommand.pane === 'export'
                  ? { width: 460, height: 520 }
                  : { width: 380, height: 460 };
      const width = Math.max(240, Math.min(preferred.width, bounds.width - 24));
      const height = Math.max(160, Math.min(preferred.height, bounds.height - 24));
      const cascade = (current.floating.length % 5) * 18;
      const x = Math.max(
        6,
        Math.min(bounds.width - width - 6, (bounds.width - width) / 2 + cascade),
      );
      const y = Math.max(
        6,
        Math.min(bounds.height - height - 6, (bounds.height - height) / 2 + cascade),
      );
      return reopenDockPane(current, paneCommand.pane, { x, y, width, height });
    });
  }, [paneCommand, setLayout]);

  const visibleZone = (zone: DockZone) =>
    layout.zones[zone].some((group) => group.panes.some((pane) => !detachedWindows[pane]));
  const hasLeft = visibleZone('left');
  const hasRight = visibleZone('right');
  const hasTop = visibleZone('top');
  const hasBottom = visibleZone('bottom');

  const beginDockDrag = (event: DragEvent, pane: DockPaneId) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(PANE_MIME, pane);
    event.dataTransfer.setData('text/plain', pane);
    setDraggingPane(pane);
  };

  function clearTabDropIndicators() {
    workspaceRef.current
      ?.querySelectorAll('.dock-tab-drop-before, .dock-tab-drop-after')
      .forEach((element) =>
        element.classList.remove('dock-tab-drop-before', 'dock-tab-drop-after'),
      );
  }

  const finishDockDrag = () => {
    clearTabDropIndicators();
    dockingSuppression.disarm();
    setDraggingPane(null);
    setDropTarget(null);
  };

  const pointerDockTargetAt = (clientX: number, clientY: number): DockDropTarget | null => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    const inner = innerWorkspaceRef.current?.getBoundingClientRect();
    if (
      !bounds ||
      !inner ||
      clientX < bounds.left ||
      clientX > bounds.right ||
      clientY < bounds.top ||
      clientY > bounds.bottom
    )
      return null;
    // Outer guides take priority over the pane under them. These use the same
    // hit area whether a tab or a floating pane is being moved.
    const outerGuides: Array<{ zone: DockZone; x: number; y: number }> = [
      { zone: 'left', x: bounds.left + 22, y: bounds.top + bounds.height / 2 },
      { zone: 'right', x: bounds.right - 22, y: bounds.top + bounds.height / 2 },
      { zone: 'top', x: bounds.left + bounds.width / 2, y: bounds.top + 22 },
      { zone: 'bottom', x: bounds.left + bounds.width / 2, y: bounds.bottom - 22 },
    ];
    const edge =
      outerGuides.find(
        (guide) => Math.abs(clientX - guide.x) <= 22 && Math.abs(clientY - guide.y) <= 22,
      )?.zone ?? dockZoneNearPointer(clientX, clientY, bounds, 16);
    if (edge) return `outer-${edge}`;
    const groups =
      workspaceRef.current?.querySelectorAll<HTMLElement>('.dock-group:not(.detached-empty)') ?? [];
    for (const group of groups) {
      const box = group.getBoundingClientRect();
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom)
        continue;
      const tabs = group.querySelector('.dock-tabs')?.getBoundingClientRect();
      if (
        tabs &&
        clientY >= tabs.top + 9 &&
        clientY <= tabs.bottom &&
        clientX >= tabs.left &&
        clientX <= tabs.right
      ) {
        return `tab:${group.dataset.dockGroupId}`;
      }
      const region = group.closest('.dock-region');
      const vertical = region?.classList.contains('vertical');
      // Leave the tab bar usable for grouping while providing a generous
      // insertion target just underneath it, including for the topmost pane.
      if (
        vertical &&
        tabs &&
        clientY > tabs.bottom &&
        clientY <= tabs.bottom + Math.min(32, box.height * 0.2)
      ) {
        return `group:${group.dataset.dockGroupId}:before`;
      }
      const offset = vertical ? clientY - box.top : clientX - box.left;
      const extent = vertical ? box.height : box.width;
      const threshold = Math.min(32, extent * 0.2);
      if (offset < threshold || offset > extent - threshold) {
        return `group:${group.dataset.dockGroupId}:${offset < threshold ? 'before' : 'after'}`;
      }
    }
    const centerX = inner.left + inner.width / 2;
    const centerY = inner.top + inner.height / 2;
    const guides: Array<{ target: DockDropTarget; x: number; y: number }> = [
      { target: 'top', x: centerX, y: centerY - 49 },
      { target: 'left', x: centerX - 49, y: centerY },
      { target: 'float', x: centerX, y: centerY },
      { target: 'right', x: centerX + 49, y: centerY },
      { target: 'bottom', x: centerX, y: centerY + 49 },
    ];
    return (
      guides.find(
        (candidate) =>
          Math.abs(clientX - candidate.x) <= 24 && Math.abs(clientY - candidate.y) <= 24,
      )?.target ?? null
    );
  };

  const applyDockTarget = (pane: DockPaneId, target: DockDropTarget) => {
    if (target.startsWith('outer-')) {
      setLayout((current) => dockPaneToOuterZone(current, pane, target.slice(6) as DockZone));
    } else if (target.startsWith('tab:')) {
      setLayout((current) => dockPaneToGroup(current, pane, target.slice(4)));
    } else if (target.startsWith('group:')) {
      const [, groupId, side] = target.split(':');
      if (groupId && (side === 'before' || side === 'after'))
        setLayout((current) => dockPaneAdjacentToGroup(current, pane, groupId, side));
    } else if (target !== 'float') {
      setLayout((current) => dockPaneToZone(current, pane, target as DockZone));
    }
  };

  const beginPointerDock = (pane: DockPaneId) => {
    dockingSuppression.arm();
    setDraggingPane(pane);
    setDropTarget(null);
  };

  const updatePointerDock = (clientX: number, clientY: number) => {
    setDropTarget(dockingSuppression.suppressed ? null : pointerDockTargetAt(clientX, clientY));
  };

  const finishPointerDock = (pane: DockPaneId, clientX: number, clientY: number) => {
    const target = dockingSuppression.suppressed ? null : pointerDockTargetAt(clientX, clientY);
    if (target && target !== 'float') {
      applyDockTarget(pane, target);
    } else {
      const bounds = workspaceRef.current?.getBoundingClientRect();
      const workspaceWidth = bounds?.width ?? 760;
      const width = initialFloatingWidth(pane, workspaceWidth, 360);
      setLayout((current) =>
        floatDockPane(current, pane, {
          x: Math.max(
            0,
            Math.min(workspaceWidth - width, clientX - (bounds?.left ?? 0) - width / 2),
          ),
          y: Math.max(0, clientY - (bounds?.top ?? 0) - 28),
          width,
        }),
      );
    }
    finishDockDrag();
  };

  const beginFloatingMove = (pane: DockPaneId) => {
    dockingSuppression.arm();
    setMovingFloatingPane(pane);
    setEdgeDropTarget(null);
  };

  const updateFloatingMove = (
    pane: DockPaneId,
    x: number,
    y: number,
    _width: number,
    _height: number,
    clientX: number,
    clientY: number,
  ) => {
    setLayout((current) => moveFloatingDockPane(current, pane, x, y));
    setEdgeDropTarget(dockingSuppression.suppressed ? null : pointerDockTargetAt(clientX, clientY));
  };

  const finishFloatingMove = (
    pane: DockPaneId,
    _x: number,
    _y: number,
    _width: number,
    _height: number,
    clientX: number,
    clientY: number,
  ) => {
    const zone = dockingSuppression.suppressed ? null : pointerDockTargetAt(clientX, clientY);
    if (zone && zone !== 'float') applyDockTarget(pane, zone);
    dockingSuppression.disarm();
    setMovingFloatingPane(null);
    setEdgeDropTarget(null);
  };

  const floatAtCenter = (pane: DockPaneId) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    const workspaceWidth = bounds?.width ?? 760;
    const width = initialFloatingWidth(
      pane,
      workspaceWidth,
      Math.min(380, Math.max(280, workspaceWidth - 80)),
    );
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
      const workspaceWidth = bounds?.width ?? 760;
      const width = initialFloatingWidth(pane, workspaceWidth, 360);
      setLayout((current) =>
        floatDockPane(current, pane, {
          x: Math.max(
            0,
            Math.min(workspaceWidth - width, event.clientX - (bounds?.left ?? 0) - width / 2),
          ),
          y: Math.max(0, event.clientY - (bounds?.top ?? 0) - 28),
          width,
        }),
      );
    } else {
      applyDockTarget(pane, target);
    }
    finishDockDrag();
  };

  const closePane = (pane: DockPaneId) => {
    detached.dock(pane);
    setLayout((current) => closeDockPane(current, pane));
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
    isDockingSuppressed: () => dockingSuppression.suppressed,
    onClose: closePane,
  };

  const updateDockGroupWeights = (zone: DockZone, weights: Record<string, number>) => {
    setLayout((current) => resizeDockGroups(current, zone, weights));
  };

  const outerGroups = (zone: DockZone) => layout.outerZones?.[zone] ?? [];
  const hasOuter = (zone: DockZone) =>
    outerGroups(zone).some((group) => group.panes.some((pane) => !detachedWindows[pane]));
  const bottomPriority = hasOuter('bottom') && layout.outerBottomFullWidth === true;
  const timelineOnly = (groups: DockGroupState[]) => {
    const visible = groups.filter((group) => group.panes.some((pane) => !detachedWindows[pane]));
    if (visible.length !== 1) return false;
    const group = visible[0]!;
    const panes = group.panes.filter((pane) => !detachedWindows[pane]);
    return (panes.includes(group.activePane) ? group.activePane : panes[0]) === 'timeline';
  };
  const slimBottom = designView && timelineOnly(layout.zones.bottom);
  const slimOuterBottom = designView && timelineOnly(outerGroups('bottom'));
  const outerStyle = {
    gridTemplateColumns: `${hasOuter('left') ? `${outerLeft.size}px var(--panel-divider-size)` : '0px 0px'} minmax(200px, 1fr) ${hasOuter('right') ? `var(--panel-divider-size) ${outerRight.size}px` : '0px 0px'}`,
    gridTemplateRows: `${hasOuter('top') ? `${outerTop.size}px var(--panel-divider-size)` : '0px 0px'} minmax(120px, 1fr) ${hasOuter('bottom') ? `var(--panel-divider-size) ${slimOuterBottom ? 62 : outerBottom.size}px` : '0px 0px'}`,
  } as CSSProperties;
  const updateOuterWeights = (zone: DockZone, weights: Record<string, number>) =>
    setLayout((current) => resizeOuterDockGroups(current, zone, weights));
  const activeTarget = draggingPane ? dropTarget : edgeDropTarget;
  const outerBounds = workspaceRef.current?.getBoundingClientRect();
  const innerBounds = innerWorkspaceRef.current?.getBoundingClientRect();
  const previewBounds = (() => {
    if (!activeTarget || !outerBounds || !innerBounds || activeTarget === 'float') return undefined;
    let box = activeTarget.startsWith('outer-') ? outerBounds : innerBounds;
    let x = box.left - outerBounds.left,
      y = box.top - outerBounds.top,
      width = box.width,
      height = box.height;
    if (activeTarget.startsWith('group:') || activeTarget.startsWith('tab:')) {
      const [, id, side] = activeTarget.split(':');
      const el = [
        ...(workspaceRef.current?.querySelectorAll<HTMLElement>('.dock-group') ?? []),
      ].find((element) => element.dataset.dockGroupId === id);
      if (!el) return undefined;
      box = el.getBoundingClientRect();
      x = box.left - outerBounds.left;
      y = box.top - outerBounds.top;
      width = box.width;
      height = box.height;
      if (activeTarget.startsWith('tab:')) {
        return { left: x, top: y, width, height } as CSSProperties;
      }
      if (el.closest('.dock-region')?.classList.contains('vertical')) {
        height /= 2;
        if (side === 'after') y += height;
      } else {
        width /= 2;
        if (side === 'after') x += width;
      }
    } else {
      const outer = activeTarget.startsWith('outer-');
      const zone = (outer ? activeTarget.slice(6) : activeTarget) as DockZone;
      if (!outer && (zone === 'left' || zone === 'right')) {
        const center = workspaceRef.current?.querySelector('.dock-center')?.getBoundingClientRect();
        if (center) {
          y = center.top - outerBounds.top;
          height = center.height;
        }
      }
      if (zone === 'left' || zone === 'right') {
        width = Math.min(
          width * 0.45,
          outer
            ? zone === 'left'
              ? outerLeft.size
              : outerRight.size
            : zone === 'left'
              ? left.size
              : right.size,
        );
        if (zone === 'right') x += box.width - width;
      } else {
        if (outer) {
          const span = outerHorizontalPreviewSpan(
            zone,
            outerBounds.width,
            innerBounds.left - outerBounds.left,
            innerBounds.width,
          );
          x = span.left;
          width = span.width;
        }
        height = Math.min(
          height * 0.45,
          outer
            ? zone === 'top'
              ? outerTop.size
              : outerBottom.size
            : zone === 'top'
              ? top.size
              : bottom.size,
        );
        if (zone === 'bottom') y += box.height - height;
      }

      const pane = draggingPane ?? movingFloatingPane;
      if (pane) {
        // The model appends (or prepends) a separate group in this region. The
        // indicator must show the space that group will occupy after flexing,
        // rather than suggesting that it will replace the entire region.
        const result = outer
          ? dockPaneToOuterZone(layout, pane, zone)
          : dockPaneToZone(layout, pane, zone);
        const groups = (outer ? (result.outerZones?.[zone] ?? []) : result.zones[zone]).filter(
          (group) => group.panes.some((item) => !detachedWindows[item]),
        );
        const targetIndex = groups.findIndex((group) => group.panes.includes(pane));
        const region = workspaceRef.current?.querySelector<HTMLElement>(
          outer ? `.dock-outer-${zone}` : `.dock-region-${zone}`,
        );
        if (region && !region.classList.contains('detached-empty')) {
          const regionBox = region.getBoundingClientRect();
          x = regionBox.left - outerBounds.left;
          y = regionBox.top - outerBounds.top;
          width = regionBox.width;
          height = regionBox.height;
          // The outer-edge drop changes corner priority; existing region bounds represent the
          // previous layout. Project the target region before calculating its group split.
          if (outer && zone === 'bottom') {
            x = 0;
            width = outerBounds.width;
          } else if (outer && (zone === 'left' || zone === 'right')) {
            y = 0;
            height = outerBounds.height;
          }
        }
        if (targetIndex >= 0 && groups.length > 1) {
          const vertical = zone === 'left' || zone === 'right' || zone === 'bottom';
          const divider = region?.querySelector<HTMLElement>('.dock-group-resize-handle');
          const dividerBox = divider?.getBoundingClientRect();
          const configuredDivider = region
            ? Number.parseFloat(getComputedStyle(region).getPropertyValue('--panel-divider-size'))
            : 0;
          const dividerSize = dividerBox
            ? vertical
              ? dividerBox.height
              : dividerBox.width
            : Number.isFinite(configuredDivider)
              ? configuredDivider
              : 0;
          const axisSize = vertical ? height : width;
          const available = Math.max(0, axisSize - dividerSize * (groups.length - 1));
          const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
          const beforeWeight = groups
            .slice(0, targetIndex)
            .reduce((sum, group) => sum + group.weight, 0);
          const offset =
            totalWeight > 0
              ? (available * beforeWeight) / totalWeight + dividerSize * targetIndex
              : 0;
          const extent =
            totalWeight > 0 ? (available * groups[targetIndex]!.weight) / totalWeight : axisSize;
          if (vertical) {
            y += offset;
            height = extent;
          } else {
            x += offset;
            width = extent;
          }
        }
      }
    }
    return { left: x, top: y, width, height } as CSSProperties;
  })();
  const clusterStyle =
    outerBounds && innerBounds
      ? {
          left: innerBounds.left - outerBounds.left + innerBounds.width / 2,
          top: innerBounds.top - outerBounds.top + innerBounds.height / 2,
        }
      : undefined;

  const workspaceStyle = {
    gridTemplateColumns: `${hasLeft ? `${left.size}px` : '0px'} ${hasLeft ? 'var(--panel-divider-size)' : '0px'} minmax(200px, 1fr) ${hasRight ? 'var(--panel-divider-size)' : '0px'} ${hasRight ? `${right.size}px` : '0px'}`,
    gridTemplateRows: `${hasTop ? `${top.size}px` : '0px'} ${hasTop ? 'var(--panel-divider-size)' : '0px'} minmax(120px, 1fr) ${hasBottom ? 'var(--panel-divider-size)' : '0px'} ${hasBottom ? `${slimBottom ? 62 : bottom.size}px` : '0px'}`,
  } as CSSProperties;

  return (
    <div
      className="dock-workspace"
      ref={workspaceRef}
      style={outerStyle}
      onDragOver={(event) => {
        if (!draggingPane || dockingSuppression.suppressed) return;
        event.preventDefault();
        setDropTarget(pointerDockTargetAt(event.clientX, event.clientY));
      }}
      onDrop={(event) => {
        const target = pointerDockTargetAt(event.clientX, event.clientY);
        if (target && draggingPane) dockToTarget(event, target);
      }}
    >
      {(['left', 'right', 'top', 'bottom'] as DockZone[]).map((zone) =>
        outerGroups(zone).length ? (
          <DockRegion
            key={`outer-${zone}`}
            outer
            zone={zone}
            regionStyle={outerDockPlacement(zone, bottomPriority)}
            groups={outerGroups(zone)}
            onResizeGroups={updateOuterWeights}
            {...groupProps}
          />
        ) : null,
      )}
      {hasOuter('left') ? (
        <ResizeHandle
          axis="col"
          {...outerDockDividerPlacement('left', bottomPriority)}
          onPointerDown={outerLeft.startDrag}
        />
      ) : null}
      {hasOuter('right') ? (
        <ResizeHandle
          axis="col"
          {...outerDockDividerPlacement('right', bottomPriority)}
          onPointerDown={outerRight.startDrag}
        />
      ) : null}
      {hasOuter('top') ? (
        <ResizeHandle
          axis="row"
          {...outerDockDividerPlacement('top', bottomPriority)}
          onPointerDown={outerTop.startDrag}
        />
      ) : null}
      {hasOuter('bottom') ? (
        <ResizeHandle
          axis="row"
          {...outerDockDividerPlacement('bottom', bottomPriority)}
          onPointerDown={outerBottom.startDrag}
        />
      ) : null}
      <div className="dock-inner-workspace" ref={innerWorkspaceRef} style={workspaceStyle}>
        {layout.zones.top.length > 0 ? (
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
        {layout.zones.left.length > 0 ? (
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
        {layout.zones.right.length > 0 ? (
          <DockRegion
            zone="right"
            groups={layout.zones.right}
            onResizeGroups={updateDockGroupWeights}
            {...groupProps}
          />
        ) : null}
        {hasBottom ? (
          <ResizeHandle
            axis="row"
            gridColumn="1 / -1"
            gridRow="4"
            onPointerDown={bottom.startDrag}
          />
        ) : null}
        {layout.zones.bottom.length > 0 ? (
          <DockRegion
            zone="bottom"
            groups={layout.zones.bottom}
            onResizeGroups={updateDockGroupWeights}
            {...groupProps}
          />
        ) : null}
      </div>
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
          onClose={closePane}
        />
      ))}

      {(draggingPane || movingFloatingPane) && !dockingSuppressed ? (
        <div
          className="dock-hints"
          aria-label={`Dock ${DOCK_PANE_LABELS[(draggingPane ?? movingFloatingPane)!]}`}
        >
          {activeTarget && previewBounds ? (
            <div className="dock-drop-preview dock-geometry-preview" style={previewBounds} />
          ) : null}
          {activeTarget === 'float' ? <div className="dock-drop-preview float" /> : null}
          <div className="dock-hint-cluster" style={clusterStyle}>
            {(['top', 'left', 'float', 'right', 'bottom'] as const).map((target) => (
              <div
                key={target}
                className={`dock-hint dock-hint-${target}${activeTarget === target ? ' active' : ''}`}
                role="button"
                aria-label={target === 'float' ? 'Float pane' : `Dock ${target} inside workspace`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDropTarget(target);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.stopPropagation();
                  dockToTarget(event, target);
                }}
              >
                <DockTargetIcon target={target} />
              </div>
            ))}
          </div>
          {(['top', 'left', 'right', 'bottom'] as DockZone[]).map((zone) => (
            <div
              key={zone}
              className={`dock-hint dock-outer-guide ${zone}${activeTarget === `outer-${zone}` ? ' active' : ''}`}
              role="button"
              aria-label={`Dock ${zone} across workspace`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDropTarget(`outer-${zone}`);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.stopPropagation();
                dockToTarget(event, `outer-${zone}`);
              }}
            >
              <DockTargetIcon target={zone} />
            </div>
          ))}
          <DockEscapeNote placement="center" />
        </div>
      ) : null}
      {dockingSuppressed ? (
        <div className="dock-hints dock-suppressed-hints">
          <div className="dock-suppressed-note" role="status">
            Docking off (Esc)
          </div>
        </div>
      ) : null}
    </div>
  );
}
