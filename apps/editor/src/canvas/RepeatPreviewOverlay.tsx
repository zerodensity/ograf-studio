import { getLayerTransformAtFrame, type Composition } from '@ograf-editor/scene-model';
import { repeaterCopyRects } from '../panels/repeaterLayout';
import { useRepeatPreviewStore } from '../state/repeatPreviewStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import './RepeatPreviewOverlay.css';

/** Dashed outlines where the Repeat section would place each extra copy. */
export function RepeatPreviewOverlay({
  composition,
  zoom,
}: {
  composition: Composition;
  zoom: number;
}) {
  const preview = useRepeatPreviewStore((s) => s.preview);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const poses = composition.layers
    .filter((layer) => selectedLayerIds.includes(layer.id))
    .map((layer) => getLayerTransformAtFrame(layer, currentFrame));
  if (!preview || poses.length === 0) return null;

  const left = Math.min(...poses.map((pose) => pose.x));
  const top = Math.min(...poses.map((pose) => pose.y));
  const bounds = {
    x: left,
    y: top,
    width: Math.max(...poses.map((pose) => pose.x + pose.width)) - left,
    height: Math.max(...poses.map((pose) => pose.y + pose.height)) - top,
  };
  const inverseZoom = 1 / Math.max(zoom, 0.01);
  return (
    <div className="repeat-preview-overlay" aria-hidden="true">
      {repeaterCopyRects(bounds, preview.count, preview.direction, preview.gap).map((rect) => (
        <div
          key={rect.index}
          className="repeat-preview-copy"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            borderWidth: 2 * inverseZoom,
          }}
        >
          <span style={{ transform: `scale(${inverseZoom})` }}>Item {rect.index}</span>
        </div>
      ))}
    </div>
  );
}
