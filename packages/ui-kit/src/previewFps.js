/**
 * Presentation-only diagnostics. RAF cadence is not a GPU timing measurement or the graphic's
 * authored frame rate. Hosts can separately record completed non-real-time render samples.
 * This dependency-free source is also embedded in exported HTML previews.
 */
export function createPreviewFpsMonitor(options) {
  const { target, onSample } = options;
  const owner = options.ownerWindow ?? target?.ownerDocument?.defaultView;
  const doc = target?.ownerDocument ?? owner?.document;
  const interval = Math.max(
    100,
    Number.isFinite(options.sampleIntervalMs) && options.sampleIntervalMs > 0
      ? options.sampleIntervalMs
      : 500,
  );
  let disposed = false;
  let active = false;
  let generation = 0;
  let request = null;
  let observer;
  let intersecting = typeof owner?.IntersectionObserver !== 'function';
  let started = null;
  let frames = 0;
  let rendered = 0;
  const emit = (sample) => {
    try {
      onSample(sample);
    } catch {
      // A diagnostics callback must never interrupt playback or prevent cleanup.
    }
  };
  const clear = () => {
    started = null;
    frames = rendered = 0;
    emit({ fps: null, renderFps: null });
  };
  const tick = (time, scheduledGeneration) => {
    // Some hosts can deliver an already queued callback after cancellation. A stale callback
    // must not clear the resumed monitor's handle or create a second animation-frame chain.
    if (!active || disposed || scheduledGeneration !== generation) return;
    request = null;
    if (!Number.isFinite(time) || (started !== null && time < started)) clear();
    else if (started === null) started = time;
    else {
      frames++;
      const elapsed = time - started;
      if (elapsed >= interval) {
        emit({
          fps: (frames * 1000) / elapsed,
          renderFps: options.renderSampling ? (rendered * 1000) / elapsed : null,
        });
        started = time;
        frames = rendered = 0;
      }
    }
    if (active && !disposed && scheduledGeneration === generation)
      request = owner.requestAnimationFrame((next) => tick(next, scheduledGeneration));
  };
  const update = () => {
    const next =
      !disposed &&
      !!owner?.requestAnimationFrame &&
      doc?.visibilityState !== 'hidden' &&
      target?.isConnected !== false &&
      intersecting;
    if (next === active) return;
    active = next;
    generation++;
    if (request !== null) owner.cancelAnimationFrame(request);
    request = null;
    clear();
    if (active) {
      const scheduledGeneration = generation;
      request = owner.requestAnimationFrame((time) => tick(time, scheduledGeneration));
    }
  };
  clear();
  if (owner?.IntersectionObserver && target) {
    observer = new owner.IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === target);
      if (!entry || disposed) return;
      intersecting = entry.isIntersecting && entry.intersectionRatio !== 0;
      update();
    });
    observer.observe(target);
  }
  doc?.addEventListener?.('visibilitychange', update);
  update();
  return {
    recordRender() {
      if (active && !disposed) rendered++;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      generation++;
      if (request !== null) owner.cancelAnimationFrame(request);
      request = null;
      observer?.disconnect();
      doc?.removeEventListener?.('visibilitychange', update);
    },
  };
}
