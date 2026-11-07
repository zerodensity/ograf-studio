export function behaviorSeconds(frames: number, frameRate: number): string {
  return `${Number((frames / Math.max(1, frameRate)).toFixed(2))} s`;
}
