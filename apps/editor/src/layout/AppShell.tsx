import { useState } from 'react';
import { Menubar } from '../panels/Menubar';
import { LeftSidebar } from './LeftSidebar';
import { Stage } from '../canvas/Stage';
import { RuntimePreviewStage } from '../canvas/RuntimePreviewStage';
import { InspectorPanel } from '../panels/InspectorPanel';
import { DataPanel } from '../panels/DataPanel';
import { PreviewExportPanel } from '../panels/PreviewExportPanel';
import { TimelinePanel } from '../panels/TimelinePanel';
import { ResizeHandle } from './ResizeHandle';
import { useResizable } from './useResizable';
import { useProjectStore } from '../state/projectStore';
import { AgentReviewPanel } from '../panels/AgentReviewPanel';
import './AppShell.css';

const RIGHT_TABS = {
  inspector: { label: 'Inspector', render: () => <InspectorPanel /> },
  data: { label: 'Data', render: () => <DataPanel /> },
  export: { label: 'Preview & Export', render: () => <PreviewExportPanel /> },
} as const;

type RightTabId = keyof typeof RIGHT_TABS;

export function AppShell() {
  const [rightTab, setRightTab] = useState<RightTabId>('inspector');
  const project = useProjectStore((state) => state.project);
  const [runtimePreview, setRuntimePreview] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  const openRuntimePreview = () => setRuntimePreview(true);

  const left = useResizable({
    key: 'left-sidebar',
    axis: 'col',
    defaultSize: 380,
    min: 360,
    max: 420,
  });
  const right = useResizable({
    key: 'right-tabs',
    axis: 'col',
    defaultSize: 300,
    min: 220,
    max: 520,
    invert: true,
  });
  const timeline = useResizable({
    key: 'timeline',
    axis: 'row',
    defaultSize: 220,
    min: 120,
    max: 480,
    invert: true,
  });

  return (
    <div
      className="app-shell"
      style={{
        gridTemplateColumns: `${leftCollapsed ? 34 : left.size}px var(--panel-divider-size) minmax(200px, 1fr) var(--panel-divider-size) ${right.size}px`,
        gridTemplateRows: `40px 8px minmax(120px, 1fr) var(--panel-divider-size) ${timeline.size}px`,
      }}
    >
      <Menubar style={{ gridColumn: '1 / -1', gridRow: 1 }} />
      <LeftSidebar
        style={{ gridColumn: 1, gridRow: '3 / 6' }}
        collapsed={leftCollapsed}
        onToggleCollapsed={() => setLeftCollapsed((value) => !value)}
      />
      {!leftCollapsed ? (
        <ResizeHandle axis="col" gridColumn="2" gridRow="3 / 6" onPointerDown={left.startDrag} />
      ) : null}
      {runtimePreview ? (
        <RuntimePreviewStage
          project={project}
          onExit={() => setRuntimePreview(false)}
          style={{ gridColumn: 3, gridRow: 3 }}
        />
      ) : (
        <Stage style={{ gridColumn: 3, gridRow: 3 }} onEnterOgrafPreview={openRuntimePreview} />
      )}
      <ResizeHandle axis="row" gridColumn="3" gridRow="4" onPointerDown={timeline.startDrag} />
      <TimelinePanel style={{ gridColumn: 3, gridRow: 5 }} />
      <ResizeHandle axis="col" gridColumn="4" gridRow="3 / 6" onPointerDown={right.startDrag} />
      <div className="right-tabs" style={{ gridColumn: 5, gridRow: '3 / 6' }}>
        <div className="right-tabs-bar">
          {(Object.keys(RIGHT_TABS) as RightTabId[]).map((id) => (
            <button
              key={id}
              type="button"
              className={id === rightTab ? 'active' : ''}
              onClick={() => setRightTab(id)}
            >
              {RIGHT_TABS[id].label}
            </button>
          ))}
        </div>
        {RIGHT_TABS[rightTab].render()}
      </div>
      <AgentReviewPanel />
    </div>
  );
}
