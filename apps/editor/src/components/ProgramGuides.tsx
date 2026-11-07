import { useProgramMonitorStore } from '../state/programMonitorStore';

/** Overlay only: guides do not change the authored graphic or exported output. */
export function ProgramGuides({ width, height }: { width: number; height: number }) {
  const settings = useProgramMonitorStore();
  return <ProgramGuidesView width={width} height={height} {...settings} />;
}

export function ProgramGuidesView({
  width,
  height,
  titleSafe,
  actionSafe,
  aspectGuide,
}: {
  width: number;
  height: number;
  titleSafe: boolean;
  actionSafe: boolean;
  aspectGuide: 'none' | '4:3' | '1:1' | '9:16';
}) {
  if (!titleSafe && !actionSafe && aspectGuide === 'none') return null;
  const ratio =
    aspectGuide === '4:3' ? 4 / 3 : aspectGuide === '1:1' ? 1 : aspectGuide === '9:16' ? 9 / 16 : 0;
  const guideWidth = ratio ? Math.min(width, height * ratio) : 0;
  const guideHeight = ratio ? Math.min(height, width / ratio) : 0;
  return (
    <svg
      aria-label="Program monitor guides"
      className="program-monitor-guides"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 4,
        pointerEvents: 'none',
      }}
    >
      {actionSafe && (
        <rect
          x={width * 0.035}
          y={height * 0.035}
          width={width * 0.93}
          height={height * 0.93}
          fill="none"
          stroke="#67d8ff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {titleSafe && (
        <rect
          x={width * 0.05}
          y={height * 0.05}
          width={width * 0.9}
          height={height * 0.9}
          fill="none"
          stroke="#ffcf6a"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {ratio > 0 && (
        <rect
          x={(width - guideWidth) / 2}
          y={(height - guideHeight) / 2}
          width={guideWidth}
          height={guideHeight}
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeDasharray="8 6"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
