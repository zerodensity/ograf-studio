import { getEbuR95SafeAreas, type Composition } from '@ograf-editor/scene-model';

export function CanvasLayoutOverlay({
  composition,
  zoom,
}: {
  composition: Composition;
  zoom: number;
}) {
  const layout = composition.layout;
  const safeAreas = getEbuR95SafeAreas(composition);
  return (
    <div className="canvas-layout-overlay" aria-hidden="true">
      {layout.showActionSafe && (
        <div
          className="canvas-safe-area action-safe"
          style={{
            left: safeAreas.actionSafe.x,
            top: safeAreas.actionSafe.y,
            width: safeAreas.actionSafe.width,
            height: safeAreas.actionSafe.height,
          }}
        />
      )}
      {layout.showTitleSafe && (
        <div
          className="canvas-safe-area title-safe"
          style={{
            left: safeAreas.titleSafe.x,
            top: safeAreas.titleSafe.y,
            width: safeAreas.titleSafe.width,
            height: safeAreas.titleSafe.height,
          }}
        />
      )}
      {layout.showCenterMarker && (
        <div
          className="canvas-center-marker"
          style={{
            transform: `translate(-50%, -50%) scale(${1 / Math.max(zoom, 0.01)})`,
          }}
        />
      )}
    </div>
  );
}
