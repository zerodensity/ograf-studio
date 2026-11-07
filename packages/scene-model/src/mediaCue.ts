import { computeKeyframeFrames } from './keyframeTiming';
import type { Asset, Composition, MediaCue } from './types';

export function mediaCueStartFrame(cue: MediaCue, composition: Composition): number | null {
  const trigger = cue.trigger;
  if (trigger.type === 'timeline') return trigger.startFrame;
  if (trigger.type === 'lifecycle') {
    return (
      computeKeyframeFrames(composition).find((item) => item.keyframeId === trigger.keyframeId)
        ?.frame ?? 0
    );
  }
  return null;
}

export function mediaCueSourceDurationMs(cue: MediaCue, assets: readonly Asset[]): number | null {
  const source = cue.sources.find((candidate) => candidate.id === cue.activeSourceId);
  if (!source || source.kind !== 'clip') return null;
  if (!source.src.startsWith('asset:')) return null;
  return assets.find((asset) => asset.id === source.src.slice('asset:'.length))?.durationMs ?? null;
}

export function mediaCueTrimmedDurationMs(cue: MediaCue, assets: readonly Asset[]): number | null {
  const endMs = cue.trimEndMs ?? mediaCueSourceDurationMs(cue, assets);
  return endMs === null ? null : Math.max(0, endMs - cue.trimStartMs);
}

export function mediaCueEffectiveDurationFrames(cue: MediaCue, composition: Composition): number {
  if (typeof cue.durationFrames === 'number' && Number.isFinite(cue.durationFrames)) {
    return Math.max(1, Math.round(cue.durationFrames));
  }
  const trimmedMs = mediaCueTrimmedDurationMs(cue, composition.assets);
  if (trimmedMs !== null) {
    return Math.max(
      1,
      Math.ceil((trimmedMs / 1000 / Math.max(0.1, cue.speed)) * composition.frameRate),
    );
  }
  const startFrame = mediaCueStartFrame(cue, composition) ?? 0;
  const totalFrames = computeKeyframeFrames(composition).at(-1)?.frame ?? 1;
  return Math.max(1, totalFrames - startFrame);
}
