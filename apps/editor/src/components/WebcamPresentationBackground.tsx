import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  getWebcamPresentationStream,
  getWebcamPreviewState,
  subscribeWebcamPreview,
} from '../state/webcamPreview';
import './WebcamPresentationBackground.css';
import { attachWebcamPresentationVideo } from './webcamPresentationVideo';

/** Passive backdrop shared by the canvas and independent Studio preview surfaces. */
export function WebcamPresentationBackground({ className }: { className?: string }) {
  const webcam = useSyncExternalStore(
    subscribeWebcamPreview,
    getWebcamPreviewState,
    getWebcamPreviewState,
  );
  const video = useRef<HTMLVideoElement>(null);
  const stream =
    webcam.status === 'running' && webcam.presentation ? getWebcamPresentationStream() : null;
  useEffect(() => {
    const player = video.current;
    if (!player || !stream) return;
    return attachWebcamPresentationVideo(player, stream);
  }, [stream]);
  if (!stream) return null;
  return (
    <div
      className={['webcam-presentation-background', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <video ref={video} autoPlay muted playsInline disablePictureInPicture tabIndex={-1} />
    </div>
  );
}
