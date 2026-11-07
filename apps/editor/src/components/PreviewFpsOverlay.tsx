import { createPreviewFpsMonitor } from '@ograf-editor/ui-kit/preview-fps';
import { useEffect, useState, type RefObject } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { useProgramMonitorStore } from '../state/programMonitorStore';
import './PreviewFpsOverlay.css';

const PREVIEW_FPS_DESCRIPTION =
  'Browser animation-frame cadence for this visible preview, not the authored frame rate or GPU render throughput.';

/** An unavailable sample is not the authored frame rate or a fabricated zero. */
function formatPreviewFps(fps: number | null): string {
  return fps !== null && Number.isFinite(fps) && fps >= 0 ? fps.toFixed(1) : '—';
}

/** Presentation-only chrome, deliberately outside the graphic's authored coordinate space. */
export function PreviewFpsOverlayView({
  fps,
  visible = true,
}: {
  fps: number | null;
  visible?: boolean;
}) {
  if (!visible) return null;
  const value = formatPreviewFps(fps);
  return (
    <output
      className="preview-fps-overlay"
      data-preview-diagnostic="fps"
      aria-label={`Preview FPS: ${value}`}
      aria-live="off"
      title={PREVIEW_FPS_DESCRIPTION}
    >
      <span>Preview FPS</span> <strong>{value}</strong>
    </output>
  );
}

/** Each visible preview follows its actual owner window, including detached editor panes. */
export function PreviewFpsOverlay({
  targetRef,
  active = true,
}: {
  targetRef: RefObject<HTMLElement | null>;
  active?: boolean;
}) {
  const { window: ownerWindow } = useEditorWindow();
  const visible = useProgramMonitorStore((state) => state.fpsOverlay);
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    setFps(null);
    const target = targetRef.current;
    if (!visible || !active || !target) return;
    const monitor = createPreviewFpsMonitor({
      target,
      ownerWindow,
      onSample: (sample) => setFps(sample.fps),
    });
    return () => monitor.dispose();
  }, [active, ownerWindow, targetRef, visible]);
  return <PreviewFpsOverlayView fps={active ? fps : null} visible={visible} />;
}

/** Session-only presentation preference shared by ordinary, coordinated and detached previews. */
export function PreviewFpsControls() {
  const visible = useProgramMonitorStore((state) => state.fpsOverlay);
  const setVisible = useProgramMonitorStore((state) => state.setFpsOverlay);
  return (
    <label className="preview-fps-controls" title={PREVIEW_FPS_DESCRIPTION}>
      <input
        type="checkbox"
        aria-label="Show FPS overlay"
        checked={visible}
        onChange={(event) => setVisible(event.currentTarget.checked)}
      />
      <span>Show FPS overlay</span>
    </label>
  );
}
