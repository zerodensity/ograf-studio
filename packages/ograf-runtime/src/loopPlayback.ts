import type { CompiledLayer } from '@ograf-editor/ograf-types';
import { advanceTimedLoopElapsedFrames, getLoopFrameAtElapsed } from '@ograf-editor/scene-model';

export type LoopPlaybackAction = 'pause' | 'resume' | 'next';
interface Group {
  layer: CompiledLayer;
  elapsed: number;
  rawElapsed: number;
  frame: number;
  paused: boolean;
  holdSeconds: unknown;
  advanceUntil?: number;
}

/** Independent transports on the graphic clock. Rebuilding schedule mounts rebuilds this state. */
export class LoopPlaybackController {
  #groups = new Map<string, Group>();

  sample(
    layer: CompiledLayer,
    rawElapsed: number | undefined,
    data: Record<string, unknown>,
    frame: number,
  ): number | undefined {
    const loop = layer.loop;
    if (!loop?.timing || rawElapsed === undefined) return rawElapsed;
    const key = loop.timing.groupId;
    let group = this.#groups.get(key);
    const holdSeconds = loop.holdDataKey ? data[loop.holdDataKey] : undefined;
    if (!group || rawElapsed < group.rawElapsed) {
      group = { layer, elapsed: 0, rawElapsed: 0, frame, paused: false, holdSeconds };
      this.#groups.set(key, group);
    }
    if (!group.paused || group.advanceUntil !== undefined) {
      group.elapsed = advanceTimedLoopElapsedFrames(
        loop,
        group.elapsed,
        rawElapsed - group.rawElapsed,
        loop.frameRate ?? 25,
        group.holdSeconds,
      );
      if (group.advanceUntil !== undefined && group.elapsed >= group.advanceUntil) {
        group.elapsed = group.advanceUntil;
        delete group.advanceUntil;
      }
    }
    group.rawElapsed = rawElapsed;
    group.layer = layer;
    group.frame = frame;
    group.holdSeconds = holdSeconds;
    return group.elapsed;
  }

  control(action: LoopPlaybackAction, groupId: string, frame: number): boolean {
    const group = this.#groups.get(groupId);
    if (!group) return false;
    const loop = group.layer.loop!;
    if (!group.paused)
      group.elapsed = advanceTimedLoopElapsedFrames(
        loop,
        group.elapsed,
        Math.max(0, frame - group.frame),
        loop.frameRate ?? 25,
        group.holdSeconds,
      );
    group.rawElapsed += Math.max(0, frame - group.frame);
    group.frame = frame;
    if (action === 'pause') group.paused = true;
    if (action === 'resume') group.paused = false;
    if (action === 'next') {
      const phase = getLoopFrameAtElapsed(loop, group.elapsed);
      const hold = loop.timing!.holdRanges.find(
        (range) => phase >= range.startFrame && phase < range.endFrame,
      );
      if (hold) {
        group.elapsed += hold.endFrame - phase;
        if (group.paused) {
          const next = loop.timing!.holdRanges.find((range) => range.startFrame >= hold.endFrame);
          group.advanceUntil =
            group.elapsed +
            (next
              ? next.startFrame - hold.endFrame
              : loop.durationFrames - hold.endFrame + loop.timing!.holdRanges[0]!.startFrame);
        }
      }
    }
    return true;
  }

  groups(): Array<{ groupId: string; name: string; paused: boolean }> {
    return [...this.#groups].map(([groupId, group]) => ({
      groupId,
      name: groupId.slice(groupId.lastIndexOf(':') + 1),
      paused: group.paused,
    }));
  }

  clear(): void {
    this.#groups.clear();
  }

  inherit(previous: LoopPlaybackController): void {
    this.#groups = new Map([...previous.#groups].map(([id, group]) => [id, { ...group }]));
  }
}
