import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ResizeAxis } from './useResizable';
import './ResizeHandle.css';

interface ResizeHandleProps {
  axis: ResizeAxis;
  gridColumn?: string;
  gridRow?: string;
  onPointerDown: (e: ReactPointerEvent) => void;
}

export function ResizeHandle({ axis, gridColumn, gridRow, onPointerDown }: ResizeHandleProps) {
  return (
    <div
      className={`resize-handle resize-handle-${axis}`}
      style={{ gridColumn, gridRow }}
      onPointerDown={onPointerDown}
    />
  );
}
