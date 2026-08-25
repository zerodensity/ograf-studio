import { useState, type CSSProperties } from 'react';
import { LayerListPanel } from '../panels/LayerListPanel';
import { ResourcesPanel } from '../panels/ResourcesPanel';
import { ResizeHandle } from './ResizeHandle';
import { useResizable } from './useResizable';
import './LeftSidebar.css';
import { AgentChatPanel } from '../panels/AgentChatPanel';

type LeftSidebarTab = 'layers' | 'chat';

function initialTab(): LeftSidebarTab {
  return localStorage.getItem('ograf-studio:left-tab') === 'chat' ? 'chat' : 'layers';
}

export function LeftSidebar({
  style,
  collapsed,
  onToggleCollapsed,
}: {
  style?: CSSProperties;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [tab, setTab] = useState<LeftSidebarTab>(initialTab);
  const layers = useResizable({
    key: 'left-sidebar-layers',
    axis: 'row',
    defaultSize: 220,
    min: 80,
    max: 600,
  });

  const selectTab = (next: LeftSidebarTab) => {
    setTab(next);
    localStorage.setItem('ograf-studio:left-tab', next);
  };

  if (collapsed) {
    return (
      <div className="left-sidebar collapsed" style={style}>
        <button type="button" className="left-sidebar-expand" onClick={onToggleCollapsed}>
          ›
        </button>
      </div>
    );
  }

  return (
    <div className="left-sidebar" style={style}>
      <div className="left-sidebar-tabs">
        <button
          type="button"
          className={tab === 'layers' ? 'active' : ''}
          onClick={() => selectTab('layers')}
        >
          Layers
        </button>
        <button
          type="button"
          className={tab === 'chat' ? 'active' : ''}
          onClick={() => selectTab('chat')}
        >
          Chat
        </button>
        <button
          type="button"
          className="collapse"
          onClick={onToggleCollapsed}
          aria-label="Collapse left sidebar"
        >
          ‹
        </button>
      </div>
      {tab === 'chat' ? (
        <AgentChatPanel />
      ) : (
        <>
          <div className="left-sidebar-layers" style={{ height: layers.size }}>
            <LayerListPanel />
          </div>
          <ResizeHandle axis="row" onPointerDown={layers.startDrag} />
          <div className="left-sidebar-resources">
            <ResourcesPanel />
          </div>
        </>
      )}
    </div>
  );
}
