export interface MediaTimelineOptions {
  timelineStartMs: number;
  trimStartMs: number;
  trimEndMs: number | null;
  loop: boolean;
  speed?: number;
  durationMs?: number | null;
}

export interface MediaTimelinePosition {
  active: boolean;
  positionMs: number;
}

/** Maps the absolute OGraf clock to a clip position without mutable timer state. */
export function resolveMediaTimelinePosition(
  elapsedMs: number,
  options: MediaTimelineOptions,
): MediaTimelinePosition {
  const timelineStartMs = Math.max(0, options.timelineStartMs);
  const trimStartMs = Math.max(0, options.trimStartMs);
  const speed = Math.max(0, options.speed ?? 1);
  const localMs = (elapsedMs - timelineStartMs) * speed;
  if (localMs < 0) return { active: false, positionMs: trimStartMs };

  const durationMs =
    options.durationMs !== null &&
    options.durationMs !== undefined &&
    Number.isFinite(options.durationMs) &&
    options.durationMs > trimStartMs
      ? options.durationMs
      : null;
  const trimEndMs = options.trimEndMs ?? durationMs;
  const spanMs = trimEndMs === null ? null : Math.max(0, trimEndMs - trimStartMs);
  if (spanMs === 0) return { active: false, positionMs: trimStartMs };
  if (spanMs !== null && localMs >= spanMs) {
    if (!options.loop) return { active: false, positionMs: trimEndMs! };
    return { active: true, positionMs: trimStartMs + (localMs % spanMs) };
  }
  return { active: true, positionMs: trimStartMs + localMs };
}
