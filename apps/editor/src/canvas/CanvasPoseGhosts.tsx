import {
  computeKeyframeFrames,
  getLayerTransformAtFrame,
  type Composition,
} from '@ograf-editor/scene-model';
export function CanvasPoseGhosts({
  composition,
  selectedLayerIds,
  zoom,
}: {
  composition: Composition;
  selectedLayerIds: string[];
  zoom: number;
}) {
  const frames = computeKeyframeFrames(composition);
  const poses = composition.keyframes.flatMap((key) => {
    if (key.role !== 'start' && key.role !== 'end') return [];
    const frame = frames.find((item) => item.keyframeId === key.id)?.frame;
    if (frame === undefined) return [];
    return composition.layers
      .filter((layer) => selectedLayerIds.includes(layer.id))
      .map((layer) => ({
        id: `${key.id}:${layer.id}`,
        role: key.role,
        pose: getLayerTransformAtFrame(layer, frame),
      }));
  });
  if (!poses.length) return null;
  return (
    <svg
      className="canvas-pose-ghosts"
      aria-label="Before and After pose outlines"
      style={{
        position: 'absolute',
        inset: 0,
        width: composition.width,
        height: composition.height,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 90,
      }}
    >
      {poses.map(({ id, role, pose }) => (
        <rect
          key={id}
          x={0}
          y={0}
          width={pose.width}
          height={pose.height}
          transform={`translate(${pose.x} ${pose.y}) rotate(${pose.rotation} ${pose.transformOriginX * pose.width} ${pose.transformOriginY * pose.height})`}
          fill="none"
          stroke={role === 'start' ? '#58b9f1' : '#eab76c'}
          strokeWidth={1.5 / zoom}
          strokeDasharray={`${5 / zoom} ${4 / zoom}`}
          opacity={0.42}
        />
      ))}
    </svg>
  );
}
