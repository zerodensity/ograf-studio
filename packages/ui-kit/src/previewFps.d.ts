export interface PreviewFpsSample {
  /** Observed browser animation-frame cadence; not GPU throughput or authored graphic FPS. */
  fps: number | null;
  /** Successful completed samples recorded by a rendered-mode host, or null when not enabled. */
  renderFps: number | null;
}

export interface PreviewFpsMonitorOptions {
  target: HTMLElement;
  ownerWindow?: Window | null;
  onSample(sample: PreviewFpsSample): void;
  renderSampling?: boolean;
  sampleIntervalMs?: number;
}

export interface PreviewFpsMonitor {
  recordRender(): void;
  dispose(): void;
}

/** Stops and resets while the owner document is hidden or the target is outside the viewport. */
export function createPreviewFpsMonitor(options: PreviewFpsMonitorOptions): PreviewFpsMonitor;
