import { useTimelineStore } from '../state/timelineStore';

/** Synced preview controls operate the editor's existing transport. */
export function EditorPreviewControls() {
  const frame = useTimelineStore((state) => state.currentFrame);
  const playing = useTimelineStore((state) => state.isPlaying);
  const controller = useTimelineStore((state) => state.controller);
  const duration = useTimelineStore((state) => state.durationFrames);
  return (
    <>
      <p className="playout-controls-note" role="status">
        Synced to editor · Frame {Number(frame.toFixed(2))}
      </p>
      <div className="preview-controls-row">
        <button
          type="button"
          aria-label="Previous editor frame"
          disabled={!controller || frame <= 0}
          onClick={() => controller?.seek(Math.max(0, frame - 1))}
        >
          ← 1f
        </button>
        <button
          type="button"
          disabled={!controller}
          onClick={() => (playing ? controller?.pause() : controller?.play())}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" disabled={!controller} onClick={() => controller?.stop()}>
          Stop
        </button>
        <button
          type="button"
          aria-label="Next editor frame"
          disabled={!controller || frame >= duration}
          onClick={() => controller?.seek(Math.min(duration, frame + 1))}
        >
          1f →
        </button>
      </div>
    </>
  );
}
