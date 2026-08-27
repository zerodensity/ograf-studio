import { useEffect, useRef, useState } from 'react';
import type { Composition } from '@ograf-editor/scene-model';

export const BIG_BUCK_BUNNY_VIDEO_URL =
  'https://cdn.jsdelivr.net/gh/bower-media-samples/big-buck-bunny-1080p-60fps-30s@master/video.mp4';

export function CanvasPresentationBackground({ composition }: { composition: Composition }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const mode = composition.layout.presentationBackground;
  const videoEnabled = mode === 'big-buck-bunny';
  const imageSource = composition.layout.presentationBackgroundImageSource.trim();

  useEffect(() => {
    if (!videoEnabled) return;
    void videoRef.current?.play().catch(() => undefined);
  }, [videoEnabled]);

  useEffect(() => setImageFailed(false), [imageSource]);

  if (mode === 'still-image') {
    if (!imageSource) return null;
    return (
      <div className="canvas-presentation-background" aria-hidden="true">
        <img
          src={imageSource}
          alt=""
          draggable={false}
          onLoad={() => setImageFailed(false)}
          onError={() => setImageFailed(true)}
        />
        {imageFailed ? (
          <span className="canvas-presentation-background-error">Image could not be loaded</span>
        ) : null}
      </div>
    );
  }

  if (!videoEnabled) return null;
  return (
    <div className="canvas-presentation-background" aria-hidden="true">
      <video
        ref={videoRef}
        src={BIG_BUCK_BUNNY_VIDEO_URL}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        disablePictureInPicture
        tabIndex={-1}
      />
    </div>
  );
}
