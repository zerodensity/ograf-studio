import type { MediaCue, MediaCueSource } from '@ograf-editor/scene-model';

export function soundEventSource(cue: MediaCue): Extract<MediaCueSource, { kind: 'clip' }> | null {
  const source = cue.sources.find((candidate) => candidate.id === cue.activeSourceId);
  return source?.kind === 'clip' && source.mediaType === 'audio' ? source : null;
}

export function isSoundEventCue(cue: MediaCue): boolean {
  return (
    soundEventSource(cue) !== null &&
    (cue.trigger.type === 'timeline' || cue.trigger.type === 'lifecycle')
  );
}
