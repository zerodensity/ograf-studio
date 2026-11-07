import { useEffect, useRef, useState } from 'react';
import { MAX_STAGE_ZOOM, MIN_STAGE_ZOOM, parseStageZoomPercent } from './stageZoom';

export interface CanvasZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomChange: (zoom: number) => void;
  onFit: () => void;
}

/** Canvas magnification is an editor camera, independent of template output dimensions. */
export function CanvasZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  onFit,
}: CanvasZoomControlsProps) {
  const displayed = String(Math.round(zoom * 1000) / 10);
  const [draft, setDraft] = useState(displayed);
  const [editing, setEditing] = useState(false);
  const cancelEdit = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(displayed);
  }, [displayed, editing]);
  return (
    <div className="canvas-zoom-controls" role="group" aria-label="Canvas zoom">
      <button
        type="button"
        onClick={onZoomOut}
        disabled={zoom <= MIN_STAGE_ZOOM}
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>
      <label className="canvas-zoom-value">
        <input
          type="text"
          inputMode="decimal"
          aria-label="Canvas zoom percentage"
          title="Canvas zoom percentage (5–400%)"
          value={draft}
          onFocus={() => {
            cancelEdit.current = false;
            setEditing(true);
          }}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => {
            const parsed = cancelEdit.current ? null : parseStageZoomPercent(draft);
            if (parsed !== null) onZoomChange(parsed);
            setDraft(parsed === null ? displayed : String(Math.round(parsed * 1000) / 10));
            setEditing(false);
            cancelEdit.current = false;
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              cancelEdit.current = event.key === 'Escape';
              event.currentTarget.blur();
            }
          }}
        />
        <span aria-hidden="true">%</span>
      </label>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={zoom >= MAX_STAGE_ZOOM}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
      <button type="button" onClick={onFit} title="Fit the canvas in the workspace">
        Fit
      </button>
      <button type="button" onClick={() => onZoomChange(1)} title="Actual size (100%)">
        1:1
      </button>
      <select
        aria-label="Canvas zoom presets"
        title="Choose a canvas zoom preset"
        value=""
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (value) onZoomChange(value / 100);
        }}
      >
        <option value="" disabled>
          Presets
        </option>
        {[25, 50, 100, 150, 200, 400].map((percent) => (
          <option key={percent} value={percent}>
            {percent}%
          </option>
        ))}
      </select>
    </div>
  );
}
