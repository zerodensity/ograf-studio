import {
  LIVE_MEDIA_ELEMENT_TAG,
  type MediaCue,
  type MediaCueSource,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { resolveMediaTimelinePosition } from './mediaTimeline';

interface MountedCue {
  cue: MediaCue;
  activeSourceId: string | null;
  media: HTMLMediaElement | HTMLElement | null;
  outgoing: HTMLMediaElement | null;
  activationMs: number | null;
  transitionStartMs: number | null;
  playbackBlocked: boolean;
  playPending: boolean;
  playRevision: number;
  pausedAtMs: number | null;
  stopped: boolean;
  gain: number;
  muted: boolean;
}

export type MediaCueVisualSwitch = (
  cue: MediaCue,
  source: MediaCueSource,
  timestampMs: number,
) => void | Promise<void>;

export function mediaCueAutomaticStartMs(
  cue: MediaCue,
  descriptor: Pick<CompiledGraphicDescriptor, 'frameRate' | 'keyframes'>,
): number | null {
  const trigger = cue.trigger;
  const frame =
    trigger.type === 'timeline'
      ? trigger.startFrame
      : trigger.type === 'lifecycle'
        ? descriptor.keyframes.find((keyframe) => keyframe.id === trigger.keyframeId)?.frame
        : undefined;
  return frame === undefined ? null : (frame / descriptor.frameRate) * 1000;
}

function isOneShotAudio(cue: MediaCue, source: MediaCueSource | undefined): boolean {
  return source?.kind === 'clip' && source.mediaType === 'audio' && !cue.loop;
}

function isWholeClipAudioLoop(cue: MediaCue, source: MediaCueSource): boolean {
  return (
    source.kind === 'clip' &&
    source.mediaType === 'audio' &&
    cue.loop &&
    cue.trimStartMs === 0 &&
    cue.trimEndMs === null &&
    cue.durationFrames === null
  );
}

export class MediaCueRuntime {
  readonly #host: HTMLElement;
  readonly #descriptor: CompiledGraphicDescriptor;
  readonly #visualSwitch: MediaCueVisualSwitch | undefined;
  readonly #mounted = new Map<string, MountedCue>();
  readonly #clipMedia = new WeakSet<HTMLElement>();
  #timestampMs = 0;

  constructor(
    host: HTMLElement,
    descriptor: CompiledGraphicDescriptor,
    visualSwitch?: MediaCueVisualSwitch,
  ) {
    this.#host = host;
    this.#descriptor = descriptor;
    this.#visualSwitch = visualSwitch;
    for (const cue of descriptor.mediaCues ?? []) {
      this.#mounted.set(cue.id, {
        cue,
        activeSourceId: null,
        media: null,
        outgoing: null,
        activationMs: null,
        transitionStartMs: null,
        playbackBlocked: false,
        playPending: false,
        playRevision: 0,
        pausedAtMs: null,
        stopped: false,
        gain: 1,
        muted: false,
      });
    }
  }

  /** Rearm authored triggers without playing. An optional ID resets only that cue. */
  reset(cueId?: string): void {
    for (const mounted of this.#mounted.values()) {
      if (cueId !== undefined && mounted.cue.id !== cueId) continue;
      this.#disposeMedia(mounted.media);
      this.#disposeMedia(mounted.outgoing);
      mounted.activeSourceId = null;
      mounted.media = null;
      mounted.outgoing = null;
      mounted.activationMs = null;
      mounted.transitionStartMs = null;
      mounted.playbackBlocked = false;
      mounted.playPending = false;
      mounted.playRevision++;
      mounted.pausedAtMs = null;
      mounted.stopped = false;
    }
  }

  /** Preserve the current playhead; later render ticks and autoplay retries stay paused. */
  pause(cueId: string): boolean {
    const mounted = this.#mounted.get(cueId);
    if (!mounted || mounted.stopped || !mounted.media) return false;
    if (mounted.pausedAtMs !== null) return true;
    mounted.pausedAtMs = this.#timestampMs;
    mounted.playRevision++;
    mounted.playPending = false;
    if (this.#isClipMedia(mounted.media)) mounted.media.pause();
    mounted.outgoing?.pause();
    return true;
  }

  /** Explicitly resume an existing cue, without creating or automatically starting another one. */
  resume(cueId: string): boolean {
    const mounted = this.#mounted.get(cueId);
    if (!mounted || mounted.stopped || !mounted.media) return false;
    if (mounted.pausedAtMs !== null) {
      const heldMs = Math.max(0, this.#timestampMs - mounted.pausedAtMs);
      if (mounted.activationMs !== null) mounted.activationMs += heldMs;
      if (mounted.transitionStartMs !== null) mounted.transitionStartMs += heldMs;
      mounted.pausedAtMs = null;
    }
    mounted.playbackBlocked = false;
    if (this.#isClipMedia(mounted.media)) this.#attemptPlay(mounted, mounted.media);
    if (mounted.outgoing) {
      const outgoing = mounted.outgoing;
      void outgoing
        .play()
        .then(() => {
          if (mounted.outgoing !== outgoing || mounted.stopped || mounted.pausedAtMs !== null)
            outgoing.pause();
        })
        .catch(() => undefined);
    }
    return true;
  }

  /** Stop and release one cue. Automatic timeline triggers cannot restart it until reset/take. */
  stop(cueId: string): boolean {
    const mounted = this.#mounted.get(cueId);
    if (!mounted) return false;
    this.reset(cueId);
    mounted.stopped = true;
    return true;
  }

  /** Play the authored active source with the cue's normal retrigger policy. */
  async play(cueId: string, timestampMs = this.#timestampMs): Promise<boolean> {
    const mounted = this.#mounted.get(cueId);
    if (!mounted?.cue.activeSourceId) return false;
    await this.take(cueId, mounted.cue.activeSourceId, timestampMs);
    return true;
  }

  /** An explicit restart always starts from the authored source/trim, regardless of retrigger mode. */
  async restart(cueId: string, timestampMs = this.#timestampMs): Promise<boolean> {
    const mounted = this.#mounted.get(cueId);
    if (
      !mounted ||
      !mounted.cue.activeSourceId ||
      !mounted.cue.sources.some((source) => source.id === mounted.cue.activeSourceId)
    )
      return false;
    this.reset(cueId);
    await this.take(cueId, mounted.cue.activeSourceId, timestampMs);
    return true;
  }

  /** Local transport gain is a multiplier of the authored volume; it never edits the descriptor. */
  setAudio(cueId: string, controls: { gain?: number; muted?: boolean }): boolean {
    const mounted = this.#mounted.get(cueId);
    if (
      !mounted ||
      (controls.gain !== undefined &&
        (!Number.isFinite(controls.gain) || controls.gain < 0 || controls.gain > 1)) ||
      (controls.muted !== undefined && typeof controls.muted !== 'boolean')
    )
      return false;
    if (controls.gain !== undefined) mounted.gain = controls.gain;
    if (controls.muted !== undefined) mounted.muted = controls.muted;
    const transitionMs = mounted.pausedAtMs ?? this.#timestampMs;
    const incomingGain =
      mounted.transitionStartMs !== null && mounted.outgoing
        ? Math.min(
            1,
            Math.max(
              0,
              (transitionMs - mounted.transitionStartMs) /
                ((Math.max(1, mounted.cue.transition.durationFrames) / this.#descriptor.frameRate) *
                  1000),
            ),
          )
        : 1;
    for (const media of [mounted.media, mounted.outgoing]) {
      if (!this.#isClipMedia(media)) continue;
      media.muted = mounted.cue.muted || mounted.muted;
      media.volume =
        this.#volume(mounted) * (media === mounted.outgoing ? 1 - incomingGain : incomingGain);
    }
    return true;
  }

  #volume(mounted: MountedCue): number {
    return mounted.cue.muted || mounted.muted ? 0 : mounted.cue.volume * mounted.gain;
  }

  /** Retry audio that the browser blocked before the operator's first playback gesture. */
  resumeBlocked(): void {
    for (const mounted of this.#mounted.values()) {
      if (
        !mounted.playbackBlocked ||
        mounted.stopped ||
        mounted.pausedAtMs !== null ||
        !this.#isClipMedia(mounted.media)
      )
        continue;
      mounted.playbackBlocked = false;
      this.#attemptPlay(mounted, mounted.media);
    }
  }

  dispose(): void {
    this.reset();
    this.#mounted.clear();
    this.#host.remove?.();
  }

  async triggerCustomAction(
    actionId: string,
    payload: unknown,
    timestampMs = this.#timestampMs,
  ): Promise<void> {
    const requestedSource =
      payload && typeof payload === 'object' && 'source' in payload
        ? String((payload as { source?: unknown }).source ?? '')
        : '';
    for (const mounted of this.#mounted.values()) {
      if (mounted.cue.trigger.type !== 'customAction' || mounted.cue.trigger.actionId !== actionId)
        continue;
      const source = requestedSource
        ? mounted.cue.sources.find(
            (candidate) => candidate.id === requestedSource || candidate.name === requestedSource,
          )
        : undefined;
      await this.take(mounted.cue.id, source?.id ?? mounted.cue.activeSourceId, timestampMs);
    }
  }

  async take(cueId: string, sourceId: string | null, timestampMs: number): Promise<void> {
    const mounted = this.#mounted.get(cueId);
    if (!mounted) return;
    const source = mounted.cue.sources.find((candidate) => candidate.id === sourceId);
    if (!source) return;
    if (mounted.activeSourceId === source.id) {
      if (mounted.cue.retrigger === 'ignore') return;
      if (mounted.cue.retrigger === 'resume') {
        this.resume(cueId);
        return;
      }
    }

    const incoming = this.#createMedia(mounted.cue, source);
    const previous = this.#isClipMedia(mounted.media) ? mounted.media : null;
    mounted.activeSourceId = source.id;
    mounted.media = incoming;
    mounted.activationMs = timestampMs;
    mounted.transitionStartMs =
      mounted.cue.transition.type === 'crossfade' && previous ? timestampMs : null;
    mounted.playbackBlocked = false;
    mounted.playPending = false;
    mounted.playRevision++;
    mounted.pausedAtMs = null;
    mounted.stopped = false;
    this.#disposeMedia(mounted.outgoing);
    mounted.outgoing = mounted.transitionStartMs === null ? null : previous;
    if (!mounted.outgoing) this.#disposeMedia(previous);
    if (this.#isClipMedia(incoming)) {
      incoming.muted = mounted.cue.muted || mounted.muted;
      incoming.volume = this.#volume(mounted);
      incoming.playbackRate = mounted.cue.speed;
      if (incoming.readyState >= 1 && mounted.cue.trimStartMs > 0) {
        incoming.currentTime = mounted.cue.trimStartMs / 1000;
      }
      this.#attemptPlay(mounted, incoming);
    }
    await this.#visualSwitch?.(mounted.cue, source, timestampMs);
  }

  renderAtTime(timestampMs: number, options: { includeAudio?: boolean } = {}): void {
    this.#timestampMs = timestampMs;
    for (const mounted of this.#mounted.values()) {
      if (mounted.stopped || mounted.pausedAtMs !== null) continue;
      const authoredSource = mounted.cue.sources.find(
        (candidate) => candidate.id === (mounted.activeSourceId ?? mounted.cue.activeSourceId),
      );
      if (
        options.includeAudio === false &&
        authoredSource?.kind === 'clip' &&
        authoredSource.mediaType === 'audio'
      ) {
        continue;
      }
      if (mounted.activationMs === null) {
        const startMs = mediaCueAutomaticStartMs(mounted.cue, this.#descriptor);
        if (startMs !== null && timestampMs >= startMs) {
          void this.take(mounted.cue.id, mounted.cue.activeSourceId, startMs);
        }
        continue;
      }
      const media = mounted.media;
      const baseVolume = this.#volume(mounted);
      let incomingGain = 1;
      if (mounted.transitionStartMs !== null && mounted.outgoing) {
        const durationMs =
          (Math.max(1, mounted.cue.transition.durationFrames) / this.#descriptor.frameRate) * 1000;
        const progress = Math.min(
          1,
          Math.max(0, (timestampMs - mounted.transitionStartMs) / durationMs),
        );
        incomingGain = progress;
        mounted.outgoing.volume = baseVolume * (1 - progress);
        if (progress >= 1) {
          this.#disposeMedia(mounted.outgoing);
          mounted.outgoing = null;
          mounted.transitionStartMs = null;
        }
      }
      if (!this.#isClipMedia(media)) continue;
      if (isOneShotAudio(mounted.cue, authoredSource)) {
        media.volume = Math.min(1, Math.max(0, baseVolume));
        media.playbackRate = mounted.cue.speed;
        // Sound Events are edge-triggered one-shots. Once started, their media clock owns playback;
        // later OGraf transitions must never seek them back to the marker or call play() again.
        continue;
      }
      const localTimestamp = Math.max(0, timestampMs - mounted.activationMs);
      if (
        mounted.cue.durationFrames != null &&
        localTimestamp >=
          (Math.max(1, mounted.cue.durationFrames) / this.#descriptor.frameRate) * 1000
      ) {
        media.pause();
        continue;
      }
      const position = resolveMediaTimelinePosition(localTimestamp, {
        timelineStartMs: 0,
        trimStartMs: mounted.cue.trimStartMs,
        trimEndMs: mounted.cue.trimEndMs,
        loop: mounted.cue.loop,
        speed: mounted.cue.speed,
        durationMs: Number.isFinite(media.duration) ? media.duration * 1000 : null,
      });
      media.volume = Math.min(1, Math.max(0, baseVolume * incomingGain));
      media.playbackRate = mounted.cue.speed;
      if (!position.active) {
        media.pause();
        continue;
      }
      if (media.readyState >= 1) {
        const seconds = position.positionMs / 1000;
        if (Math.abs(media.currentTime - seconds) > 0.08) media.currentTime = seconds;
      }
      if (mounted.playbackBlocked || mounted.playPending) continue;
      this.#attemptPlay(mounted, media);
    }
  }

  #attemptPlay(mounted: MountedCue, media: HTMLMediaElement): void {
    if (mounted.playPending || mounted.stopped || mounted.pausedAtMs !== null) return;
    mounted.playPending = true;
    const revision = ++mounted.playRevision;
    const stillCurrent = () => {
      if (
        revision === mounted.playRevision &&
        mounted.media === media &&
        !mounted.stopped &&
        mounted.pausedAtMs === null
      )
        return true;
      // A delayed browser play promise cannot resurrect a stopped or replaced player.
      if (
        (mounted.media !== media && mounted.outgoing !== media) ||
        mounted.stopped ||
        mounted.pausedAtMs !== null
      )
        media.pause();
      return false;
    };
    void media
      .play()
      .then(() => {
        if (!stillCurrent()) return;
        mounted.playPending = false;
        mounted.playbackBlocked = false;
        delete this.#host.dataset.ografMediaCueError;
      })
      .catch((cause: unknown) => {
        if (!stillCurrent()) return;
        mounted.playPending = false;
        mounted.playbackBlocked = true;
        this.#host.dataset.ografMediaCueError =
          cause instanceof Error ? cause.message : String(cause);
      });
  }

  #createMedia(cue: MediaCue, source: MediaCueSource): HTMLMediaElement | HTMLElement {
    if (source.kind === 'live') {
      const live = this.#host.ownerDocument.createElement(LIVE_MEDIA_ELEMENT_TAG);
      live.dataset.sourceTag = source.tag;
      live.dataset.ografMediaCueId = cue.id;
      live.style.display = 'none';
      this.#host.appendChild(live);
      return live;
    }
    const media = this.#host.ownerDocument.createElement(source.mediaType);
    this.#clipMedia.add(media);
    media.src = source.src;
    media.preload = 'auto';
    // The media clock keeps whole-clip music looping while the graphic holds on a Step.
    // Trimmed/block-limited cues still use the existing explicit timeline sampler.
    media.loop = isWholeClipAudioLoop(cue, source);
    media.muted = cue.muted;
    media.volume = cue.muted ? 0 : cue.volume;
    media.playbackRate = cue.speed;
    if (source.mediaType === 'video') (media as HTMLVideoElement).playsInline = true;
    media.dataset.ografMediaCueId = cue.id;
    media.dataset.ografMediaSourceId = source.id;
    media.style.display = 'none';
    this.#host.appendChild(media);
    return media;
  }

  /** Created clip identity survives cross-window adoption; realm constructors do not. */
  #isClipMedia(media: HTMLElement | null): media is HTMLMediaElement {
    return media !== null && this.#clipMedia.has(media);
  }

  #disposeMedia(media: HTMLMediaElement | HTMLElement | null): void {
    if (!media) return;
    if (this.#isClipMedia(media)) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    media.remove();
  }
}
