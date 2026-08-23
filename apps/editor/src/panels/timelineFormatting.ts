/** Formats an authored frame span as an elapsed wall-clock duration. */
export function formatFrameDuration(frames: number, frameRate: number): string {
  if (frameRate <= 0) return '00:00.000';
  const totalMilliseconds = Math.round((frames / frameRate) * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${clock}` : clock;
}

export interface MillisecondFrameAnalysis {
  milliseconds: number;
  exactFrames: number;
  floorFrames: number;
  nearestFrames: number;
  ceilFrames: number;
  representable: boolean;
}

export function millisecondsForFrames(frames: number, frameRate: number): number {
  return frameRate > 0 ? (frames / frameRate) * 1000 : 0;
}

/** Explains how a wall-clock duration maps onto an integer broadcast-frame ruler. */
export function analyzeMillisecondDuration(
  milliseconds: number,
  frameRate: number,
): MillisecondFrameAnalysis {
  const exactFrames = frameRate > 0 ? (milliseconds / 1000) * frameRate : 0;
  const nearestFrames = Math.round(exactFrames);
  return {
    milliseconds,
    exactFrames,
    floorFrames: Math.floor(exactFrames),
    nearestFrames,
    ceilFrames: Math.ceil(exactFrames),
    representable: Math.abs(exactFrames - nearestFrames) < 1e-7,
  };
}
