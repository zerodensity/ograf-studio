import { useEffect, useRef, useState } from 'react';
import {
  usePresentationBackgroundStore,
  type PresentationBackgroundSettings,
} from '../state/presentationBackgroundStore';
import { WebcamPresentationBackground } from './WebcamPresentationBackground';
import './PresentationBackground.css';
import { useProgramMonitorStore } from '../state/programMonitorStore';

const BIG_BUCK_BUNNY_VIDEO_URL =
  'https://cdn.jsdelivr.net/gh/bower-media-samples/big-buck-bunny-1080p-60fps-30s@master/video.mp4';

/** A local presentation bed, separate from the authored graphic and its playback runtime. */
export function PresentationBackground({
  settings: suppliedSettings,
  className,
}: {
  settings?: PresentationBackgroundSettings;
  className?: string;
}) {
  const sharedSettings = usePresentationBackgroundStore((state) => state.settings);
  const program = useProgramMonitorStore();
  const settings = suppliedSettings ?? sharedSettings;
  const video = useRef<HTMLVideoElement>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = settings.imageSource.trim();
  const bundledSample =
    program.background === 'sample-news'
      ? 'news-studio.mp4'
      : program.background === 'sample-entertainment'
        ? 'entertainment-studio.mp4'
        : '';
  const videoEnabled =
    Boolean(bundledSample) ||
    (program.background === 'video'
      ? Boolean(program.videoUrl)
      : program.background === 'document' && settings.mode === 'big-buck-bunny');
  const videoSource = bundledSample
    ? `${import.meta.env.BASE_URL}program-samples/${bundledSample}`
    : program.background === 'video'
      ? program.videoUrl
      : BIG_BUCK_BUNNY_VIDEO_URL;
  const classes = ['presentation-background', className].filter(Boolean).join(' ');

  useEffect(() => {
    if (!videoEnabled) return;
    const player = video.current;
    if (!player) return;
    void player.play().catch(() => undefined);
    return () => player.pause();
  }, [videoEnabled, videoSource]);

  if (program.background === 'black')
    return <div className={`${classes} program-background-black`} aria-hidden="true" />;
  if (program.background === 'checker')
    return <div className={`${classes} program-background-checker`} aria-hidden="true" />;
  if (program.background === 'video' && !program.videoUrl) return null;

  if (program.background === 'document' && settings.mode === 'webcam')
    return <WebcamPresentationBackground className={classes} />;
  if (program.background === 'document' && settings.mode === 'still-image') {
    if (!source) return null;
    return (
      <div className={classes} aria-hidden="true">
        <img
          key={source}
          src={source}
          alt=""
          draggable={false}
          onLoad={() => setFailedSource(null)}
          onError={() => setFailedSource(source)}
        />
        {failedSource === source ? (
          <span className="presentation-background-error">Image could not be loaded</span>
        ) : null}
      </div>
    );
  }
  if (!videoEnabled) return null;
  return (
    <div className={classes} aria-hidden="true">
      <video
        ref={video}
        src={videoSource}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        disablePictureInPicture
        tabIndex={-1}
        onCanPlay={() => setFailedSource(null)}
        onError={() => setFailedSource(videoSource)}
      />
      {failedSource === videoSource && (
        <span className="presentation-background-error">Video could not be loaded</span>
      )}
    </div>
  );
}
