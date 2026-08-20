import type { CSSProperties } from 'react';
import { LayerListPanel } from '../panels/LayerListPanel';
import { ResourcesPanel } from '../panels/ResourcesPanel';
import { ResizeHandle } from './ResizeHandle';
import { useResizable } from './useResizable';
import './LeftSidebar.css';

export function LeftSidebar({ style }: { style?: CSSProperties }) {
  const layers = useResizable({
    key: 'left-sidebar-layers',
    axis: 'row',
    defaultSize: 220,
    min: 80,
    max: 600,
  });

  return (
    <div className="left-sidebar" style={style}>
      <div className="left-sidebar-layers" style={{ height: layers.size }}>
        <LayerListPanel />
      </div>
      <ResizeHandle axis="row" onPointerDown={layers.startDrag} />
      <div className="left-sidebar-resources">
        <ResourcesPanel />
      </div>
    </div>
  );
}
