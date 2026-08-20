import type { Composition } from '@ograf-editor/scene-model';

export function CanvasLayoutOverlay({ composition }: { composition: Composition }) {
  const layout = composition.layout;
  return (
    <div className="canvas-layout-overlay" aria-hidden="true">
      {layout.showActionSafe && <div className="canvas-safe-area action-safe" />}
      {layout.showTitleSafe && <div className="canvas-safe-area title-safe" />}
    </div>
  );
}
