const attachments = new WeakMap<HTMLVideoElement, symbol>();

/** Display an existing shared stream. Capture ownership stays with the explicit webcam controls. */
export function attachWebcamPresentationVideo(
  video: HTMLVideoElement,
  stream: MediaStream,
): () => void {
  const attachment = Symbol('webcam-presentation');
  attachments.set(video, attachment);
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    void video.play().catch(() => undefined);
  } catch {
    // A blocked autoplay can be retried through the user's existing webcam controls.
  }
  return () => {
    if (attachments.get(video) !== attachment) return;
    attachments.delete(video);
    if (video.srcObject !== stream) return;
    video.pause();
    video.srcObject = null;
  };
}
