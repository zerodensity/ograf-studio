import { SnapshotButton } from './SnapshotButton';
import { STAGE_ZOOM_PRESETS } from './stageZoom';
import { KEY_VIEW_COLOR_MATRIX, KEY_VIEW_FILTER_ID } from './viewportKeyView';
import './ViewportFooter.css';

interface ViewportFooterProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo: (zoom: number) => void;
  onFit: () => void;
  keyView: boolean;
  onToggleKeyView: () => void;
}

/** Bottom bar of the canvas: key view, snapshot, zoom level, presets, Fit and 100%. */
export function ViewportFooter({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onFit,
  keyView,
  onToggleKeyView,
}: ViewportFooterProps) {
  const percent = Math.round(zoom * 100);
  return (
    <div className="viewport-footer" role="toolbar" aria-label="Viewport">
      <button
        type="button"
        className="viewport-footer-icon viewport-key-toggle"
        aria-pressed={keyView}
        aria-label="Key view"
        title="Key view: show the alpha channel as greyscale (K)"
        onClick={onToggleKeyView}
      >
        K
      </button>
      <svg
        className="viewport-footer-defs"
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <filter id={KEY_VIEW_FILTER_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={KEY_VIEW_COLOR_MATRIX} />
        </filter>
      </svg>
      <SnapshotButton />
      <span className="viewport-footer-separator" aria-hidden="true" />
      <div className="viewport-footer-zoom">
        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Zoom out"
          title="Zoom out (Ctrl/Command+minus)"
        >
          −
        </button>
        <select
          aria-label="Zoom level"
          title="Zoom level"
          value="current"
          onChange={(event) => {
            const { value } = event.target;
            if (value === 'fit') onFit();
            else onZoomTo(Number(value));
          }}
        >
          <option value="current" hidden>
            {percent}%
          </option>
          <option value="fit">Fit (Shift+1)</option>
          {STAGE_ZOOM_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset * 100}%{preset === 1 ? ' (Shift+0)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Zoom in"
          title="Zoom in (Ctrl/Command+plus)"
        >
          +
        </button>
      </div>
      <button type="button" onClick={onFit} title="Fit the frame in the viewport (Shift+1)">
        Fit
      </button>
      <button type="button" onClick={() => onZoomTo(1)} title="Show the frame at 100% (Shift+0)">
        100%
      </button>
    </div>
  );
}
