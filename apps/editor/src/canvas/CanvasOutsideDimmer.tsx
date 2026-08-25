import type { CSSProperties } from 'react';
import type { Composition } from '@ograf-editor/scene-model';

interface DimmerStyle extends CSSProperties {
  '--stage-frame-width': string;
  '--stage-frame-height': string;
}

export function CanvasOutsideDimmer({
  composition,
  zoom,
}: {
  composition: Composition;
  zoom: number;
}) {
  if (!composition.layout.dimOutsideCanvas) return null;
  return (
    <div
      className="canvas-outside-dimmer"
      aria-hidden="true"
      style={
        {
          '--stage-frame-width': `${composition.width * zoom}px`,
          '--stage-frame-height': `${composition.height * zoom}px`,
        } as DimmerStyle
      }
    >
      <span className="top" />
      <span className="right" />
      <span className="bottom" />
      <span className="left" />
    </div>
  );
}
